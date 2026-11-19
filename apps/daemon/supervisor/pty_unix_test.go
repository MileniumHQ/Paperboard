//go:build !windows

package main

import (
	"os"
	"testing"
)

// A shell forked a moment ago is still the supervisor until it starts its
// program. Here the "shell" is this test binary, so it keeps the name of the
// process asking for as long as it runs: it is never named the program in
// front.
func TestATerminalNeverNamesTheSupervisorAsTheProgramInFront(t *testing.T) {
	exited := make(chan int, 1)
	env := append(os.Environ(), helperEnv+"=sleep")
	work, err := startPty(os.Args[0], nil, 80, 24, t.TempDir(), env, func(string, string) {}, func(code int) { exited <- code })
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		work.kill("SIGKILL")
		<-exited
	}()
	reader := work.(foregroundReader)
	if name, err := reader.foreground(); err == nil {
		t.Fatalf("a terminal whose shell is still the supervisor named %q as the program in front", name)
	}
}
