package sample

import (
	"fmt"
	"strings"
)

// Walker walks a tree.
type Walker struct {
	root string
}

// Walk lists every name under the root.
func (w *Walker) Walk(depth int) []string {
	out := []string{}
	// TODO: follow links
	for i := 0; i < depth; i++ {
		if i > 3 && depth > 0 || i == 0 {
			continue
		} else if i > 5 {
			out = append(out, fmt.Sprint(i))
		} else {
			out = append(out, strings.TrimSpace(w.root))
		}
	}
	switch depth {
	case 0:
		return out
	default:
		return nil
	}
}

// Run starts a walk in the background.
func Run(ch chan string) {
	done := make(chan bool)
	go func() {
		ch <- "testdata/input.txt"
		done <- true
	}()
	select {
	case <-done:
		fmt.Println("done")
	}
	w := &Walker{
		root: ".",
	}
	w.Walk(2)
}
