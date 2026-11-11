package main

import (
	"time"
)

// how often a terminal is checked for the program in front of it
const foregroundInterval = 400 * time.Millisecond

// A terminal that can name the program in front of it: the one the keyboard
// reaches, as a terminal window's title shows it (vim, npm, the shell itself).
type foregroundReader interface {
	foreground() (string, error)
}

// Reports the program in front of a terminal each time it changes, until
// done closes. A read can fail for a moment (the program ended between two
// questions about it), so a failed read is only logged when it is the first
// in a row; the name stays what it was.
func watchForeground(read func() (string, error), report func(name string), logf func(level, format string, args ...any), done <-chan struct{}) {
	ticker := time.NewTicker(foregroundInterval)
	defer ticker.Stop()
	last := ""
	failing := false
	check := func() {
		name, err := read()
		if err != nil {
			if !failing {
				logf("DEBUG", "the program in front of the terminal could not be read: %v", err)
			}
			failing = true
			return
		}
		failing = false
		if name != "" && name != last {
			last = name
			report(name)
		}
	}
	check()
	for {
		select {
		case <-done:
			return
		case <-ticker.C:
			check()
		}
	}
}
