package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"os/signal"
	"runtime"
	"sync"
	"syscall"
	"time"
)

// how long a supervisor waits for the spawning daemon to connect and read a
// failed start's reason, or the result of a workload that already exited
const startFailureLinger = 10 * time.Second

// how long the clients have to take the exit frame and hang up before the
// process ends anyway
const exitFlushMax = time.Second

// A running workload, whichever way it was started.
type workload interface {
	pid() int
	// queues input; never blocks on a workload that is not reading
	write(data []byte) error
	// ends its input once what is queued has been written, so a program
	// that reads its input to the end goes on
	closeInput() error
	resize(cols, rows int) error
	// asks the workload and everything it started to stop
	kill(signal string) error
}

type client struct {
	conn     net.Conn
	out      *asyncWriter
	attached bool
}

type supervisor struct {
	id  string
	cfg *spawnConfig
	at  endpoint

	mu       sync.Mutex
	ring     ringBuffer
	early    *taggedBuffer // output before the first attach, kept with its stream
	pending  *int          // the workload's exit code while it waits for that first attach
	attached bool          // a client has attached at least once
	clients  map[*client]struct{}
	exited   bool
	readers  sync.WaitGroup // connections still being read
	work     workload
	workDone bool // the workload has exited; there is nothing left to stop
	startErr string
	listener net.Listener
	// the program in front of a terminal, as last reported
	foreground string
	// closed when the workload exits, which ends its watchers
	stopped chan struct{}
}

func runSupervisor(dataDir, id string) error {
	sealInheritedFiles()
	at, err := resolveEndpoint(dataDir, id)
	if err != nil {
		return err
	}
	cfg, err := readConfig(os.Stdin)
	if err != nil {
		// a supervisor that cannot read its spawn config must die loudly,
		// never sit on the socket with no config
		return err
	}
	s := &supervisor{id: id, cfg: cfg, at: at, early: &taggedBuffer{}, clients: map[*client]struct{}{}, stopped: make(chan struct{})}

	if runtime.GOOS != "windows" {
		if err := os.Remove(at.address); err != nil && !os.IsNotExist(err) {
			at.logf("DEBUG", "[supervisor:%s] could not remove the old socket %s: %v", id, at.address, err)
		}
	}

	signals := make(chan os.Signal, 2)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-signals
		s.mu.Lock()
		code := 0
		if s.pending != nil {
			code = *s.pending
		}
		s.mu.Unlock()
		s.cleanupAndExit(code)
	}()

	// The start outcome is set before the endpoint exists, so no client can
	// read a speculative success while the workload is still starting.
	s.startWorkload()

	listener, err := listen(at.address)
	if err != nil {
		s.stopWorkload()
		return err
	}
	s.mu.Lock()
	s.listener = listener
	s.mu.Unlock()
	for {
		conn, err := listener.Accept()
		if err != nil {
			// the endpoint is closed during teardown; the exit is already under way
			select {}
		}
		go s.serve(conn)
	}
}

// A workload that cannot start stays failed: the supervisor listens just long
// enough for the spawning daemon to read the reason from the status frame,
// then exits. No metadata is written, so nothing mistakes it for a live one.
func (s *supervisor) failStart(message string) {
	s.startErr = message
	s.at.logf("ERROR", "[supervisor:%s] %s", s.id, message)
	s.ring.push("\n" + message + "\n")
	time.AfterFunc(startFailureLinger, func() { s.cleanupAndExit(1) })
}

func (s *supervisor) startWorkload() {
	cfg := s.cfg
	cwd := cfg.cwd
	if cwd != "" {
		// an explicit but missing folder fails with its path attached
		if _, err := os.Stat(cwd); err != nil {
			s.failStart("Working directory does not exist: " + cwd)
			return
		}
	} else {
		home, err := os.UserHomeDir()
		if err != nil {
			s.failStart("Could not find the home folder to start in: " + err.Error())
			return
		}
		cwd = home
	}

	var work workload
	if cfg.pty {
		shell := cfg.command
		if shell == "" {
			shell = defaultShell()
		}
		cols, rows := cfg.cols, cfg.rows
		if cols <= 0 {
			cols = 80
		}
		if rows <= 0 {
			rows = 24
		}
		env := workloadEnv(os.Environ(), cfg.env, cwd, map[string]string{
			"TERM_PROGRAM": "Paperboard",
			"TERM":         "xterm-256color",
			"COLORTERM":    "truecolor",
		})
		started, err := startPty(shell, cfg.args, cols, rows, cwd, env, s.emitOutput, s.workloadExited)
		if err != nil {
			// no terminal is a start failure, never a shell on pipes
			s.failStart("Could not start a terminal: " + err.Error())
			return
		}
		work = started
	} else {
		command := cfg.command
		if command == "" {
			command = "sh"
		}
		if refusal := batchFileRefusal(command); refusal != "" {
			s.failStart(refusal)
			return
		}
		env := workloadEnv(os.Environ(), cfg.env, cwd, nil)
		started, err := startPiped(pipedStart{
			command:       command,
			args:          cfg.args,
			cwd:           cwd,
			env:           env,
			noStdin:       cfg.noStdin,
			inputEncoding: cfg.inputEncoding,
			consoleInput:  cfg.consoleInput,
		}, s.emitOutput, s.workloadExited)
		if err != nil {
			// nothing runs: the caller's start fails with the reason
			s.failStart("Could not start " + command + ": " + err.Error())
			return
		}
		work = started
	}

	s.mu.Lock()
	s.work = work
	s.mu.Unlock()
	if reader, ok := work.(foregroundReader); ok {
		logf := func(level, format string, args ...any) {
			s.at.logf(level, "[supervisor:%s] "+format, append([]any{s.id}, args...)...)
		}
		go watchForeground(reader.foreground, s.emitForeground, logf, s.stopped)
	}

	// a terminal's shell is reported as the supervisor itself, as it always was
	childPid := 0
	if !cfg.pty {
		childPid = work.pid()
	}
	encoded, err := json.MarshalIndent(cfg.metadata(s.id, childPid), "", "  ")
	if err == nil {
		err = os.WriteFile(s.at.metadataFile, encoded, 0o600)
	}
	if err != nil {
		s.at.logf("ERROR", "[supervisor:%s] could not write its metadata, so a restarted daemon will not find this workload: %v", s.id, err)
	}
}

func (s *supervisor) emitOutput(stream, data string) {
	if data == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ring.push(data)
	if s.early != nil {
		s.early.push(stream, data)
	}
	frame := encodeFrame(map[string]any{"type": "data", "stream": stream, "data": data})
	for c := range s.clients {
		if c.attached {
			s.send(c, frame)
		}
	}
}

// The program in front of a terminal changed: every attached client hears
// its name, and a client that attaches later hears the latest one.
func (s *supervisor) emitForeground(name string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.foreground = name
	frame := encodeFrame(map[string]any{"type": "foreground", "name": name})
	for c := range s.clients {
		if c.attached {
			s.send(c, frame)
		}
	}
}

// A workload that exits before the spawning daemon has attached (a command
// that runs in milliseconds) must not take the endpoint with it: the daemon
// would find no socket and report a start failure, and the output and exit
// code would be lost. The exit waits for the first attach, bounded like a
// failed start.
func (s *supervisor) workloadExited(code int) {
	s.mu.Lock()
	if !s.workDone {
		close(s.stopped)
	}
	s.workDone = true
	if s.attached {
		s.mu.Unlock()
		s.cleanupAndExit(code)
		return
	}
	s.pending = &code
	s.mu.Unlock()
	time.AfterFunc(startFailureLinger, func() { s.cleanupAndExit(code) })
}

func encodeFrame(frame map[string]any) []byte {
	var out bytes.Buffer
	encoder := json.NewEncoder(&out)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(frame); err != nil {
		// every frame is strings, numbers and booleans: this cannot fail
		panic(fmt.Sprintf("supervisor frame could not be encoded: %v", err))
	}
	return out.Bytes()
}

// s.mu is held. A client that stopped reading is dropped, not waited for.
func (s *supervisor) send(c *client, frame []byte) {
	if err := c.out.write(frame); err != nil {
		delete(s.clients, c)
		c.out.close()
		c.conn.Close()
	}
}

// Ends a connection's output without closing the connection: what was queued
// is sent, and the client is told there is no more. Closing outright while
// the client's own frames sit unread would reset the connection, and the
// client would lose frames it had not read yet (the status of a failed start,
// the exit code).
type outputEnd struct{ conn net.Conn }

func (o outputEnd) Write(data []byte) (int, error) { return o.conn.Write(data) }

func (o outputEnd) Close() error {
	if half, ok := o.conn.(interface{ CloseWrite() error }); ok {
		return half.CloseWrite()
	}
	// a Windows named pipe has no half-close; what was sent stays readable
	// by the client after the pipe is closed
	return o.conn.Close()
}

func (s *supervisor) serve(conn net.Conn) {
	c := &client{conn: conn}
	c.out = newAsyncWriter(outputEnd{conn}, nil)

	s.mu.Lock()
	if s.exited {
		s.mu.Unlock()
		conn.Close()
		return
	}
	s.readers.Add(1)
	defer s.readers.Done()
	s.clients[c] = struct{}{}
	status := map[string]any{
		"type":     "status",
		"pid":      os.Getpid(),
		"childPid": s.childPid(),
		"running":  s.pending == nil,
		"isPty":    truthy(s.cfg.raw["isPty"]),
	}
	failed := s.startErr != ""
	if failed {
		status["error"] = s.startErr
	}
	s.send(c, encodeFrame(status))
	s.mu.Unlock()
	// the status frame carried the failure; this client was the one waiting
	// for it, so the supervisor's job is done. The connection is still read
	// until the client hangs up.
	if failed {
		go s.cleanupAndExit(1)
	}

	reader := bufio.NewReader(conn)
	for {
		line, err := reader.ReadBytes('\n')
		if len(bytes.TrimSpace(line)) > 0 {
			s.handle(c, line)
		}
		if err != nil {
			break
		}
	}
	s.mu.Lock()
	delete(s.clients, c)
	s.mu.Unlock()
	c.out.close()
	conn.Close()
}

// s.mu is held
func (s *supervisor) childPid() int {
	if s.work == nil || s.cfg.pty {
		return 0
	}
	return s.work.pid()
}

type clientMessage struct {
	Type   string  `json:"type"`
	Data   *string `json:"data"`
	Cols   float64 `json:"cols"`
	Rows   float64 `json:"rows"`
	Signal string  `json:"signal"`
}

func (s *supervisor) handle(c *client, line []byte) {
	var msg clientMessage
	if err := json.Unmarshal(line, &msg); err != nil {
		s.at.logf("DEBUG", "[supervisor:%s] ignored a frame that is not JSON: %v", s.id, err)
		return
	}
	switch msg.Type {
	case "attach":
		s.mu.Lock()
		if !s.attached && s.early != nil {
			// the first attach gets the early output with its streams, which
			// stdout- and stderr-only listeners need; later ones get one replay
			for _, frame := range s.early.frames {
				s.send(c, encodeFrame(map[string]any{"type": "data", "stream": frame.stream, "data": frame.data}))
			}
		} else if history := s.ring.all(); history != "" {
			s.send(c, encodeFrame(map[string]any{"type": "history", "data": history}))
		}
		// output frames go only to attached sockets: the replay was taken
		// here, so anything sent before it would arrive twice
		if s.foreground != "" {
			s.send(c, encodeFrame(map[string]any{"type": "foreground", "name": s.foreground}))
		}
		c.attached = true
		s.attached = true
		s.early = nil
		pending := s.pending
		s.mu.Unlock()
		if pending != nil {
			// on its own goroutine: this one keeps reading the connection
			go s.cleanupAndExit(*pending)
		}
	case "stdin":
		work := s.workload()
		if work == nil || msg.Data == nil {
			return
		}
		if err := work.write([]byte(*msg.Data)); err != nil {
			s.at.logf("WARN", "[supervisor:%s] input was not delivered: %v", s.id, err)
		}
	case "stdin-close":
		work := s.workload()
		if work == nil {
			return
		}
		if err := work.closeInput(); err != nil {
			s.at.logf("WARN", "[supervisor:%s] input was not closed: %v", s.id, err)
		}
	case "resize":
		work := s.workload()
		if work == nil || !s.cfg.pty {
			return
		}
		if err := work.resize(int(msg.Cols), int(msg.Rows)); err != nil {
			s.at.logf("DEBUG", "[supervisor:%s] resize to %vx%v failed: %v", s.id, msg.Cols, msg.Rows, err)
		}
	case "kill":
		work := s.workload()
		if work == nil {
			return
		}
		signal := msg.Signal
		if signal == "" {
			signal = "SIGTERM"
		}
		if err := work.kill(signal); err != nil {
			s.at.logf("WARN", "[supervisor:%s] could not stop its workload with %s: %v", s.id, signal, err)
		}
	}
}

func (s *supervisor) workload() workload {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.work
}

func (s *supervisor) stopWorkload() {
	s.mu.Lock()
	work, done := s.work, s.workDone
	s.mu.Unlock()
	if work == nil || done {
		return
	}
	if err := work.kill("SIGTERM"); err != nil {
		s.at.logf("WARN", "[supervisor:%s] could not stop its workload on teardown: %v", s.id, err)
	}
}

func (s *supervisor) cleanupAndExit(code int) {
	s.mu.Lock()
	if s.exited {
		s.mu.Unlock()
		// the first teardown ends the process
		select {}
	}
	s.exited = true
	// The endpoint goes before the exit is announced: a caller that starts
	// the same id the moment it hears the exit (an installer run again, a
	// server restarted) must reach the new supervisor, not this one. A
	// Windows named pipe has no path to unlink and accepts until closed.
	//
	// A unix socket listener is never closed: closing could unlink a path
	// that by then belongs to a supervisor started again under this id. The
	// path is unlinked here, so nothing new can connect.
	if runtime.GOOS == "windows" && s.listener != nil {
		s.listener.Close()
	}
	if err := os.Remove(s.at.metadataFile); err != nil && !os.IsNotExist(err) {
		s.at.logf("DEBUG", "[supervisor:%s] could not remove its metadata: %v", s.id, err)
	}
	if runtime.GOOS != "windows" {
		if err := os.Remove(s.at.address); err != nil && !os.IsNotExist(err) {
			s.at.logf("DEBUG", "[supervisor:%s] could not remove its socket: %v", s.id, err)
		}
	}
	frame := encodeFrame(map[string]any{"type": "exit", "code": code})
	writers := make([]*asyncWriter, 0, len(s.clients))
	for c := range s.clients {
		if err := c.out.write(frame); err != nil {
			s.at.logf("DEBUG", "[supervisor:%s] a client did not get the exit: %v", s.id, err)
		}
		c.out.close()
		writers = append(writers, c.out)
	}
	s.clients = map[*client]struct{}{}
	s.mu.Unlock()

	// every teardown path must reach the workload: a supervisor that exits
	// on SIGTERM with its child still running orphans the child
	s.stopWorkload()

	// every client is sent the exit and then hangs up, having read it; one
	// that does neither is not waited for
	finished := make(chan struct{})
	go func() {
		for _, w := range writers {
			<-w.done
		}
		s.readers.Wait()
		close(finished)
	}()
	select {
	case <-finished:
	case <-time.After(exitFlushMax):
	}
	os.Exit(code)
}
