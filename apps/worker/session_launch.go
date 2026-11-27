package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"unicode"
	"unicode/utf8"
)

type sessionRequest struct {
	Agent   string `json:"agent"`
	Name    string `json:"name"`
	Cwd     string `json:"cwd"`
	Project string `json:"project"`
	Command string `json:"command"`
	CodexID string `json:"codexId"`
}
type sessionPlan struct {
	info    sessionInfo
	command []string
}

// Parse argv without shell evaluation. Explicit shells remain ordinary CLIs.
func commandArguments(command string) ([]string, error) {
	if len(command) > 4096 || strings.ContainsAny(command, "\x00\r\n") {
		return nil, errors.New("Enter one CLI command with optional quoted arguments.")
	}
	args := []string{}
	token := []rune{}
	var quote rune
	escape, started := false, false
	characters := []rune(command)
	for index, c := range characters {
		if escape {
			token = append(token, c)
			escape = false
			continue
		}
		if c == '\\' && quote != '\'' {
			if quote == '"' && index+1 < len(characters) && !strings.ContainsRune("\"\\$`", characters[index+1]) {
				token = append(token, '\\')
				started = true
				continue
			}
			escape = true
			started = true
			continue
		}
		if quote != 0 {
			if c == quote {
				quote = 0
			} else {
				token = append(token, c)
			}
			continue
		}
		if c == '"' || c == '\'' {
			quote = c
			started = true
			continue
		}
		if unicode.IsSpace(c) {
			if started {
				args = append(args, string(token))
				token = nil
				started = false
			}
		} else {
			token = append(token, c)
			started = true
		}
	}
	if quote != 0 || escape {
		return nil, errors.New("Close the quote or escaped argument in the CLI command.")
	}
	if started {
		args = append(args, string(token))
	}
	if len(args) == 0 || args[0] == "" || len(args) > 64 {
		return nil, errors.New("Choose an executable and at most 63 arguments.")
	}
	return args, nil
}
func planSession(home string, request sessionRequest, codex codexSession) (sessionPlan, error) {
	agent := request.Agent
	if agent == "" {
		if request.CodexID != "" {
			agent = "codex"
		} else {
			agent = "shell"
		}
	}
	if request.CodexID != "" && agent != "codex" {
		return sessionPlan{}, errors.New("Codex history must use the Codex agent.")
	}
	if (request.Command != "" && agent != "custom") || utf8.RuneCountInString(request.Name) > 160 || utf8.RuneCountInString(request.Project) > 100 || len(request.Cwd) > 4096 || strings.ContainsAny(request.Name+request.Project+request.Cwd, "\x00\r\n") {
		return sessionPlan{}, errors.New("Invalid session options.")
	}
	info := sessionInfo{Agent: agent, Cwd: strings.TrimSpace(request.Cwd), Renamed: strings.TrimSpace(request.Name) != ""}
	if info.Cwd == "" {
		info.Cwd = home
	}
	command := []string{}
	switch agent {
	case "shell":
		info.Name = "Shell"
		command = []string{shell(), "-l"}
	case "codex":
		info.Name = "Codex"
		command = []string{"codex", "--no-alt-screen"}
		if codex.ID != "" {
			info.Name, info.Cwd, info.CodexID = codex.Title, codex.Cwd, codex.ID
			command = []string{"codex", "resume", codex.ID, "--no-alt-screen"}
			info.Project = codex.Project
		}
	case "claude":
		info.Name = "Claude Code"
		command = []string{"claude"}
	case "custom":
		var err error
		command, err = commandArguments(request.Command)
		if err != nil {
			return sessionPlan{}, err
		}
		info.Name = filepath.Base(command[0])
	default:
		return sessionPlan{}, errors.New("Unknown agent type.")
	}
	cwd, err := filepath.Abs(info.Cwd)
	if err != nil {
		return sessionPlan{}, err
	}
	info.Cwd = cwd
	attr, err := os.Stat(info.Cwd)
	if err != nil {
		return sessionPlan{}, err
	}
	if !attr.IsDir() {
		return sessionPlan{}, errors.New("Choose a working directory.")
	}
	if name := strings.TrimSpace(request.Name); name != "" {
		info.Name = name
	}
	if project := strings.TrimSpace(request.Project); project != "" {
		info.Project = project
	}
	if info.Project == "" {
		info.Project = filepath.Base(info.Cwd)
	}
	info.Machine, _ = os.Hostname()
	return sessionPlan{info: info, command: command}, nil
}
