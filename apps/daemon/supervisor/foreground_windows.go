//go:build windows

package main

import (
	"fmt"
	"path/filepath"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

// A pseudoconsole has no foreground process group, so the program in front
// is the newest one the shell started, followed down to the newest one that
// started: `npm run dev` is shown by the node it ends in, as a Unix terminal
// would show it.
func (w *ptyWorkload) foreground() (string, error) {
	snapshot, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return "", fmt.Errorf("the running processes could not be listed: %w", err)
	}
	defer windows.CloseHandle(snapshot)

	names := map[uint32]string{}
	children := map[uint32][]uint32{}
	var entry windows.ProcessEntry32
	entry.Size = uint32(unsafe.Sizeof(entry))
	for err = windows.Process32First(snapshot, &entry); err == nil; err = windows.Process32Next(snapshot, &entry) {
		name := windows.UTF16ToString(entry.ExeFile[:])
		names[entry.ProcessID] = name
		// a console host serves a program; it is not one the user ran
		if lower := strings.ToLower(name); lower == "conhost.exe" || lower == "openconsole.exe" {
			continue
		}
		children[entry.ParentProcessID] = append(children[entry.ParentProcessID], entry.ProcessID)
	}
	if err != windows.ERROR_NO_MORE_FILES {
		return "", fmt.Errorf("the running processes could not be read: %w", err)
	}

	pid := uint32(w.process.Pid)
	if _, ok := names[pid]; !ok {
		return "", fmt.Errorf("the shell (process %d) is gone", pid)
	}
	// a process id can be reused, so a child must be younger than its parent
	seen := map[uint32]bool{pid: true}
	parentStarted := startTime(pid)
	for {
		newest, newestStarted := uint32(0), int64(0)
		for _, child := range children[pid] {
			started := startTime(child)
			if seen[child] || started == 0 || started < parentStarted {
				continue
			}
			if started > newestStarted {
				newest, newestStarted = child, started
			}
		}
		if newest == 0 {
			break
		}
		seen[newest] = true
		pid, parentStarted = newest, newestStarted
	}
	name := names[pid]
	return strings.TrimSuffix(name, filepath.Ext(name)), nil
}

// when a process started, in 100ns ticks; 0 when it can't be asked
func startTime(pid uint32) int64 {
	handle, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		return 0
	}
	defer windows.CloseHandle(handle)
	var created, exited, kernel, user windows.Filetime
	if err := windows.GetProcessTimes(handle, &created, &exited, &kernel, &user); err != nil {
		return 0
	}
	return int64(created.HighDateTime)<<32 | int64(created.LowDateTime)
}
