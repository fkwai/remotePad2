package main

import (
	"bufio"
	"crypto/rand"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"os/exec"
	"os/user"
	"strings"
	"sync"
	"syscall"
	"time"
	"unicode/utf8"

	"github.com/creack/pty"
	"github.com/gorilla/websocket"
	"golang.org/x/sys/unix"
)

type sessionInfo struct {
	Agent     string `json:"agent,omitempty"`
	Project   string `json:"project,omitempty"`
	Machine   string `json:"machine,omitempty"`
	CreatedAt int64  `json:"createdAt,omitempty"`
	Renamed   bool   `json:"renamed,omitempty"`
	ID        string `json:"id"`
	Name      string `json:"name"`
	Cwd       string `json:"cwd"`
	CodexID   string `json:"codexId,omitempty"`
	Alive     bool   `json:"alive"`
	ExitCode  *int   `json:"exitCode,omitempty"`
}

type terminalEvent struct {
	Type    string       `json:"type"`
	Session *sessionInfo `json:"session,omitempty"`
	Replay  *string      `json:"replay,omitempty"`
	Data    string       `json:"data,omitempty"`
	Code    *int         `json:"code,omitempty"`
	Message string       `json:"message,omitempty"`
}

type session struct {
	mu      sync.Mutex
	info    sessionInfo
	replay  string
	pty     *os.File
	process *os.Process
	clients map[*websocket.Conn]chan terminalEvent
	done    chan struct{}
	stopped bool
}

type terminals struct {
	mu       sync.Mutex
	running  sync.WaitGroup
	sessions map[string]*session
	closed   bool
}

// The worker only accepts connections through its private Unix socket.
var upgrade = websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}

func shell() string {
	if current, err := user.Current(); err == nil {
		// Match the account's login shell, including on non-Bash hosts.
		if output, err := exec.Command("getent", "passwd", current.Username).Output(); err == nil {
			fields := strings.Split(strings.TrimSpace(string(output)), ":")
			if len(fields) == 7 && fields[6] != "" {
				return fields[6]
			}
		}
	}
	if shell := os.Getenv("SHELL"); shell != "" {
		return shell
	}
	return "/bin/sh"
}

func (t *terminals) create(home string, codex codexSession, options sessionRequest) (sessionInfo, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.closed {
		return sessionInfo{}, errors.New("Worker is stopping.")
	}
	if codex.ID != "" {
		for _, existing := range t.sessions {
			existing.mu.Lock()
			info := existing.info
			existing.mu.Unlock()
			if info.CodexID == codex.ID && info.Alive {
				return info, nil
			}
		}
	}
	plan, err := planSession(home, options, codex)
	if err != nil {
		return sessionInfo{}, err
	}
	info := plan.info
	info.ID = rand.Text()
	info.Alive = true
	info.CreatedAt = time.Now().UnixMilli()
	cmd := exec.Command(plan.command[0], plan.command[1:]...)
	cmd.Dir = info.Cwd
	cmd.Env = append(cmd.Environ(), "TERM=xterm-256color", "COLORTERM=truecolor")
	file, err := pty.StartWithSize(cmd, &pty.Winsize{Cols: 80, Rows: 24})
	if err != nil {
		return sessionInfo{}, err
	}
	master, err := pollableMaster(file)
	file.Close()
	if err != nil {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		return sessionInfo{}, err
	}
	s := &session{info: info, pty: master, process: cmd.Process,
		clients: make(map[*websocket.Conn]chan terminalEvent), done: make(chan struct{})}
	t.sessions[info.ID] = s
	t.running.Add(1)
	go func() {
		defer t.running.Done()
		s.run(cmd)
	}()
	return info, nil
}

// Register the master with Go's poller so closing it wakes pending reads and
// writes even when a child process still has the slave open.
func pollableMaster(file *os.File) (*os.File, error) {
	fd, err := unix.FcntlInt(file.Fd(), unix.F_DUPFD_CLOEXEC, 0)
	if err != nil {
		return nil, err
	}
	if err := unix.SetNonblock(fd, true); err != nil {
		_ = unix.Close(fd)
		return nil, err
	}
	return os.NewFile(uintptr(fd), file.Name()), nil
}

func (s *session) run(cmd *exec.Cmd) {
	defer close(s.done)
	drained := make(chan struct{})
	go func() {
		defer close(drained)
		s.readOutput()
	}()
	_ = cmd.Wait()
	// Deliver final output first, even if a descendant still holds the PTY.
	select {
	case <-drained:
	case <-time.After(100 * time.Millisecond):
	}
	_ = s.pty.Close()
	<-drained
	code := cmd.ProcessState.ExitCode()
	if code < 0 {
		code = 0 // node-pty reports the terminating signal separately.
	}
	s.mu.Lock()
	s.info.Alive = false
	s.info.ExitCode = &code
	s.broadcast(terminalEvent{Type: "exit", Code: &code})
	s.mu.Unlock()
}

func (s *session) readOutput() {
	reader := bufio.NewReaderSize(s.pty, 16384)
	chunk := make([]byte, 0, 16388)
	for {
		r, _, err := reader.ReadRune()
		if err == nil {
			chunk = utf8.AppendRune(chunk, r)
			if reader.Buffered() > 0 && len(chunk) < 16384 {
				continue
			}
		}
		if len(chunk) > 0 {
			data := string(chunk)
			s.mu.Lock()
			s.replay += data
			if cutoff := len(s.replay) - 200000; cutoff > 0 {
				for !utf8.RuneStart(s.replay[cutoff]) {
					cutoff++
				}
				s.replay = strings.Clone(s.replay[cutoff:])
			}
			s.broadcast(terminalEvent{Type: "output", Data: data})
			s.mu.Unlock()
			chunk = chunk[:0]
		}
		if err != nil {
			break
		}
	}
}

func (s *session) broadcast(event terminalEvent) {
	for conn, queue := range s.clients {
		select {
		case queue <- event:
		default:
			_ = conn.Close()
			delete(s.clients, conn)
		}
	}
}

func (s *session) stop() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.stopped = true
	for conn := range s.clients {
		_ = conn.Close()
		delete(s.clients, conn)
	}
	if s.info.Alive {
		_ = s.pty.Close()
		_ = s.process.Signal(syscall.SIGHUP)
		go func() {
			select {
			case <-s.done:
			case <-time.After(time.Second):
				_ = s.process.Kill()
			}
		}()
	}
}

func (t *terminals) close() {
	t.mu.Lock()
	t.closed = true
	for _, s := range t.sessions {
		s.stop()
	}
	clear(t.sessions)
	t.mu.Unlock()
	done := make(chan struct{})
	go func() { t.running.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
	}
}

func (s *session) attach(conn *websocket.Conn) {
	defer conn.Close()
	queue := make(chan terminalEvent, 128)
	s.mu.Lock()
	if s.stopped {
		s.mu.Unlock()
		_ = conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(1008, "Session unavailable"), time.Now().Add(time.Second))
		return
	}
	s.clients[conn] = queue
	info, replay := s.info, s.replay
	queue <- terminalEvent{Type: "ready", Session: &info, Replay: &replay}
	if !info.Alive {
		queue <- terminalEvent{Type: "exit", Code: info.ExitCode}
	}
	s.mu.Unlock()
	done := make(chan struct{})
	defer func() {
		close(done)
		s.mu.Lock()
		delete(s.clients, conn)
		s.mu.Unlock()
	}()
	go func() {
		for {
			select {
			case event := <-queue:
				_ = conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
				if conn.WriteJSON(event) != nil {
					_ = conn.Close()
					return
				}
			case <-done:
				return
			}
		}
	}()
	conn.SetReadLimit(512 * 1024)
	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			return
		}
		var message struct {
			Type       string
			Data       *string
			Cols, Rows *int
		}
		if err := json.Unmarshal(data, &message); err != nil {
			select {
			case queue <- terminalEvent{Type: "error", Message: "Invalid terminal message"}:
			default:
				return
			}
			continue
		}
		switch {
		case message.Type == "input" && message.Data != nil && len(*message.Data) <= 65536:
			_, _ = s.pty.WriteString(*message.Data)
		case message.Type == "resize" && message.Cols != nil && message.Rows != nil:
			_ = pty.Setsize(s.pty, &pty.Winsize{Cols: uint16(min(500, max(2, *message.Cols))), Rows: uint16(min(300, max(1, *message.Rows)))})
		}
	}
}

func (w *worker) registerTerminals(mux *http.ServeMux) {
	t := &w.terminals
	mux.HandleFunc("GET /api/sessions", func(out http.ResponseWriter, _ *http.Request) {
		infos := []sessionInfo{}
		t.mu.Lock()
		for _, s := range t.sessions {
			s.mu.Lock()
			infos = append(infos, s.info)
			s.mu.Unlock()
		}
		t.mu.Unlock()
		reply(out, 200, map[string]any{"sessions": infos})
	})
	mux.HandleFunc("POST /api/sessions", func(out http.ResponseWriter, req *http.Request) {
		var payload sessionRequest
		if req.ContentLength != 0 && !body(out, req, 65536, &payload) {
			return
		}
		var codex codexSession
		if payload.CodexID != "" {
			var err error
			codex, err = w.lookupCodex(payload.CodexID)
			if err != nil {
				fail(out, 404, err)
				return
			}
		}
		info, err := t.create(w.home, codex, payload)
		if err != nil {
			fail(out, 400, err)
			return
		}
		reply(out, 200, info)
	})
	mux.HandleFunc("PATCH /api/sessions/{id}", func(out http.ResponseWriter, req *http.Request) {
		var payload struct{ Name string }
		if !body(out, req, 65536, &payload) {
			return
		}
		name := strings.TrimSpace(payload.Name)
		if name == "" || utf8.RuneCountInString(payload.Name) > 160 || strings.ContainsAny(name, "\x00\r\n") {
			fail(out, 400, errors.New("Enter a session name (up to 160 characters)."))
			return
		}
		t.mu.Lock()
		s := t.sessions[req.PathValue("id")]
		t.mu.Unlock()
		if s == nil {
			fail(out, 404, errors.New("Session unavailable."))
			return
		}
		s.mu.Lock()
		s.info.Name = name
		s.info.Renamed = true
		info := s.info
		s.mu.Unlock()
		reply(out, 200, info)
	})
	mux.HandleFunc("DELETE /api/sessions/{id}", func(out http.ResponseWriter, req *http.Request) {
		id := req.PathValue("id")
		t.mu.Lock()
		s := t.sessions[id]
		if s != nil {
			s.stop()
			delete(t.sessions, id)
		}
		t.mu.Unlock()
		reply(out, 200, map[string]bool{"ok": true})
	})
	mux.HandleFunc("GET /ws/terminal/{id}", func(out http.ResponseWriter, req *http.Request) {
		t.mu.Lock()
		s := t.sessions[req.PathValue("id")]
		t.mu.Unlock()
		conn, err := upgrade.Upgrade(out, req, nil)
		if err != nil {
			return
		}
		if s == nil {
			_ = conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(1008, "Session unavailable"), time.Now().Add(time.Second))
			_ = conn.Close()
			return
		}
		s.attach(conn)
	})
	mux.HandleFunc("GET /api/codex/sessions", func(out http.ResponseWriter, _ *http.Request) {
		rows, err := w.codexSessions()
		if err != nil {
			fail(out, 503, err)
			return
		}
		reply(out, 200, map[string]any{"sessions": rows})
	})
}
