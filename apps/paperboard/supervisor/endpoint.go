package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"time"
)

// Endpoint names are one-to-one with ids: a fixed-length digest, so no two
// ids share a socket and a unix socket path stays under its length limit for
// any id. papercrane/supervisor.ts computes the same name to connect.
func endpointName(id string) string {
	sum := sha256.Sum256([]byte(id))
	return hex.EncodeToString(sum[:])[:32]
}

type endpoint struct {
	// the unix socket, or the Windows named pipe
	address      string
	metadataFile string
	logFile      string
}

// sockets/ holds the endpoints (a client may type into a running terminal)
// and their metadata (args, env): owner-only whatever the umask was.
func resolveEndpoint(dataDir, id string) (endpoint, error) {
	name := endpointName(id)
	sockets := filepath.Join(dataDir, "sockets")
	if err := os.MkdirAll(sockets, 0o700); err != nil {
		return endpoint{}, fmt.Errorf("could not create %s: %w", sockets, err)
	}
	if runtime.GOOS != "windows" {
		if info, err := os.Stat(sockets); err == nil && info.Mode().Perm()&0o077 != 0 {
			if err := os.Chmod(sockets, 0o700); err != nil {
				// a filesystem without modes (FAT) refuses; the directory is used as it is
				fmt.Fprintf(os.Stderr, "[supervisor] could not restrict %s to its owner: %v\n", sockets, err)
			}
		}
	}
	at := endpoint{
		metadataFile: filepath.Join(sockets, name+".json"),
		logFile:      filepath.Join(dataDir, "logs", "paperboard.log"),
	}
	if runtime.GOOS == "windows" {
		at.address = `\\.\pipe\papercrane-` + name
	} else {
		at.address = filepath.Join(sockets, name+".sock")
	}
	return at, nil
}

// One line in the daemon's own log, in its format. The daemon also keeps the
// tail of stderr for a start that fails, so every line goes there too.
func (at endpoint) logf(level, format string, args ...any) {
	message := fmt.Sprintf(format, args...)
	fmt.Fprintf(os.Stderr, "[supervisor] %s\n", message)
	if at.logFile == "" {
		return
	}
	if err := os.MkdirAll(filepath.Dir(at.logFile), 0o755); err != nil {
		fmt.Fprintf(os.Stderr, "[supervisor] could not create the log folder: %v\n", err)
		return
	}
	file, err := os.OpenFile(at.logFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		fmt.Fprintf(os.Stderr, "[supervisor] could not open %s: %v\n", at.logFile, err)
		return
	}
	defer file.Close()
	stamp := time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
	if _, err := fmt.Fprintf(file, "%s [%s] [paperboard] %s\n", stamp, level, message); err != nil {
		fmt.Fprintf(os.Stderr, "[supervisor] could not write %s: %v\n", at.logFile, err)
	}
}
