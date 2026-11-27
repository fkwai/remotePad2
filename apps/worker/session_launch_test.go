package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestManagedAgentSessions(t *testing.T) {
	home := t.TempDir()
	bin := filepath.Join(home, "bin")
	if err := os.Mkdir(bin, 0700); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"codex", "claude", "custom-agent"} {
		if err := os.WriteFile(filepath.Join(bin, name), []byte("#!/bin/sh\nprintf 'FAKE_AGENT_READY:%s\\n' \"$*\"\nwhile IFS= read -r value; do printf 'reply:%s\\n' \"$value\"; done\n"), 0700); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	w := newWorker(home, "dev")
	defer w.terminals.close()
	handler := w.routes()
	infos := []sessionInfo{}
	for _, agent := range []string{"codex", "claude", "custom"} {
		payload := sessionRequest{Agent: agent, Name: "Task " + agent, Cwd: home, Project: "Demo project"}
		if agent == "custom" {
			payload.Command = "'" + filepath.Join(bin, "custom-agent") + "' \"hello world\" 'a;b'"
		}
		response := request(t, handler, "POST", "/api/sessions", payload, 200)
		var info sessionInfo
		if err := json.Unmarshal(response.Body.Bytes(), &info); err != nil {
			t.Fatal(err)
		}
		if info.Agent != agent || info.Project != "Demo project" || info.Machine == "" || info.CreatedAt == 0 || !info.Alive {
			t.Fatalf("metadata: %+v", info)
		}
		infos = append(infos, info)
	}
	renamed := request(t, handler, "PATCH", "/api/sessions/"+infos[0].ID, map[string]string{"name": "My title"}, 200)
	var info sessionInfo
	_ = json.Unmarshal(renamed.Body.Bytes(), &info)
	if info.Name != "My title" || !info.Renamed || !info.Alive {
		t.Fatalf("rename: %+v", info)
	}
	request(t, handler, "DELETE", "/api/sessions/"+infos[0].ID, nil, 200)
	list := request(t, handler, "GET", "/api/sessions", nil, 200)
	var remaining struct{ Sessions []sessionInfo }
	_ = json.Unmarshal(list.Body.Bytes(), &remaining)
	if len(remaining.Sessions) != 2 {
		t.Fatalf("remaining: %+v", remaining)
	}
	for _, info := range remaining.Sessions {
		if !info.Alive {
			t.Fatalf("other agent was stopped: %+v", info)
		}
	}
	for _, payload := range []sessionRequest{{Agent: "unknown"}, {Agent: "custom", Command: "tool 'unclosed"}, {Cwd: filepath.Join(home, "missing")}} {
		request(t, handler, "POST", "/api/sessions", payload, 400)
	}
	request(t, handler, "PATCH", "/api/sessions/"+infos[1].ID, map[string]string{"name": " "}, 400)
}
func TestCommandArguments(t *testing.T) {
	escaped, err := commandArguments(`tool "\d+" "a\qb" "\$HOME"`)
	if err != nil || escaped[1] != `\d+` || escaped[2] != `a\qb` || escaped[3] != "$HOME" {
		t.Fatalf("escaped argv: %q %v", escaped, err)
	}

	args, err := commandArguments(`tool "hello world" '' 'a;b' '$(touch /tmp/no)'`)
	if err != nil || len(args) != 5 || args[1] != "hello world" || args[2] != "" || args[3] != "a;b" || !strings.Contains(args[4], "$(touch") {
		t.Fatalf("argv: %q %v", args, err)
	}
	for _, command := range []string{"", "tool 'unclosed", "tool\nnext"} {
		if _, err := commandArguments(command); err == nil {
			t.Fatalf("accepted invalid command %q", command)
		}
	}
}
