//go:build !windows

package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A data folder can be deeper than a socket path may be long (macOS's
// temporary folders are). The supervisor still listens there, from where it
// was started, and its endpoint is reachable.
func TestListensUnderADataFolderTooDeepForASocketPath(t *testing.T) {
	sockets := filepath.Join(t.TempDir(), strings.Repeat("d", 60), strings.Repeat("e", 60), "sockets")
	if err := os.MkdirAll(sockets, 0o700); err != nil {
		t.Fatal(err)
	}
	address := filepath.Join(sockets, endpointName("deep")+".sock")
	if len(address) <= 108 {
		t.Fatalf("the path must pass every kernel's limit, but %s is %d bytes", address, len(address))
	}
	before, _ := os.Getwd()
	listener, err := listen(address)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	if after, _ := os.Getwd(); after != before {
		t.Fatalf("listen left the supervisor in %s, not %s", after, before)
	}
	if info, err := os.Stat(address); err != nil || info.Mode()&os.ModeSocket == 0 {
		t.Fatalf("no socket at %s: %v", address, err)
	}
	// a client reaches it the way the daemon does, by its name from inside the folder
	accepted := make(chan error, 1)
	go func() {
		conn, err := listener.Accept()
		if err == nil {
			conn.Close()
		}
		accepted <- err
	}()
	t.Chdir(sockets)
	conn, err := dialEndpoint(filepath.Base(address))
	if err != nil {
		t.Fatal(err)
	}
	conn.Close()
	if err := <-accepted; err != nil {
		t.Fatal(err)
	}
}
