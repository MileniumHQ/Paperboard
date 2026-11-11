// The workload supervisor: one small detached process per supervised
// workload (a game server, a terminal, a bot runtime), so the workload
// outlives the app or daemon that started it and the next one adopts it.
//
//	paperboard-supervisor --data-dir <paperboard dir> --supervise <id>
//	paperboard-supervisor --console-relay <command> [args...]   (Windows)
//
// The spawn config arrives as JSON on stdin. The supervisor serves the
// workload's output and takes its input over a unix socket (a named pipe on
// Windows) in <data dir>/sockets, as JSON lines; papercrane/supervisor.ts
// holds the client. It is its own binary so a workload costs a few megabytes
// to supervise instead of a whole JavaScript runtime.
package main

import (
	"fmt"
	"os"
)

func main() {
	args := os.Args[1:]
	if at := indexOf(args, relayFlag); at != -1 {
		if at+1 >= len(args) {
			fmt.Fprintf(os.Stderr, "%s needs the program to run\n", relayFlag)
			os.Exit(1)
		}
		runConsoleRelay(args[at+1], args[at+2:])
		return
	}

	dataDir := flagValue(args, "--data-dir")
	id := flagValue(args, "--supervise")
	if id == "" {
		fmt.Fprintln(os.Stderr, "[supervisor] started without --supervise <id>")
		os.Exit(1)
	}
	if dataDir == "" {
		fmt.Fprintln(os.Stderr, "[supervisor] started without --data-dir <dir>")
		os.Exit(1)
	}
	if err := runSupervisor(dataDir, id); err != nil {
		fmt.Fprintf(os.Stderr, "[supervisor] %s failed: %v\n", id, err)
		os.Exit(1)
	}
}

func indexOf(args []string, flag string) int {
	for i, arg := range args {
		if arg == flag {
			return i
		}
	}
	return -1
}

func flagValue(args []string, flag string) string {
	at := indexOf(args, flag)
	if at == -1 || at+1 >= len(args) {
		return ""
	}
	return args[at+1]
}
