//go:build !windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"syscall"
	"time"

	"github.com/creack/pty"
	"golang.org/x/sys/unix"
)

// how long a terminal's last output has to arrive after its shell exits; a
// background job can hold the terminal open long after
const ptyDrainTimeout = 250 * time.Millisecond

type ptyWorkload struct {
	process *os.Process
	master  *os.File
	input   *asyncWriter
}

func (w *ptyWorkload) pid() int { return w.process.Pid }

func (w *ptyWorkload) write(data []byte) error { return w.input.write(data) }

// a terminal's input is the terminal itself: it stays open while it runs
func (w *ptyWorkload) closeInput() error {
	return fmt.Errorf("a terminal's input can't be closed")
}

func (w *ptyWorkload) resize(cols, rows int) error {
	if cols <= 0 || rows <= 0 {
		return fmt.Errorf("a terminal cannot be %dx%d", cols, rows)
	}
	return pty.Setsize(w.master, &pty.Winsize{Cols: uint16(cols), Rows: uint16(rows)})
}

// A hangup, as closing a terminal window sends: an interactive shell ignores
// SIGTERM but ends on this one, and takes its jobs with it.
func (w *ptyWorkload) kill(string) error { return signalGroup(w.process.Pid, "SIGHUP") }

// The terminal's foreground process group is the job the keyboard reaches:
// the shell at its prompt, or what it runs. Its leader names it (the first
// program of a pipeline).
func (w *ptyWorkload) foreground() (string, error) {
	conn, err := w.master.SyscallConn()
	if err != nil {
		return "", fmt.Errorf("the terminal cannot be asked: %w", err)
	}
	group, groupErr := 0, error(nil)
	if err := conn.Control(func(fd uintptr) {
		group, groupErr = unix.IoctlGetInt(int(fd), unix.TIOCGPGRP)
	}); err != nil {
		return "", fmt.Errorf("the terminal cannot be asked: %w", err)
	}
	if groupErr != nil {
		return "", fmt.Errorf("the terminal has no foreground job: %w", groupErr)
	}
	return processName(group)
}

// keeps a file open for a writer that must not close it
type keepOpen struct{ file *os.File }

func (k keepOpen) Write(data []byte) (int, error) { return k.file.Write(data) }
func (k keepOpen) Close() error                   { return nil }

func startPty(shell string, args []string, cols, rows int, cwd string, env []string, onData func(stream, data string), onExit func(code int)) (workload, error) {
	program, err := findProgram(shell, cwd, env)
	if err != nil {
		return nil, spawnError(shell, err)
	}
	master, slave, err := pty.Open()
	if err != nil {
		return nil, fmt.Errorf("no terminal could be opened: %w", err)
	}
	defer slave.Close()

	// A terminal as a terminal emulator sets one up. The kernel's default
	// leaves UTF-8 input handling off, so erasing a multibyte character in a
	// program that reads lines (cat, read) would remove one byte of it.
	if termios, err := unix.IoctlGetTermios(int(slave.Fd()), ioctlGetTermios); err == nil {
		termios.Iflag |= unix.ICRNL | unix.IXON | unix.IXANY | unix.IMAXBEL | unix.BRKINT | unix.IUTF8
		if err := unix.IoctlSetTermios(int(slave.Fd()), ioctlSetTermios, termios); err != nil {
			master.Close()
			return nil, fmt.Errorf("the terminal could not be set up: %w", err)
		}
	} else {
		master.Close()
		return nil, fmt.Errorf("the terminal could not be read: %w", err)
	}
	if err := pty.Setsize(master, &pty.Winsize{Cols: uint16(cols), Rows: uint16(rows)}); err != nil {
		master.Close()
		return nil, fmt.Errorf("the terminal could not be sized: %w", err)
	}

	cmd := &exec.Cmd{
		Path:   program,
		Args:   append([]string{shell}, args...),
		Dir:    cwd,
		Env:    env,
		Stdin:  slave,
		Stdout: slave,
		Stderr: slave,
		// its own session with the terminal as its controlling one: without
		// that an interactive shell has no job control
		SysProcAttr: &syscall.SysProcAttr{Setsid: true, Setctty: true},
	}
	if err := cmd.Start(); err != nil {
		master.Close()
		return nil, spawnError(shell, err)
	}

	work := &ptyWorkload{process: cmd.Process, master: master}
	work.input = newAsyncWriter(keepOpen{master}, nil)

	drained := make(chan struct{})
	go func() {
		defer close(drained)
		var decoder utf8Stream
		buffer := make([]byte, 32*1024)
		for {
			n, err := master.Read(buffer)
			if n > 0 {
				onData("stdout", decoder.feed(buffer[:n]))
			}
			if err != nil {
				onData("stdout", decoder.flush())
				return
			}
		}
	}()
	go func() {
		err := cmd.Wait()
		select {
		case <-drained:
		case <-time.After(ptyDrainTimeout):
		}
		code := 1
		if cmd.ProcessState != nil {
			code = exitCode(cmd.ProcessState)
		} else {
			onData("stdout", fmt.Sprintf("\n[Process Error] %v\n", err))
		}
		onExit(code)
		work.input.close()
		master.Close()
	}()
	return work, nil
}
