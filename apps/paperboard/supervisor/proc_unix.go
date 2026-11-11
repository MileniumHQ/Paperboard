//go:build !windows

package main

import (
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
)

const relayFlag = "--console-relay"

// The console relay exists for Windows programs that read a console. A pipe
// is a program's console everywhere else, so nothing starts one here.
func runConsoleRelay(command string, _ []string) {
	fmt.Fprintf(os.Stderr, "%s is only for Windows; %s was not started\n", relayFlag, command)
	os.Exit(1)
}

// Lets go of what this process was handed beyond its own input and output. A
// supervisor is started by a daemon that can hold files it never marked as
// its own (a browser engine's sockets), and a supervisor outlives that
// daemon: it would keep the daemon's listening ports bound after the app has
// quit, and so would every workload it starts.
//
// Sockets are closed: this process has opened none yet, so each one came from
// the daemon. Anything else is only kept from the workload, since the
// runtime's own descriptors cannot be told apart from inherited ones.
func sealInheritedFiles() {
	entries, err := os.ReadDir("/dev/fd")
	if err != nil {
		fmt.Fprintf(os.Stderr, "[supervisor] could not list the files it was started with: %v\n", err)
		return
	}
	for _, entry := range entries {
		fd, err := strconv.Atoi(entry.Name())
		if err != nil || fd < 3 {
			continue
		}
		var info syscall.Stat_t
		if err := syscall.Fstat(fd, &info); err != nil {
			continue // the listing's own descriptor, gone by now
		}
		if info.Mode&syscall.S_IFMT == syscall.S_IFSOCK {
			syscall.Close(fd)
			continue
		}
		syscall.CloseOnExec(fd)
	}
}

func listen(address string) (net.Listener, error) {
	// the kernel's limit on a socket path, which fails as a bare EINVAL
	limit := 107
	if runtime.GOOS == "darwin" {
		limit = 103
	}
	if len(address) > limit {
		return nil, fmt.Errorf("the Paperboard data folder's path is too long for a socket: %s is %d bytes and the limit is %d", address, len(address), limit)
	}
	listener, err := net.Listen("unix", address)
	if err != nil {
		return nil, fmt.Errorf("could not listen on %s: %w", address, err)
	}
	// the path is unlinked by hand during teardown, never by a close
	listener.(*net.UnixListener).SetUnlinkOnClose(false)
	return listener, nil
}

var signalNumbers = map[string]syscall.Signal{
	"SIGHUP":  syscall.SIGHUP,
	"SIGINT":  syscall.SIGINT,
	"SIGQUIT": syscall.SIGQUIT,
	"SIGABRT": syscall.SIGABRT,
	"SIGKILL": syscall.SIGKILL,
	"SIGUSR1": syscall.SIGUSR1,
	"SIGUSR2": syscall.SIGUSR2,
	"SIGALRM": syscall.SIGALRM,
	"SIGTERM": syscall.SIGTERM,
	"SIGCONT": syscall.SIGCONT,
	"SIGSTOP": syscall.SIGSTOP,
	"SIGTSTP": syscall.SIGTSTP,
}

// Signals the workload's whole process group: it leads one, so everything it
// started stops with it. A child is often a wrapper (`sh -c "a; b"`) whose
// grandchild holds the output pipes; ending the wrapper alone would leave the
// workload looking alive forever.
func signalGroup(pid int, name string) error {
	number, ok := signalNumbers[name]
	if !ok {
		return fmt.Errorf("unknown signal %s", name)
	}
	err := syscall.Kill(-pid, number)
	if err == nil || errors.Is(err, syscall.ESRCH) {
		// no process left in the group: the workload is already gone
		return nil
	}
	if single := syscall.Kill(pid, number); single != nil && !errors.Is(single, syscall.ESRCH) {
		return fmt.Errorf("signalling group %d failed (%v), and so did the process alone: %w", pid, err, single)
	}
	return nil
}

// The exit code a workload's observers see. One ended by a signal has no exit
// code; reporting 0 would read as clean success, so it is the shell
// convention 128 + signal number instead.
func exitCode(state *os.ProcessState) int {
	if status, ok := state.Sys().(syscall.WaitStatus); ok && status.Signaled() {
		return 128 + int(status.Signal())
	}
	if code := state.ExitCode(); code >= 0 {
		return code
	}
	return 1
}

var errnoNames = map[syscall.Errno]string{
	syscall.ENOENT:  "ENOENT",
	syscall.EACCES:  "EACCES",
	syscall.EPERM:   "EPERM",
	syscall.ENOEXEC: "ENOEXEC",
	syscall.ENOTDIR: "ENOTDIR",
	syscall.EISDIR:  "EISDIR",
	syscall.E2BIG:   "E2BIG",
	syscall.ENOMEM:  "ENOMEM",
	syscall.ELOOP:   "ELOOP",
	syscall.ETXTBSY: "ETXTBSY",
}

// a start failure as the daemon has always worded it: spawn <command> <CODE>
func spawnError(command string, err error) error {
	var errno syscall.Errno
	if errors.As(err, &errno) {
		if name, ok := errnoNames[errno]; ok {
			return fmt.Errorf("spawn %s %s", command, name)
		}
	}
	return fmt.Errorf("spawn %s failed: %w", command, err)
}

// Finds a program the way a shell would, but in the workload's own search
// path and from its own folder: the creator's PATH (JAVA_HOME/bin joins it)
// decides which `java` runs, not the daemon's.
func findProgram(command, cwd string, env []string) (string, error) {
	if strings.Contains(command, "/") {
		return command, nil
	}
	searchPath, ok := envValue(env, "PATH", false)
	if !ok {
		searchPath = "/usr/local/bin:/usr/bin:/bin"
	}
	var denied error
	for _, dir := range strings.Split(searchPath, ":") {
		if dir == "" {
			dir = "."
		}
		if !filepath.IsAbs(dir) {
			dir = filepath.Join(cwd, dir)
		}
		candidate := filepath.Join(dir, command)
		info, err := os.Stat(candidate)
		if err != nil || info.IsDir() {
			continue
		}
		if err := syscall.Access(candidate, 1); err != nil {
			denied = syscall.EACCES
			continue
		}
		return candidate, nil
	}
	if denied != nil {
		return "", denied
	}
	return "", syscall.ENOENT
}

type pipedStart struct {
	command       string
	args          []string
	cwd           string
	env           []string
	noStdin       bool
	inputEncoding string
	consoleInput  bool
}

type pipedWorkload struct {
	process  *os.Process
	input    *asyncWriter
	encoding string
}

func (w *pipedWorkload) pid() int { return w.process.Pid }

func (w *pipedWorkload) write(data []byte) error {
	if w.input == nil {
		return nil
	}
	return w.input.write(encodeInput(string(data), w.encoding))
}

func (w *pipedWorkload) resize(int, int) error { return nil }

func (w *pipedWorkload) kill(signal string) error { return signalGroup(w.process.Pid, signal) }

func startPiped(start pipedStart, onData func(stream, data string), onExit func(code int)) (workload, error) {
	program, err := findProgram(start.command, start.cwd, start.env)
	if err != nil {
		return nil, spawnError(start.command, err)
	}
	newCommand := func(program string, argv []string) *exec.Cmd {
		return &exec.Cmd{
			Path: program,
			Args: argv,
			Dir:  start.cwd,
			Env:  start.env,
			// its own session and process group: a signal to the group reaches
			// everything it started, and the daemon's terminal is not its own
			SysProcAttr: &syscall.SysProcAttr{Setsid: true},
		}
	}
	type pipes struct {
		stdin          io.WriteCloser
		stdout, stderr io.ReadCloser
	}
	launch := func(cmd *exec.Cmd) (pipes, error) {
		var p pipes
		var err error
		if !start.noStdin {
			if p.stdin, err = cmd.StdinPipe(); err != nil {
				return p, err
			}
		}
		if p.stdout, err = cmd.StdoutPipe(); err != nil {
			return p, err
		}
		if p.stderr, err = cmd.StderrPipe(); err != nil {
			return p, err
		}
		return p, cmd.Start()
	}

	cmd := newCommand(program, append([]string{start.command}, start.args...))
	io_, err := launch(cmd)
	if errors.Is(err, syscall.ENOEXEC) {
		// a script with no interpreter line runs under sh, as it does from a shell
		cmd = newCommand("/bin/sh", append([]string{"sh", program}, start.args...))
		io_, err = launch(cmd)
	}
	if err != nil {
		return nil, spawnError(start.command, err)
	}

	work := &pipedWorkload{process: cmd.Process, encoding: start.inputEncoding}
	if io_.stdin != nil {
		// a workload that closed its input is not an error worth a line per write
		work.input = newAsyncWriter(io_.stdin, nil)
	}

	var streams sync.WaitGroup
	pump := func(stream string, from io.Reader) {
		defer streams.Done()
		var decoder utf8Stream
		buffer := make([]byte, 32*1024)
		for {
			n, err := from.Read(buffer)
			if n > 0 {
				onData(stream, decoder.feed(buffer[:n]))
			}
			if err != nil {
				onData(stream, decoder.flush())
				return
			}
		}
	}
	streams.Add(2)
	go pump("stdout", io_.stdout)
	go pump("stderr", io_.stderr)
	go func() {
		// the exit is reported once the output has been read to its end, so
		// the last lines always arrive before it
		streams.Wait()
		err := cmd.Wait()
		if cmd.ProcessState == nil {
			onData("stderr", fmt.Sprintf("\n[Process Error] %v\n", err))
			onExit(1)
			return
		}
		onExit(exitCode(cmd.ProcessState))
	}()
	return work, nil
}
