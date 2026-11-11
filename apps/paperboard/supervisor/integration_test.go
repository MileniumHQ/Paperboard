package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

// The supervisor as it runs: this test binary started as one, serving a
// workload that is this test binary again, so every platform has the same
// programs to supervise.
const (
	superviseEnv = "PAPERBOARD_SUPERVISOR_UNDER_TEST"
	helperEnv    = "PAPERBOARD_SUPERVISOR_HELPER"
)

func TestMain(m *testing.M) {
	if mode := os.Getenv(helperEnv); mode != "" {
		runHelper(mode)
		return
	}
	if os.Getenv(superviseEnv) == "1" {
		// how this process was started, not something its workload inherits
		os.Unsetenv(superviseEnv)
		main()
		return
	}
	os.Exit(m.Run())
}

func runHelper(mode string) {
	switch {
	case mode == "echo":
		scanner := bufio.NewScanner(os.Stdin)
		fmt.Println("ready")
		for scanner.Scan() {
			fmt.Println("got:" + scanner.Text())
		}
	case mode == "streams":
		fmt.Fprintln(os.Stdout, "to-out")
		fmt.Fprintln(os.Stderr, "to-err")
		os.Exit(7)
	case mode == "tree":
		// a wrapper whose child holds the output: stopping it must stop both
		child := exec.Command(os.Args[0])
		child.Env = append(os.Environ(), helperEnv+"=sleep")
		child.Stdout, child.Stderr = os.Stdout, os.Stderr
		if err := child.Start(); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		fmt.Printf("child:%d\n", child.Process.Pid)
		child.Wait()
	case mode == "sleep":
		time.Sleep(10 * time.Minute)
	case strings.HasPrefix(mode, "exit:"):
		code, _ := strconv.ParseInt(strings.TrimPrefix(mode, "exit:"), 10, 64)
		os.Exit(int(code))
	case mode == "where":
		cwd, _ := os.Getwd()
		fmt.Printf("cwd=%s pwd=%s marker=%s supervising=%s\n", cwd, os.Getenv("PWD"), os.Getenv("MARKER"), os.Getenv(superviseEnv))
	}
}

type frame struct {
	Type     string `json:"type"`
	Stream   string `json:"stream"`
	Data     string `json:"data"`
	Code     *int64 `json:"code"`
	Error    string `json:"error"`
	Running  bool   `json:"running"`
	Pid      int    `json:"pid"`
	ChildPid int    `json:"childPid"`
	IsPty    bool   `json:"isPty"`
	Name     string `json:"name"`
}

type session struct {
	t       *testing.T
	dataDir string
	id      string
	process *exec.Cmd
	conn    net.Conn
	mu      sync.Mutex
	frames  []frame
	closed  bool
}

// starts a supervisor for config and connects to it, without attaching
func supervise(t *testing.T, id string, config map[string]any) *session {
	t.Helper()
	dataDir := t.TempDir()
	if runtime.GOOS != "windows" {
		// a short path: unix sockets have a small limit, and temp folders can be deep
		short, err := os.MkdirTemp("/tmp", "pbs")
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { os.RemoveAll(short) })
		dataDir = short
	}
	encoded, err := json.Marshal(config)
	if err != nil {
		t.Fatal(err)
	}
	process := exec.Command(os.Args[0], "--data-dir", dataDir, "--supervise", id)
	process.Env = append(os.Environ(), superviseEnv+"=1")
	process.Stdin = strings.NewReader(string(encoded))
	process.Stderr = os.Stderr
	if err := process.Start(); err != nil {
		t.Fatal(err)
	}
	s := &session{t: t, dataDir: dataDir, id: id, process: process}
	t.Cleanup(func() {
		process.Process.Kill()
		process.Wait()
	})
	at, err := resolveEndpoint(dataDir, id)
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(10 * time.Second)
	for {
		conn, err := dialEndpoint(at.address)
		if err == nil {
			s.conn = conn
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("the supervisor never listened on %s: %v", at.address, err)
		}
		time.Sleep(20 * time.Millisecond)
	}
	go func() {
		reader := bufio.NewReader(s.conn)
		for {
			line, err := reader.ReadBytes('\n')
			if len(strings.TrimSpace(string(line))) > 0 {
				var f frame
				if jsonErr := json.Unmarshal(line, &f); jsonErr != nil {
					t.Errorf("the supervisor sent a line that is not JSON: %q", line)
				}
				s.mu.Lock()
				s.frames = append(s.frames, f)
				s.mu.Unlock()
			}
			if err != nil {
				s.mu.Lock()
				s.closed = true
				s.mu.Unlock()
				// the supervisor has said everything: hang up, as its clients do
				s.conn.Close()
				return
			}
		}
	}()
	return s
}

func (s *session) send(message map[string]any) {
	s.t.Helper()
	encoded, _ := json.Marshal(message)
	if _, err := s.conn.Write(append(encoded, '\n')); err != nil {
		s.t.Fatalf("could not send %v: %v", message, err)
	}
}

func (s *session) snapshot() []frame {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]frame(nil), s.frames...)
}

func (s *session) output(stream string) string {
	var out strings.Builder
	for _, f := range s.snapshot() {
		if (f.Type == "data" || f.Type == "history") && (stream == "" || f.Stream == stream) {
			out.WriteString(f.Data)
		}
	}
	return out.String()
}

func (s *session) await(what string, found func() bool) {
	s.t.Helper()
	deadline := time.Now().Add(20 * time.Second)
	for !found() {
		if time.Now().After(deadline) {
			s.t.Fatalf("timed out waiting for %s; frames so far: %+v", what, s.snapshot())
		}
		time.Sleep(15 * time.Millisecond)
	}
}

func (s *session) status() frame {
	s.t.Helper()
	s.await("the status frame", func() bool { return len(s.snapshot()) > 0 })
	first := s.snapshot()[0]
	if first.Type != "status" {
		s.t.Fatalf("the first frame is %+v, not a status", first)
	}
	return first
}

func (s *session) exitCode() int64 {
	s.t.Helper()
	var code *int64
	s.await("the exit frame", func() bool {
		for _, f := range s.snapshot() {
			if f.Type == "exit" {
				code = f.Code
				return true
			}
		}
		return false
	})
	if code == nil {
		s.t.Fatal("the exit frame has no code")
	}
	return *code
}

// the supervisor process itself ends, with the workload's code
func (s *session) supervisorExit() int {
	s.t.Helper()
	done := make(chan struct{})
	go func() { s.process.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(20 * time.Second):
		s.t.Fatal("the supervisor did not exit")
	}
	return s.process.ProcessState.ExitCode()
}

func helper(mode string, extra map[string]any) map[string]any {
	config := map[string]any{"command": os.Args[0], "env": map[string]any{helperEnv: mode}}
	for key, value := range extra {
		if key == "env" {
			for name, v := range value.(map[string]any) {
				config["env"].(map[string]any)[name] = v
			}
			continue
		}
		config[key] = value
	}
	return config
}

func TestAFastWorkloadsOutputAndExitWaitForTheAttach(t *testing.T) {
	s := supervise(t, "fast", helper("streams", nil))
	if st := s.status(); st.Error != "" || st.Pid != s.process.Process.Pid || st.IsPty {
		t.Fatalf("status = %+v", st)
	}
	// it has exited by now, and nothing is sent until someone attaches
	time.Sleep(300 * time.Millisecond)
	if frames := s.snapshot(); len(frames) != 1 {
		t.Fatalf("frames before the attach: %+v", frames)
	}
	s.send(map[string]any{"type": "attach"})
	if code := s.exitCode(); code != 7 {
		t.Fatalf("exit code = %d", code)
	}
	if out, err := strings.TrimSpace(s.output("stdout")), strings.TrimSpace(s.output("stderr")); out != "to-out" || err != "to-err" {
		t.Fatalf("stdout %q, stderr %q", out, err)
	}
	if code := s.supervisorExit(); code != 7 {
		t.Fatalf("the supervisor exited with %d", code)
	}
	at, _ := resolveEndpoint(s.dataDir, s.id)
	if _, err := os.Stat(at.metadataFile); !os.IsNotExist(err) {
		t.Fatalf("the metadata outlived the workload: %v", err)
	}
}

func TestInputReachesTheWorkloadAndMetadataDescribesIt(t *testing.T) {
	s := supervise(t, "echo", helper("echo", map[string]any{"important": true, "env": map[string]any{"BOT_TOKEN": "hunter2"}}))
	st := s.status()
	s.send(map[string]any{"type": "attach"})
	s.await("the workload to be ready", func() bool { return strings.Contains(s.output("stdout"), "ready") })
	s.send(map[string]any{"type": "stdin", "data": "héllo ✓\n"})
	s.await("the echo", func() bool { return strings.Contains(s.output("stdout"), "got:héllo ✓") })

	at, _ := resolveEndpoint(s.dataDir, s.id)
	raw, err := os.ReadFile(at.metadataFile)
	if err != nil {
		t.Fatal(err)
	}
	var meta struct {
		ID       string `json:"id"`
		Pid      int    `json:"pid"`
		ChildPid int    `json:"childPid"`
		Config   struct {
			Important bool              `json:"important"`
			Env       map[string]string `json:"env"`
		} `json:"config"`
	}
	if err := json.Unmarshal(raw, &meta); err != nil {
		t.Fatal(err)
	}
	if meta.ID != "echo" || meta.Pid != st.Pid || meta.ChildPid != st.ChildPid || meta.ChildPid == 0 || !meta.Config.Important {
		t.Fatalf("metadata = %s", raw)
	}
	if meta.Config.Env["BOT_TOKEN"] != redacted || strings.Contains(string(raw), "hunter2") {
		t.Fatalf("a secret reached the metadata: %s", raw)
	}

	// a second client is shown what it missed, once
	other, err := dialEndpoint(at.address)
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	other.Write([]byte("{\"type\":\"attach\"}\n"))
	reader := bufio.NewReader(other)
	var replay frame
	for replay.Type != "history" {
		line, err := reader.ReadBytes('\n')
		if err != nil {
			t.Fatalf("no replay for the second client: %v", err)
		}
		json.Unmarshal(line, &replay)
	}
	if !strings.Contains(replay.Data, "got:héllo ✓") {
		t.Fatalf("replay = %q", replay.Data)
	}

	s.send(map[string]any{"type": "kill", "signal": "SIGTERM"})
	code := s.exitCode()
	if runtime.GOOS != "windows" && code != 143 {
		t.Fatalf("a workload ended by SIGTERM reported %d", code)
	}
	s.supervisorExit()
}

func TestStoppingAWorkloadStopsEverythingItStarted(t *testing.T) {
	s := supervise(t, "tree", helper("tree", nil))
	s.status()
	s.send(map[string]any{"type": "attach"})
	var child int
	s.await("the wrapper's child", func() bool {
		for _, line := range strings.Split(s.output("stdout"), "\n") {
			if rest, ok := strings.CutPrefix(strings.TrimSpace(line), "child:"); ok {
				child, _ = strconv.Atoi(rest)
				return child != 0
			}
		}
		return false
	})
	s.send(map[string]any{"type": "kill"})
	// the exit is only reported once the child, which holds the output, is gone
	s.exitCode()
	s.supervisorExit()
	s.await("the wrapper's child to be gone", func() bool { return !processAlive(child) })
}

func TestAStartThatFailsSaysWhy(t *testing.T) {
	s := supervise(t, "missing", map[string]any{"command": "paperboard-no-such-program"})
	if st := s.status(); st.Error != "Could not start paperboard-no-such-program: spawn paperboard-no-such-program ENOENT" {
		t.Fatalf("status = %+v", st)
	}
	if code := s.supervisorExit(); code != 1 {
		t.Fatalf("the supervisor exited with %d", code)
	}

	gone := filepath.Join(t.TempDir(), "gone")
	s = supervise(t, "nocwd", helper("where", map[string]any{"cwd": gone}))
	if st := s.status(); st.Error != "Working directory does not exist: "+gone {
		t.Fatalf("status = %+v", st)
	}
	s.supervisorExit()
}

func TestTheWorkloadStartsInItsOwnFolderWithItsOwnEnvironment(t *testing.T) {
	cwd := t.TempDir()
	if resolved, err := filepath.EvalSymlinks(cwd); err == nil {
		cwd = resolved
	}
	s := supervise(t, "where", helper("where", map[string]any{"cwd": cwd, "env": map[string]any{"MARKER": "set"}}))
	s.status()
	s.send(map[string]any{"type": "attach"})
	if code := s.exitCode(); code != 0 {
		t.Fatalf("exit code = %d: %s", code, s.output(""))
	}
	out := strings.TrimSpace(s.output("stdout"))
	want := fmt.Sprintf("cwd=%s pwd=%s marker=set supervising=", cwd, cwd)
	if !strings.EqualFold(out, want) {
		t.Fatalf("the workload saw %q, not %q", out, want)
	}
}

func TestExitCodesAreReportedWhole(t *testing.T) {
	want := int64(3)
	mode := "exit:3"
	if runtime.GOOS == "windows" {
		// an access violation, as a crashed game ends
		want = 0xC0000005
		mode = "exit:" + strconv.FormatInt(int64(int32(-1073741819)), 10)
	}
	s := supervise(t, "code", helper(mode, nil))
	s.status()
	s.send(map[string]any{"type": "attach"})
	if code := s.exitCode(); code != want {
		t.Fatalf("exit code = %d, not %d", code, want)
	}
}

func TestATerminalIsATerminal(t *testing.T) {
	shell, question, answer := "/bin/sh", "echo PTY-$((6*7)); test -t 0 && echo IS_A_TTY\n", "PTY-42"
	if runtime.GOOS == "windows" {
		shell, question = "cmd.exe", "set /a 6*7 & echo  PTY-DONE\r\n"
		answer = "PTY-DONE"
	}
	s := supervise(t, "term", map[string]any{"isPty": true, "command": shell, "cols": 100, "rows": 30})
	if st := s.status(); st.Error != "" || !st.IsPty {
		t.Fatalf("status = %+v", st)
	}
	s.send(map[string]any{"type": "attach"})
	s.send(map[string]any{"type": "stdin", "data": question})
	s.await("the terminal's answer", func() bool {
		out := s.output("")
		if runtime.GOOS == "windows" {
			return strings.Contains(out, "42") && strings.Count(out, answer) >= 2
		}
		return strings.Contains(out, answer) && strings.Contains(out, "IS_A_TTY\r")
	})
	s.send(map[string]any{"type": "resize", "cols": 132, "rows": 43})
	if runtime.GOOS != "windows" {
		s.send(map[string]any{"type": "stdin", "data": "stty size\n"})
		s.await("the new size", func() bool { return strings.Contains(s.output(""), "43 132") })
	}
	s.send(map[string]any{"type": "kill"})
	s.exitCode()
	s.supervisorExit()
}

// what a terminal's title shows: the shell at its prompt, the program it runs
// while it runs, and the shell again after; a client that attaches late hears
// the latest
func TestATerminalNamesTheProgramInFront(t *testing.T) {
	shell, run, program := "/bin/sh", "sleep 2\n", "sleep"
	if runtime.GOOS == "windows" {
		shell, run, program = "cmd.exe", "ping -n 3 127.0.0.1 > NUL\r\n", "ping"
	}
	s := supervise(t, "front", map[string]any{"isPty": true, "command": shell})
	s.status()
	s.send(map[string]any{"type": "attach"})
	names := func() []string {
		var out []string
		for _, f := range s.snapshot() {
			if f.Type == "foreground" {
				out = append(out, strings.ToLower(f.Name))
			}
		}
		return out
	}
	s.await("the shell's name", func() bool { return len(names()) > 0 })
	first := names()[0]
	if first == "" || first == program {
		t.Fatalf("the shell is named %q", first)
	}
	s.send(map[string]any{"type": "stdin", "data": run})
	s.await("the program's name", func() bool {
		got := names()
		return len(got) >= 2 && got[len(got)-1] == program
	})
	s.await("the shell's name again", func() bool {
		got := names()
		return got[len(got)-1] == first
	})

	late, err := dialEndpoint(mustEndpoint(t, s).address)
	if err != nil {
		t.Fatal(err)
	}
	defer late.Close()
	late.Write([]byte(`{"type":"attach"}` + "\n"))
	reader := bufio.NewReader(late)
	late.SetReadDeadline(time.Now().Add(10 * time.Second))
	for {
		line, err := reader.ReadBytes('\n')
		if err != nil {
			t.Fatalf("a late client never heard the name: %v", err)
		}
		var f frame
		json.Unmarshal(line, &f)
		if f.Type == "foreground" {
			if strings.ToLower(f.Name) != first {
				t.Fatalf("a late client heard %q, not %q", f.Name, first)
			}
			break
		}
	}
	s.send(map[string]any{"type": "kill"})
	s.exitCode()
}

func mustEndpoint(t *testing.T, s *session) endpoint {
	t.Helper()
	at, err := resolveEndpoint(s.dataDir, s.id)
	if err != nil {
		t.Fatal(err)
	}
	return at
}
