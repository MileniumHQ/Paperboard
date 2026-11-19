package main

import (
	"errors"
	"io"
	"sync"
	"unicode/utf16"
	"unicode/utf8"
)

// what a reconnecting client is shown of the output it missed
const replayBytes = 64 * 1024

// The last output, capped by bytes (oldest chunks dropped first).
type ringBuffer struct {
	chunks []string
	size   int
}

func (r *ringBuffer) push(chunk string) {
	r.chunks = append(r.chunks, chunk)
	r.size += len(chunk)
	for r.size > replayBytes && len(r.chunks) > 0 {
		r.size -= len(r.chunks[0])
		r.chunks = r.chunks[1:]
	}
}

func (r *ringBuffer) all() string {
	total := 0
	for _, chunk := range r.chunks {
		total += len(chunk)
	}
	out := make([]byte, 0, total)
	for _, chunk := range r.chunks {
		out = append(out, chunk...)
	}
	return string(out)
}

type outputFrame struct {
	stream string
	data   string
}

// Output chunks with their stream, capped the same way.
type taggedBuffer struct {
	frames []outputFrame
	size   int
}

func (t *taggedBuffer) push(stream, data string) {
	t.frames = append(t.frames, outputFrame{stream, data})
	t.size += len(data)
	for t.size > replayBytes && len(t.frames) > 0 {
		t.size -= len(t.frames[0].data)
		t.frames = t.frames[1:]
	}
}

// Decodes one stream's bytes as UTF-8 without splitting a character that
// arrived across two reads: the unfinished tail waits for the next read.
type utf8Stream struct {
	pending []byte
}

func (s *utf8Stream) feed(chunk []byte) string {
	data := chunk
	if len(s.pending) > 0 {
		data = append(s.pending, chunk...)
	}
	cut := len(data) - incompleteTail(data)
	out := string(data[:cut])
	s.pending = append(s.pending[:0], data[cut:]...)
	return out
}

// what is left when the stream ends: an unfinished character, shown as it is
func (s *utf8Stream) flush() string {
	out := string(s.pending)
	s.pending = nil
	return out
}

// how many trailing bytes begin a character the data does not finish
func incompleteTail(data []byte) int {
	for back := 1; back <= utf8.UTFMax-1 && back <= len(data); back++ {
		b := data[len(data)-back]
		if b&0xC0 == 0x80 {
			continue // a continuation byte: keep looking for its lead
		}
		need := 0
		switch {
		case b&0xE0 == 0xC0:
			need = 2
		case b&0xF0 == 0xE0:
			need = 3
		case b&0xF8 == 0xF0:
			need = 4
		}
		if need > back {
			return back
		}
		return 0
	}
	return 0
}

// input text in the encoding the workload reads
func encodeInput(text, encoding string) []byte {
	if encoding != "utf16le" {
		return []byte(text)
	}
	units := utf16.Encode([]rune(text))
	out := make([]byte, 0, len(units)*2)
	for _, unit := range units {
		out = append(out, byte(unit), byte(unit>>8))
	}
	return out
}

// the most a slow reader (a client, or a workload that is not reading its
// input) may have waiting before it is cut off
const queueLimitBytes = 64 * 1024 * 1024

var errQueueFull = errors.New("it is not reading and its queue is full")

// Writes in order from one goroutine, so no caller ever blocks on a reader
// that has stopped reading.
type asyncWriter struct {
	mu      sync.Mutex
	wake    *sync.Cond
	queue   [][]byte
	queued  int
	closing bool
	done    chan struct{}
}

// onFail is told once when a write fails or the queue overflows.
func newAsyncWriter(out io.WriteCloser, onFail func(error)) *asyncWriter {
	w := &asyncWriter{done: make(chan struct{})}
	w.wake = sync.NewCond(&w.mu)
	go func() {
		defer close(w.done)
		defer out.Close()
		for {
			w.mu.Lock()
			for len(w.queue) == 0 && !w.closing {
				w.wake.Wait()
			}
			if len(w.queue) == 0 {
				w.mu.Unlock()
				return
			}
			next := w.queue[0]
			w.queue = w.queue[1:]
			w.queued -= len(next)
			w.mu.Unlock()
			if _, err := out.Write(next); err != nil {
				w.mu.Lock()
				w.closing = true
				w.queue = nil
				w.queued = 0
				w.mu.Unlock()
				if onFail != nil {
					onFail(err)
				}
				return
			}
		}
	}()
	return w
}

func (w *asyncWriter) write(data []byte) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.closing {
		return io.ErrClosedPipe
	}
	if w.queued+len(data) > queueLimitBytes {
		return errQueueFull
	}
	w.queue = append(w.queue, data)
	w.queued += len(data)
	w.wake.Signal()
	return nil
}

// stops after what is queued has been written
func (w *asyncWriter) close() {
	w.mu.Lock()
	w.closing = true
	w.wake.Signal()
	w.mu.Unlock()
}
