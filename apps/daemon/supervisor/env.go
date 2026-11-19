package main

import (
	"os"
	"regexp"
	"runtime"
	"strings"
)

// The environment a workload starts with: the supervisor's own, which is the
// daemon's, then extra, then what the creator asked for.
//
// PWD names the workload's own working directory. Inherited, it would name
// the daemon's, and programs that trust PWD over getcwd (`opencode run` does)
// would work there instead of where they were started.
//
// Windows names are case-blind and its search path is usually "Path": a name
// is found by any case there and never added beside the one already set (a
// child given both would search only one).
func workloadEnv(base []string, configEnv map[string]any, cwd string, extra map[string]string) []string {
	return buildEnv(base, configEnv, cwd, extra, runtime.GOOS == "windows")
}

func buildEnv(base []string, configEnv map[string]any, cwd string, extra map[string]string, windows bool) []string {
	env := newEnvList(windows)
	for _, entry := range base {
		// Windows keeps per-drive folders as "=C:=C:\path": the name starts with "="
		at := strings.Index(entry[min(1, len(entry)):], "=")
		if at == -1 {
			continue
		}
		env.set(entry[:at+1], entry[at+2:])
	}
	for name, value := range extra {
		env.set(name, value)
	}
	for name, value := range configEnv {
		if value == nil {
			env.unset(name)
			continue
		}
		env.set(name, jsString(value))
	}
	if javaHome, ok := configEnv["JAVA_HOME"].(string); ok && javaHome != "" {
		separator := ":"
		if windows {
			separator = ";"
		}
		env.set("PATH", javaHome+"/bin"+separator+env.get("PATH"))
	}
	env.set("PWD", cwd)
	env.unset("OLDPWD")
	return env.list()
}

// Variables in the order they were first set. On Windows a name matches
// whatever its case and keeps the spelling it was first given.
type envList struct {
	windows bool
	names   []string
	values  map[string]string
	spelled map[string]string
}

func newEnvList(windows bool) *envList {
	return &envList{windows: windows, values: map[string]string{}, spelled: map[string]string{}}
}

func (e *envList) key(name string) string {
	if e.windows {
		return strings.ToUpper(name)
	}
	return name
}

func (e *envList) set(name, value string) {
	key := e.key(name)
	if _, known := e.values[key]; !known {
		e.names = append(e.names, key)
		e.spelled[key] = name
	}
	e.values[key] = value
}

func (e *envList) unset(name string) {
	key := e.key(name)
	if _, known := e.values[key]; !known {
		return
	}
	delete(e.values, key)
	delete(e.spelled, key)
	for i, existing := range e.names {
		if existing == key {
			e.names = append(e.names[:i], e.names[i+1:]...)
			break
		}
	}
}

func (e *envList) get(name string) string {
	return e.values[e.key(name)]
}

func (e *envList) list() []string {
	out := make([]string, 0, len(e.names))
	for _, key := range e.names {
		out = append(out, e.spelled[key]+"="+e.values[key])
	}
	return out
}

// one variable out of an environment list
func envValue(env []string, name string, windows bool) (string, bool) {
	for _, entry := range env {
		at := strings.Index(entry[min(1, len(entry)):], "=")
		if at == -1 {
			continue
		}
		key := entry[:at+1]
		if key == name || (windows && strings.EqualFold(key, name)) {
			return entry[at+2:], true
		}
	}
	return "", false
}

// A Windows batch file (.cmd/.bat) cannot be started without a shell, and a
// refusal that surfaces as "did not become ready" hides the cause: it is
// named instead. Running one is a shell decision for the caller. Windows
// ignores trailing dots and spaces in a name, so "a.cmd. " is a.cmd.
var batchName = regexp.MustCompile(`(?i)\.(?:cmd|bat)[. ]*$`)

func batchFileRefusal(command string) string {
	return batchRefusal(command, runtime.GOOS == "windows")
}

func batchRefusal(command string, windows bool) string {
	if !windows || !batchName.MatchString(command) {
		return ""
	}
	return `"` + command + `" is a batch file and cannot be started directly; batch files must be run via cmd.exe /c with static args (command "cmd.exe", args ["/c", "` + command + `", ...])`
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// the shell a terminal runs when its creator named none
func defaultShell() string {
	switch runtime.GOOS {
	case "windows":
		if comspec := os.Getenv("COMSPEC"); comspec != "" {
			return comspec
		}
		return "powershell.exe"
	case "darwin":
		for _, shell := range []string{"/bin/zsh", "/bin/bash"} {
			if fileExists(shell) {
				return shell
			}
		}
		return "/bin/sh"
	}
	if shell := os.Getenv("SHELL"); shell != "" && fileExists(shell) {
		return shell
	}
	for _, shell := range []string{"/bin/bash", "/usr/bin/bash"} {
		if fileExists(shell) {
			return shell
		}
	}
	return "/bin/sh"
}
