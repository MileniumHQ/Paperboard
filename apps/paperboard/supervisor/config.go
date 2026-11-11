package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"regexp"
	"strings"
	"time"
)

// What to run, as the daemon wrote it on stdin (SupervisorSpawnConfig in
// papercrane/supervisor.ts). raw is the config exactly as it arrived: the
// metadata file repeats it, so fields this supervisor does not act on
// (important, appId) reach the daemon that adopts the workload.
type spawnConfig struct {
	raw           map[string]any
	command       string
	args          []string
	cwd           string
	env           map[string]any
	pty           bool
	cols          int
	rows          int
	noStdin       bool
	inputEncoding string
	consoleInput  bool
}

// how long the daemon has to write the config before it counts as empty
const configReadTimeout = 3 * time.Second

func readConfig(stdin io.Reader) (*spawnConfig, error) {
	type result struct {
		data []byte
		err  error
	}
	done := make(chan result, 1)
	go func() {
		data, err := io.ReadAll(stdin)
		done <- result{data, err}
	}()
	var data []byte
	select {
	case got := <-done:
		// a closed or missing stdin reads as no config, like an empty one
		data = got.data
	case <-time.After(configReadTimeout):
	}
	return parseConfig(data)
}

func parseConfig(data []byte) (*spawnConfig, error) {
	cfg := &spawnConfig{raw: map[string]any{}}
	text := strings.TrimSpace(string(data))
	if text == "" {
		return cfg, nil
	}
	if err := json.Unmarshal([]byte(text), &cfg.raw); err != nil {
		return nil, fmt.Errorf("invalid spawn config on stdin: %w", err)
	}
	if cfg.raw == nil {
		return nil, fmt.Errorf("invalid spawn config on stdin: it is not an object")
	}
	cfg.command = stringField(cfg.raw, "command")
	cfg.cwd = stringField(cfg.raw, "cwd")
	cfg.inputEncoding = stringField(cfg.raw, "inputEncoding")
	cfg.pty = truthy(cfg.raw["isPty"]) || stringField(cfg.raw, "type") == "pty"
	cfg.noStdin = truthy(cfg.raw["noStdin"])
	cfg.consoleInput = truthy(cfg.raw["consoleInput"])
	cfg.cols = intField(cfg.raw, "cols")
	cfg.rows = intField(cfg.raw, "rows")
	if list, ok := cfg.raw["args"].([]any); ok {
		for _, item := range list {
			cfg.args = append(cfg.args, jsString(item))
		}
	}
	if env, ok := cfg.raw["env"].(map[string]any); ok {
		cfg.env = env
	}
	if cfg.inputEncoding != "" && cfg.inputEncoding != "utf8" && cfg.inputEncoding != "utf16le" {
		return nil, fmt.Errorf("invalid spawn config on stdin: inputEncoding %q is not utf8 or utf16le", cfg.inputEncoding)
	}
	return cfg, nil
}

func stringField(m map[string]any, key string) string {
	value, _ := m[key].(string)
	return value
}

func intField(m map[string]any, key string) int {
	value, _ := m[key].(float64)
	return int(value)
}

func truthy(value any) bool {
	switch v := value.(type) {
	case bool:
		return v
	case string:
		return v != ""
	case float64:
		return v != 0
	}
	return false
}

// a JSON value as the text a workload's argument or variable holds
func jsString(value any) string {
	switch v := value.(type) {
	case string:
		return v
	case nil:
		return ""
	case float64, bool:
		encoded, _ := json.Marshal(v)
		return string(encoded)
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return fmt.Sprint(value)
	}
	return string(encoded)
}

// Metadata lands on disk beside the socket. A variable whose name looks like
// a secret (bot tokens live here) is stored without its value.
var secretEnvName = regexp.MustCompile(`(?i)TOKEN|SECRET|KEY`)

const redacted = "[redacted]"

func redactEnv(env map[string]any) map[string]string {
	out := make(map[string]string, len(env))
	for name, value := range env {
		if secretEnvName.MatchString(name) {
			out[name] = redacted
		} else {
			out[name] = jsString(value)
		}
	}
	return out
}

type metadata struct {
	ID        string         `json:"id"`
	Pid       int            `json:"pid"`
	ChildPid  int            `json:"childPid"`
	IsPty     bool           `json:"isPty"`
	StartedAt string         `json:"startedAt"`
	Config    map[string]any `json:"config"`
}

func (cfg *spawnConfig) metadata(id string, childPid int) metadata {
	stored := make(map[string]any, len(cfg.raw)+1)
	for key, value := range cfg.raw {
		stored[key] = value
	}
	stored["env"] = redactEnv(cfg.env)
	pid := os.Getpid()
	if childPid == 0 {
		childPid = pid
	}
	return metadata{
		ID:        id,
		Pid:       pid,
		ChildPid:  childPid,
		IsPty:     truthy(cfg.raw["isPty"]),
		StartedAt: time.Now().UTC().Format("2006-01-02T15:04:05.000Z"),
		Config:    stored,
	}
}
