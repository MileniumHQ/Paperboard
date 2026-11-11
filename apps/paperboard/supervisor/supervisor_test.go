package main

import (
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
)

// papercrane/supervisor.ts computes the same names to connect
func TestEndpointNamesMatchTheDaemon(t *testing.T) {
	for _, id := range []string{"survivor", "a.b", strings.Repeat("y", 128)} {
		if got := endpointName(id); len(got) != 32 {
			t.Fatalf("endpointName(%q) = %q, not 32 characters", id, got)
		}
	}
	if endpointName("a.b") == endpointName("a_b") {
		t.Fatal("two ids share an endpoint")
	}
	// sha256("abc") starts ba7816bf8f01cfea414140de5dae2223
	if got := endpointName("abc"); got != "ba7816bf8f01cfea414140de5dae2223" {
		t.Fatalf("endpointName(abc) = %s", got)
	}
}

func TestConfigIsReadAsTheDaemonWritesIt(t *testing.T) {
	cfg, err := parseConfig([]byte(`{"command":"java","args":["-jar","a b.jar",5],"cwd":"/srv","env":{"A":"1","N":7,"GONE":null},"cols":120,"rows":40,"noStdin":true,"important":true,"appId":"dev.x"}`))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.command != "java" || cfg.cwd != "/srv" || !cfg.noStdin || cfg.cols != 120 || cfg.rows != 40 || cfg.pty {
		t.Fatalf("unexpected config: %+v", cfg)
	}
	if !reflect.DeepEqual(cfg.args, []string{"-jar", "a b.jar", "5"}) {
		t.Fatalf("args = %#v", cfg.args)
	}
	for _, text := range []string{`{"isPty":true}`, `{"type":"pty"}`} {
		pty, err := parseConfig([]byte(text))
		if err != nil || !pty.pty {
			t.Fatalf("%s is a terminal: %+v %v", text, pty, err)
		}
	}
	if empty, err := parseConfig([]byte("  \n")); err != nil || empty.command != "" {
		t.Fatalf("an empty config is a default shell: %+v %v", empty, err)
	}
	for _, bad := range []string{`{`, `[]`, `{"inputEncoding":"latin1"}`} {
		if _, err := parseConfig([]byte(bad)); err == nil {
			t.Fatalf("%s was accepted", bad)
		}
	}
}

// what the daemon that adopts a workload reads back, with no secret in it
func TestMetadataKeepsTheConfigAndHidesSecrets(t *testing.T) {
	cfg, err := parseConfig([]byte(`{"command":"bot","important":true,"env":{"DISCORD_TOKEN":"abc","api_key":"k","Secret":"s","PORT":"8080"}}`))
	if err != nil {
		t.Fatal(err)
	}
	meta := cfg.metadata("bot-1", 4242)
	if meta.ID != "bot-1" || meta.ChildPid != 4242 || meta.Pid != os.Getpid() || meta.IsPty {
		t.Fatalf("unexpected metadata: %+v", meta)
	}
	if meta.Config["important"] != true || meta.Config["command"] != "bot" {
		t.Fatalf("the config was not kept: %+v", meta.Config)
	}
	want := map[string]string{"DISCORD_TOKEN": redacted, "api_key": redacted, "Secret": redacted, "PORT": "8080"}
	if !reflect.DeepEqual(meta.Config["env"], want) {
		t.Fatalf("env = %#v", meta.Config["env"])
	}
	if cfg.env["DISCORD_TOKEN"] != "abc" {
		t.Fatal("redacting the metadata changed what the workload is given")
	}
	// a terminal's shell is recorded as the supervisor itself
	if got := cfg.metadata("t", 0).ChildPid; got != os.Getpid() {
		t.Fatalf("childPid = %d", got)
	}
}

func TestWorkloadEnvironment(t *testing.T) {
	base := []string{"PATH=/usr/bin", "HOME=/home/u", "PWD=/daemon", "OLDPWD=/old", "KEEP=1"}
	config := map[string]any{"JAVA_HOME": "/java", "KEEP": nil, "N": float64(3)}
	got := buildEnv(base, config, "/srv/mc", map[string]string{"TERM": "xterm-256color"}, false)
	env := map[string]string{}
	for _, entry := range got {
		name, value, _ := strings.Cut(entry, "=")
		env[name] = value
	}
	want := map[string]string{"PATH": "/java/bin:/usr/bin", "HOME": "/home/u", "PWD": "/srv/mc", "TERM": "xterm-256color", "JAVA_HOME": "/java", "N": "3"}
	if !reflect.DeepEqual(env, want) {
		t.Fatalf("env = %#v", env)
	}

	// Windows: one search path whatever its case, and per-drive folders survive
	windows := buildEnv([]string{`Path=C:\Windows\System32`, `=C:=C:\Users\u`, "ComSpec=cmd.exe"}, map[string]any{"JAVA_HOME": `C:\java`, "PATH": `C:\tools`}, `C:\srv`, nil, true)
	var paths []string
	drive := false
	for _, entry := range windows {
		if strings.HasPrefix(strings.ToUpper(entry), "PATH=") {
			paths = append(paths, entry)
		}
		if entry == `=C:=C:\Users\u` {
			drive = true
		}
	}
	if len(paths) != 1 || paths[0] != `Path=C:\java/bin;C:\tools` || !drive {
		t.Fatalf("windows env = %#v", windows)
	}
}

func TestBatchFilesAreNamedNotStarted(t *testing.T) {
	for _, command := range []string{"run.cmd", `C:\a\START.BAT`, "a.cmd. "} {
		if batchRefusal(command, true) == "" {
			t.Fatalf("%q was not refused on Windows", command)
		}
		if batchRefusal(command, false) != "" {
			t.Fatalf("%q was refused off Windows", command)
		}
	}
	if batchRefusal("cmd.exe", true) != "" || batchRefusal("batch", true) != "" {
		t.Fatal("a program that is not a batch file was refused")
	}
}

// a character split across two reads arrives whole
func TestOutputKeepsSplitCharactersWhole(t *testing.T) {
	text := "héllo ✓ 😀 end"
	raw := []byte(text)
	for split := 0; split <= len(raw); split++ {
		var stream utf8Stream
		got := stream.feed(raw[:split]) + stream.feed(raw[split:]) + stream.flush()
		if got != text {
			t.Fatalf("split at %d: %q", split, got)
		}
		var first utf8Stream
		if head := first.feed(raw[:split]); strings.ContainsRune(head, '\uFFFD') || !strings.HasPrefix(text, head) {
			t.Fatalf("split at %d emitted a broken character: %q", split, head)
		}
	}
	var one utf8Stream
	var out string
	for _, b := range raw {
		out += one.feed([]byte{b})
	}
	if out+one.flush() != text {
		t.Fatalf("byte by byte: %q", out)
	}
	// bytes that are not UTF-8 are passed on, never held back forever
	var bad utf8Stream
	if got := bad.feed([]byte{'a', 0xff, 0x80, 'b'}); len(got) != 4 {
		t.Fatalf("invalid bytes were held: %q", got)
	}
}

func TestInputEncoding(t *testing.T) {
	if got := encodeInput("hi é", "utf8"); string(got) != "hi é" {
		t.Fatalf("utf8: %v", got)
	}
	if got := encodeInput("a😀", "utf16le"); !reflect.DeepEqual(got, []byte{0x61, 0x00, 0x3d, 0xd8, 0x00, 0xde}) {
		t.Fatalf("utf16le: %v", got)
	}
}

func TestReplayIsCapped(t *testing.T) {
	var ring ringBuffer
	chunk := strings.Repeat("x", 1024)
	for i := 0; i < 200; i++ {
		ring.push(chunk)
	}
	if got := len(ring.all()); got > replayBytes || got < replayBytes-len(chunk) {
		t.Fatalf("the replay holds %d bytes", got)
	}
	var early taggedBuffer
	for i := 0; i < 200; i++ {
		early.push("stderr", chunk)
	}
	if early.size > replayBytes || len(early.frames) == 0 || early.frames[0].stream != "stderr" {
		t.Fatalf("early output holds %d bytes in %d frames", early.size, len(early.frames))
	}
}

// the creator's search path decides which program runs, from its own folder
func TestProgramsAreFoundInTheWorkloadsOwnPath(t *testing.T) {
	if runtime.GOOS == "windows" {
		root := t.TempDir()
		tools := filepath.Join(root, "tools")
		if err := os.MkdirAll(tools, 0o755); err != nil {
			t.Fatal(err)
		}
		for _, name := range []string{"java.exe", "old.com", "readme.txt"} {
			if err := os.WriteFile(filepath.Join(tools, name), []byte("x"), 0o755); err != nil {
				t.Fatal(err)
			}
		}
		env := []string{"Path=" + tools}
		for command, want := range map[string]string{"java": "java.exe", "java.exe": "java.exe", "old": "old.com", "readme.txt": "readme.txt"} {
			got, err := findProgram(command, root, env)
			if err != nil || got != filepath.Join(tools, want) {
				t.Fatalf("findProgram(%q) = %q, %v", command, got, err)
			}
		}
		if _, err := findProgram("readme", root, env); err == nil {
			t.Fatal("a name with no program behind it was found")
		}
		return
	}
	root := t.TempDir()
	java := filepath.Join(root, "java", "bin")
	other := filepath.Join(root, "other")
	for _, dir := range []string{java, other} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	write := func(path string, mode os.FileMode) {
		if err := os.WriteFile(path, []byte("#!/bin/sh\n"), mode); err != nil {
			t.Fatal(err)
		}
	}
	write(filepath.Join(java, "java"), 0o755)
	write(filepath.Join(other, "java"), 0o755)
	write(filepath.Join(other, "locked"), 0o644)
	if err := os.MkdirAll(filepath.Join(root, "cwd", "rel"), 0o755); err != nil {
		t.Fatal(err)
	}
	write(filepath.Join(root, "cwd", "rel", "tool"), 0o755)
	cwd := filepath.Join(root, "cwd")

	env := []string{"PATH=" + java + ":" + other + ":rel"}
	if got, err := findProgram("java", cwd, env); err != nil || got != filepath.Join(java, "java") {
		t.Fatalf("java = %q, %v", got, err)
	}
	// a folder in the path that is not absolute is the workload's own
	if got, err := findProgram("tool", cwd, env); err != nil || got != filepath.Join(cwd, "rel", "tool") {
		t.Fatalf("tool = %q, %v", got, err)
	}
	// a path is taken as written, relative to the workload's folder when it starts
	if got, err := findProgram("./start.sh", cwd, env); err != nil || got != "./start.sh" {
		t.Fatalf("./start.sh = %q, %v", got, err)
	}
	if err := spawnError("locked", mustFail(t, "locked", cwd, env)); err.Error() != "spawn locked EACCES" {
		t.Fatalf("locked: %v", err)
	}
	if err := spawnError("nope", mustFail(t, "nope", cwd, env)); err.Error() != "spawn nope ENOENT" {
		t.Fatalf("nope: %v", err)
	}
}

func mustFail(t *testing.T, command, cwd string, env []string) error {
	t.Helper()
	_, err := findProgram(command, cwd, env)
	if err == nil {
		t.Fatalf("%s was found", command)
	}
	return err
}
