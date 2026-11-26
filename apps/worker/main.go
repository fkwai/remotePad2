package main

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"sync"
	"syscall"
	"time"
)

type worker struct {
	home         string
	channel      string
	previewKey   string
	terminals    terminals
	filesMu      sync.Mutex
	navigationMu sync.Mutex
}

func newWorker(home, channel string) *worker {
	return &worker{home: home, channel: channel, previewKey: rand.Text(),
		terminals: terminals{sessions: make(map[string]*session)}}
}

func (w *worker) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(out http.ResponseWriter, _ *http.Request) {
		hostname, _ := os.Hostname()
		reply(out, 200, map[string]any{"ok": true, "hostname": hostname, "pid": os.Getpid(), "channel": w.channel, "runtime": "go"})
	})
	mux.HandleFunc("GET /api/preview-key", func(out http.ResponseWriter, _ *http.Request) {
		reply(out, 200, map[string]string{"key": w.previewKey})
	})
	w.registerFiles(mux)
	w.registerTerminals(mux)
	w.registerNavigation(mux)
	return mux
}

func reply(out http.ResponseWriter, status int, value any) {
	out.Header().Set("Content-Type", "application/json; charset=utf-8")
	out.WriteHeader(status)
	_ = json.NewEncoder(out).Encode(value)
}

func fail(out http.ResponseWriter, status int, err error) {
	reply(out, status, map[string]string{"error": err.Error()})
}

func body(out http.ResponseWriter, req *http.Request, limit int64, value any) bool {
	decoder := json.NewDecoder(http.MaxBytesReader(out, req.Body, limit))
	if err := decoder.Decode(value); err != nil {
		fail(out, 400, err)
		return false
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		fail(out, 400, errors.New("Invalid JSON body."))
		return false
	}
	return true
}

func serve(socket string) error {
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	// Serialize startup for this socket for the lifetime of the worker.
	lock, err := os.OpenFile(socket+".lock", os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	defer lock.Close()
	if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); errors.Is(err, syscall.EWOULDBLOCK) {
		return nil
	} else if err != nil {
		return err
	}
	if info, err := os.Lstat(socket); err == nil {
		if info.Mode()&os.ModeSocket == 0 {
			return errors.New("Worker socket path is occupied by a non-socket file.")
		}
		if err := os.Remove(socket); err != nil {
			return err
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	listener, err := net.Listen("unix", socket)
	if err != nil {
		return err
	}
	defer listener.Close()
	if err := os.Chmod(socket, 0600); err != nil {
		return err
	}

	w := newWorker(home, os.Getenv("REMOTEPAD2_CHANNEL"))
	server := &http.Server{Handler: w.routes(), ReadHeaderTimeout: 5 * time.Second}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- server.Serve(listener) }()
	select {
	case err := <-done:
		w.terminals.close()
		return err
	case <-ctx.Done():
		w.terminals.close()
		shutdown, stop := context.WithTimeout(context.Background(), 3*time.Second)
		defer stop()
		return server.Shutdown(shutdown)
	}
}

func check(socket string) error {
	client := http.Client{
		Timeout: time.Second,
		Transport: &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, "unix", socket)
		}},
	}
	response, err := client.Get("http://localhost/api/health")
	if err != nil {
		return err
	}
	defer response.Body.Close()
	var health struct {
		OK      bool
		Runtime string
	}
	if err := json.NewDecoder(response.Body).Decode(&health); err != nil {
		return err
	}
	if response.StatusCode != 200 || !health.OK || health.Runtime != "go" {
		return errors.New("Go worker is unavailable.")
	}
	return nil
}

func main() {
	probe := flag.Bool("check", false, "check the worker on its Unix socket")
	flag.Parse()
	socket := os.Getenv("REMOTEPAD2_WORKER_SOCKET")
	if !filepath.IsAbs(socket) {
		log.Fatal("REMOTEPAD2_WORKER_SOCKET must be an absolute Unix socket path")
	}
	if *probe {
		if err := check(socket); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}
	if err := serve(socket); err != nil {
		log.Fatal(err)
	}
}
