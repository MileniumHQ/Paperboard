package main

import (
	"bytes"
	"fmt"

	"golang.org/x/sys/unix"
)

// a process's name as the kernel keeps it (at most 16 bytes)
func processName(pid int) (string, error) {
	info, err := unix.SysctlKinfoProc("kern.proc.pid", pid)
	if err != nil {
		return "", fmt.Errorf("process %d has no name to read: %w", pid, err)
	}
	comm := info.Proc.P_comm[:]
	if end := bytes.IndexByte(comm, 0); end >= 0 {
		comm = comm[:end]
	}
	if len(comm) == 0 {
		return "", fmt.Errorf("process %d is gone", pid)
	}
	return string(comm), nil
}
