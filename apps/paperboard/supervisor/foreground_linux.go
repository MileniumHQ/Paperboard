package main

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

// a process's name as the kernel keeps it (at most 15 bytes)
func processName(pid int) (string, error) {
	comm, err := os.ReadFile("/proc/" + strconv.Itoa(pid) + "/comm")
	if err != nil {
		return "", fmt.Errorf("process %d has no name to read: %w", pid, err)
	}
	return strings.TrimSpace(string(comm)), nil
}
