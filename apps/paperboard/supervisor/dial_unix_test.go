//go:build !windows

package main

import (
	"net"
	"syscall"
)

func dialEndpoint(address string) (net.Conn, error) { return net.Dial("unix", address) }

func processAlive(pid int) bool { return syscall.Kill(pid, 0) == nil }
