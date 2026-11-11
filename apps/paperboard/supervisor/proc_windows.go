//go:build windows

package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/Microsoft/go-winio"
	"golang.org/x/sys/windows"
)

const relayFlag = "--console-relay"

const taskkillTimeout = 5 * time.Second

// Windows hands a child only the handles it is given by name, so there is
// nothing inherited to seal.
func sealInheritedFiles() {}

func listen(address string) (net.Listener, error) {
	listener, err := winio.ListenPipe(address, &winio.PipeConfig{InputBufferSize: 64 * 1024, OutputBufferSize: 64 * 1024})
	if err != nil {
		return nil, fmt.Errorf("could not listen on %s: %w", address, err)
	}
	return listener, nil
}

// Some programs read their input from a console and quit on a pipe (a Source
// dedicated server in -console mode). The supervisor has no console to give
// them: it runs detached. The relay, which the supervisor starts hidden, has
// a console with no window. It hands that console's input to the program and
// passes the program's output and exit code straight through.
func runConsoleRelay(command string, args []string) {
	fail := func(format string, values ...any) {
		fmt.Fprintf(os.Stderr, format+"\n", values...)
		os.Exit(1)
	}
	name, err := windows.UTF16PtrFromString("CONIN$")
	if err != nil {
		fail("Could not give %s a console to read: %v", command, err)
	}
	console, err := windows.CreateFile(name, windows.GENERIC_READ|windows.GENERIC_WRITE, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE, nil, windows.OPEN_EXISTING, 0, 0)
	if err != nil {
		fail("Could not give %s a console to read: %v", command, err)
	}
	input := os.NewFile(uintptr(console), "CONIN$")
	cwd, err := os.Getwd()
	if err != nil {
		fail("Could not start %s: %v", command, err)
	}
	program, err := findProgram(command, cwd, os.Environ())
	if err != nil {
		fail("Could not start %s: %v", command, spawnError(command, err))
	}
	cmd := &exec.Cmd{Path: program, Args: append([]string{command}, args...), Stdin: input, Stdout: os.Stdout, Stderr: os.Stderr}
	if err := cmd.Start(); err != nil {
		fail("Could not start %s: %v", command, spawnError(command, err))
	}
	input.Close()
	waitErr := cmd.Wait()
	if cmd.ProcessState == nil {
		fail("Could not wait for %s: %v", command, waitErr)
	}
	os.Exit(exitCode(cmd.ProcessState))
}

// Windows keeps the whole 32-bit code, which a crashed game (Unreal, .NET, a
// Source engine) ends with: 0xC0000005 is reported as it is.
func exitCode(state *os.ProcessState) int {
	return int(uint32(state.ExitCode()))
}

// a start failure as the daemon has always worded it: spawn <command> <CODE>
func spawnError(command string, err error) error {
	if errors.Is(err, os.ErrNotExist) || errors.Is(err, windows.ERROR_FILE_NOT_FOUND) || errors.Is(err, windows.ERROR_PATH_NOT_FOUND) {
		return fmt.Errorf("spawn %s ENOENT", command)
	}
	if errors.Is(err, windows.ERROR_ACCESS_DENIED) {
		return fmt.Errorf("spawn %s EACCES", command)
	}
	return fmt.Errorf("spawn %s failed: %w", command, err)
}

// Finds a program in the workload's own folder and search path, not the
// daemon's: the creator's Path (JAVA_HOME/bin joins it) decides which `java`
// runs. A name is tried as written only when it has an extension; .com and
// .exe are then tried after it, in each folder.
func findProgram(command, cwd string, env []string) (string, error) {
	base := command
	if at := strings.LastIndexAny(command, `\/:`); at != -1 {
		base = command[at+1:]
	}
	hasExtension := strings.Contains(base, ".")
	try := func(path string) (string, bool) {
		candidates := []string{path + ".com", path + ".exe"}
		if hasExtension {
			candidates = append([]string{path}, candidates...)
		}
		for _, candidate := range candidates {
			if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
				return candidate, true
			}
		}
		return "", false
	}
	absolute := func(path string) string {
		if filepath.IsAbs(path) {
			return path
		}
		return filepath.Join(cwd, path)
	}
	if base != command {
		if found, ok := try(absolute(command)); ok {
			return found, nil
		}
		return "", os.ErrNotExist
	}
	searchPath, _ := envValue(env, "PATH", true)
	for _, dir := range append([]string{cwd}, strings.Split(searchPath, ";")...) {
		dir = strings.Trim(dir, `"`)
		if dir == "" {
			continue
		}
		if found, ok := try(filepath.Join(absolute(dir), command)); ok {
			return found, nil
		}
	}
	return "", os.ErrNotExist
}

// Stops a process and everything it started. A child is often a wrapper
// (`cmd /c ping ...`) whose grandchild holds the output pipes: ending the
// wrapper alone would leave the workload looking alive forever.
func killTree(process *os.Process) error {
	root := os.Getenv("SystemRoot")
	if root == "" {
		root = `C:\Windows`
	}
	ctx, cancel := context.WithTimeout(context.Background(), taskkillTimeout)
	defer cancel()
	taskkill := exec.CommandContext(ctx, filepath.Join(root, "System32", "taskkill.exe"), "/PID", strconv.Itoa(process.Pid), "/T", "/F")
	taskkill.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: windows.CREATE_NO_WINDOW}
	err := taskkill.Run()
	if err == nil {
		return nil
	}
	// taskkill fails for a process that is already gone, and that is the goal
	if single := process.Kill(); single != nil && !errors.Is(single, os.ErrProcessDone) {
		return fmt.Errorf("taskkill of %d failed (%v), and so did ending the process alone: %w", process.Pid, err, single)
	}
	return nil
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

func (w *pipedWorkload) kill(string) error { return killTree(w.process) }

func startPiped(start pipedStart, onData func(stream, data string), onExit func(code int)) (workload, error) {
	command, args, takesInput := start.command, start.args, !start.noStdin
	if start.consoleInput {
		// the program runs behind the relay, which has a console; its input
		// is that console, so there is none to write here
		self, err := os.Executable()
		if err != nil {
			return nil, fmt.Errorf("the supervisor could not find itself to start a console: %w", err)
		}
		command, args, takesInput = self, append([]string{relayFlag, start.command}, start.args...), false
	}
	program, err := findProgram(command, start.cwd, start.env)
	if err != nil {
		return nil, spawnError(start.command, err)
	}
	cmd := &exec.Cmd{
		Path: program,
		Args: append([]string{command}, args...),
		Dir:  start.cwd,
		Env:  start.env,
		// a console program gets a console of its own with no window
		SysProcAttr: &syscall.SysProcAttr{HideWindow: true, CreationFlags: windows.CREATE_NO_WINDOW},
	}
	var stdin io.WriteCloser
	if takesInput {
		if stdin, err = cmd.StdinPipe(); err != nil {
			return nil, spawnError(start.command, err)
		}
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, spawnError(start.command, err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, spawnError(start.command, err)
	}
	if err := cmd.Start(); err != nil {
		return nil, spawnError(start.command, err)
	}

	work := &pipedWorkload{process: cmd.Process, encoding: start.inputEncoding}
	if stdin != nil {
		// a workload that closed its input is not an error worth a line per write
		work.input = newAsyncWriter(stdin, nil)
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
	go pump("stdout", stdout)
	go pump("stderr", stderr)
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
