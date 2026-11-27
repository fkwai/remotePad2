package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func request(t *testing.T, handler http.Handler, method, path string, body any, status int) *httptest.ResponseRecorder {
	t.Helper()
	payload, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(method, path, bytes.NewReader(payload)))
	if recorder.Code != status {
		t.Fatalf("%s %s: HTTP %d: %s", method, path, recorder.Code, recorder.Body)
	}
	return recorder
}

func TestWorkspaceContracts(t *testing.T) {
	home := t.TempDir()
	w := newWorker(home, "dev")
	handler := w.routes()
	file := filepath.Join(home, "example.txt")
	if err := os.WriteFile(file, []byte("before"), 0640); err != nil {
		t.Fatal(err)
	}
	res := request(t, handler, "GET", "/api/file?path="+file, nil, 200)
	var info fileContent
	if err := json.Unmarshal(res.Body.Bytes(), &info); err != nil || info.Content != "before" {
		t.Fatalf("read file: %+v, %v", info, err)
	}
	request(t, handler, "PUT", "/api/file", map[string]string{
		"path": file, "content": "after", "revision": info.Revision,
	}, 200)
	request(t, handler, "PUT", "/api/file", info, 409)
	if attr, err := os.Stat(file); err != nil || attr.Mode().Perm() != 0640 {
		t.Fatalf("file mode after save: %v, %v", attr, err)
	}

	res = request(t, handler, "GET", "/api/files?details=1", nil, 200)
	if !strings.Contains(res.Body.String(), `"size":5`) {
		t.Fatalf("listing missing file details: %s", res.Body)
	}
	res = request(t, handler, "GET", "/api/search?q=example", nil, 200)
	if !strings.Contains(res.Body.String(), file) {
		t.Fatalf("search missing file: %s", res.Body)
	}
	request(t, handler, "GET", "/api/preview/bad"+file, nil, 404)
	res = request(t, handler, "GET", "/api/preview/"+w.previewKey+file, nil, 200)
	if res.Body.String() != "after" || res.Header().Get("Content-Security-Policy") != "sandbox allow-scripts allow-downloads" {
		t.Fatalf("preview: %v, %s", res.Header(), res.Body)
	}
	request(t, handler, "POST", "/api/navigation", map[string]string{"kind": "favorites", "path": home}, 200)
	res = request(t, handler, "GET", "/api/navigation", nil, 200)
	if !strings.Contains(res.Body.String(), home) {
		t.Fatalf("favorite did not persist: %s", res.Body)
	}
}

func TestCodexIndex(t *testing.T) {
	home := t.TempDir()
	t.Setenv("CODEX_HOME", home)
	w := newWorker(home, "dev")
	db, err := sql.Open("sqlite", filepath.Join(home, "state_1.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`
		CREATE TABLE threads (id text, title text, name text, cwd text, updated_at int, archived int, project_id int);
		CREATE TABLE projects (id int, name text);
		CREATE TABLE project_roots (path text, project_id int, position int);
		INSERT INTO projects VALUES (2, 'RemotePad');
		INSERT INTO threads VALUES ('a', 'Default', 'Custom name', '/sample', 23, 0, 2);
	`); err != nil {
		t.Fatal(err)
	}
	rows, err := w.codexSessions()
	if err != nil || len(rows) != 1 || rows[0].Title != "Custom name" || rows[0].Project != "RemotePad" || rows[0].UpdatedAt != 23000 {
		t.Fatalf("Codex metadata: %+v, %v", rows, err)
	}
}

func TestTerminalLifecycle(t *testing.T) {
	home := t.TempDir()
	w := newWorker(home, "dev")
	server := httptest.NewServer(w.routes())
	defer server.Close()
	defer w.terminals.close()
	response, err := http.Post(server.URL+"/api/sessions", "application/json", strings.NewReader("{}"))
	if err != nil {
		t.Fatal(err)
	}
	var info sessionInfo
	if err := json.NewDecoder(response.Body).Decode(&info); err != nil || !info.Alive {
		t.Fatalf("create shell: %+v, %v", info, err)
	}
	response.Body.Close()
	s := w.terminals.sessions[info.ID]

	connect := func() (*websocket.Conn, terminalEvent) {
		t.Helper()
		conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"/ws/terminal/"+info.ID, nil)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { conn.Close() })
		conn.SetReadDeadline(time.Now().Add(10 * time.Second))
		var event terminalEvent
		if err := conn.ReadJSON(&event); err != nil || event.Type != "ready" || event.Session.ID != info.ID {
			t.Fatalf("ready: %+v, %v", event, err)
		}
		return conn, event
	}
	send := func(conn *websocket.Conn, message any) {
		t.Helper()
		if err := conn.WriteJSON(message); err != nil {
			t.Fatal(err)
		}
	}
	wait := func(conn *websocket.Conn, marker string) {
		t.Helper()
		var output strings.Builder
		for !strings.Contains(output.String(), marker) {
			var event terminalEvent
			if err := conn.ReadJSON(&event); err != nil || event.Type == "exit" {
				t.Fatalf("wait for %q: %+v, %v, output: %q", marker, event, err, output.String())
			}
			output.WriteString(event.Data)
		}
	}
	first, _ := connect()
	send(first, map[string]any{"type": "resize", "rows": 45, "cols": 97})
	send(first, map[string]string{"type": "input", "data": "stty size; printf 'rp-%s\\n' '重连'; sleep 30\r"})
	wait(first, "45 97\r\n"+"rp-重连")
	first.Close()
	second, ready := connect()
	if ready.Replay == nil || !strings.Contains(*ready.Replay, "rp-重连") || !ready.Session.Alive {
		t.Fatalf("reconnect: %+v", ready.Session)
	}
	send(second, map[string]string{"type": "input", "data": "\x03"})
	send(second, map[string]string{"type": "input", "data": "printf 'after-%s\\n' interrupt\r"})
	wait(second, "after-interrupt")

	req, err := http.NewRequest("DELETE", server.URL+"/api/sessions/"+info.ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	response, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	io.Copy(io.Discard, response.Body)
	response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatalf("delete: %d", response.StatusCode)
	}
	select {
	case <-s.done:
	case <-time.After(3 * time.Second):
		t.Fatal("deleted shell is still running")
	}
}
