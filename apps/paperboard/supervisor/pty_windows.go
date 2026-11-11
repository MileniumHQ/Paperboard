//go:build windows

package main

import (
	"fmt"
	"os"
	"sync"
	"time"
	"unicode/utf16"
	"unsafe"

	"golang.org/x/sys/windows"
)

// how long a terminal's last output has to arrive after its shell exits
const ptyDrainTimeout = 500 * time.Millisecond

// A terminal on Windows: a pseudoconsole (ConPTY) with the shell attached.
type ptyWorkload struct {
	process *os.Process
	console windows.Handle
	input   *asyncWriter
	closing sync.Once
}

func (w *ptyWorkload) pid() int { return w.process.Pid }

func (w *ptyWorkload) write(data []byte) error { return w.input.write(data) }

func (w *ptyWorkload) resize(cols, rows int) error {
	if cols <= 0 || rows <= 0 || cols > 32767 || rows > 32767 {
		return fmt.Errorf("a terminal cannot be %dx%d", cols, rows)
	}
	return windows.ResizePseudoConsole(w.console, windows.Coord{X: int16(cols), Y: int16(rows)})
}

func (w *ptyWorkload) kill(string) error { return killTree(w.process) }

// closing the pseudoconsole ends whatever is still attached to it
func (w *ptyWorkload) closeConsole() {
	w.closing.Do(func() { windows.ClosePseudoConsole(w.console) })
}

func environmentBlock(env []string) *uint16 {
	var block []uint16
	for _, entry := range env {
		block = append(block, utf16.Encode([]rune(entry))...)
		block = append(block, 0)
	}
	block = append(block, 0, 0)
	return &block[0]
}

func startPty(shell string, args []string, cols, rows int, cwd string, env []string, onData func(stream, data string), onExit func(code int)) (workload, error) {
	program, err := findProgram(shell, cwd, env)
	if err != nil {
		return nil, spawnError(shell, err)
	}
	if cols > 32767 || rows > 32767 {
		return nil, fmt.Errorf("a terminal cannot be %dx%d", cols, rows)
	}

	// the shell reads inputRead and writes outputWrite, through the console
	var inputRead, inputWrite, outputRead, outputWrite windows.Handle
	if err := windows.CreatePipe(&inputRead, &inputWrite, nil, 0); err != nil {
		return nil, fmt.Errorf("no terminal input could be opened: %w", err)
	}
	if err := windows.CreatePipe(&outputRead, &outputWrite, nil, 0); err != nil {
		windows.CloseHandle(inputRead)
		windows.CloseHandle(inputWrite)
		return nil, fmt.Errorf("no terminal output could be opened: %w", err)
	}
	closeAll := func(handles ...windows.Handle) {
		for _, handle := range handles {
			windows.CloseHandle(handle)
		}
	}

	var console windows.Handle
	if err := windows.CreatePseudoConsole(windows.Coord{X: int16(cols), Y: int16(rows)}, inputRead, outputWrite, 0, &console); err != nil {
		closeAll(inputRead, inputWrite, outputRead, outputWrite)
		return nil, fmt.Errorf("Windows could not create a terminal (it needs Windows 10 1809 or later): %w", err)
	}
	// the console holds its own copies of its ends
	closeAll(inputRead, outputWrite)
	failed := func(err error) (workload, error) {
		windows.ClosePseudoConsole(console)
		closeAll(inputWrite, outputRead)
		return nil, err
	}

	attributes, err := windows.NewProcThreadAttributeList(1)
	if err != nil {
		return failed(fmt.Errorf("the terminal could not be attached: %w", err))
	}
	defer attributes.Delete()
	// the attribute's value is the console handle itself, not a pointer to it
	if err := attributes.Update(windows.PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE, *(*unsafe.Pointer)(unsafe.Pointer(&console)), unsafe.Sizeof(console)); err != nil {
		return failed(fmt.Errorf("the terminal could not be attached: %w", err))
	}

	startup := &windows.StartupInfoEx{ProcThreadAttributeList: attributes.List()}
	startup.Cb = uint32(unsafe.Sizeof(*startup))
	// Named with no handles, so the shell takes the console's. Without this
	// it can be handed the supervisor's own redirected output instead.
	startup.Flags = windows.STARTF_USESTDHANDLES

	programPtr, err := windows.UTF16PtrFromString(program)
	if err != nil {
		return failed(spawnError(shell, err))
	}
	commandLine, err := windows.UTF16PtrFromString(windows.ComposeCommandLine(append([]string{shell}, args...)))
	if err != nil {
		return failed(spawnError(shell, err))
	}
	cwdPtr, err := windows.UTF16PtrFromString(cwd)
	if err != nil {
		return failed(spawnError(shell, err))
	}
	var info windows.ProcessInformation
	flags := uint32(windows.EXTENDED_STARTUPINFO_PRESENT | windows.CREATE_UNICODE_ENVIRONMENT)
	if err := windows.CreateProcess(programPtr, commandLine, nil, nil, false, flags, environmentBlock(env), cwdPtr, &startup.StartupInfo, &info); err != nil {
		return failed(spawnError(shell, err))
	}
	windows.CloseHandle(info.Thread)

	process, err := os.FindProcess(int(info.ProcessId))
	if err != nil {
		windows.TerminateProcess(info.Process, 1)
		windows.CloseHandle(info.Process)
		return failed(fmt.Errorf("the shell started but could not be followed: %w", err))
	}
	work := &ptyWorkload{process: process, console: console}
	work.input = newAsyncWriter(os.NewFile(uintptr(inputWrite), "terminal-input"), nil)
	output := os.NewFile(uintptr(outputRead), "terminal-output")

	drained := make(chan struct{})
	go func() {
		defer close(drained)
		var decoder utf8Stream
		buffer := make([]byte, 32*1024)
		for {
			n, err := output.Read(buffer)
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
		code := 1
		if _, err := windows.WaitForSingleObject(info.Process, windows.INFINITE); err != nil {
			onData("stdout", fmt.Sprintf("\n[Process Error] %v\n", err))
		} else {
			var exit uint32
			if err := windows.GetExitCodeProcess(info.Process, &exit); err != nil {
				onData("stdout", fmt.Sprintf("\n[Process Error] the shell's exit code could not be read: %v\n", err))
			} else {
				code = int(exit)
			}
		}
		windows.CloseHandle(info.Process)
		// the console writes what it still holds as it closes; the reader
		// above keeps taking it, so the close cannot wait on a full pipe
		work.closeConsole()
		select {
		case <-drained:
		case <-time.After(ptyDrainTimeout):
		}
		onExit(code)
		work.input.close()
		output.Close()
	}()
	return work, nil
}
