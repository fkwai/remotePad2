package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"time"
)

type folder struct {
	Path   string `json:"path"`
	Name   string `json:"name"`
	Branch string `json:"branch,omitempty"`
}

type navigation struct {
	Favorites []folder `json:"favorites"`
	Repos     []folder `json:"repos"`
}

func (w *worker) readNavigation() (navigation, error) {
	data := navigation{Favorites: []folder{}, Repos: []folder{}}
	content, err := os.ReadFile(w.navigationPath())
	if err == nil {
		err = json.Unmarshal(content, &data)
		return data, err
	}
	if !errors.Is(err, os.ErrNotExist) {
		return data, err
	}
	for name, list := range map[string]*[]folder{"favorites.json": &data.Favorites, "workspaces.json": &data.Repos} {
		content, err := os.ReadFile(filepath.Join(w.home, ".remotepad", name))
		if err != nil {
			continue
		}
		var legacy struct{ Folders []folder }
		if json.Unmarshal(content, &legacy) == nil {
			for _, entry := range legacy.Folders {
				if entry.Path != "" && entry.Name != "" {
					*list = append(*list, folder{Path: entry.Path, Name: entry.Name})
				}
			}
		}
	}
	return data, nil
}

func (w *worker) navigationPath() string {
	return filepath.Join(w.home, ".remotepad2", "navigation.json")
}

func git(ctx context.Context, directory string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", append([]string{"-C", directory}, args...)...)
	output, err := cmd.Output()
	return strings.TrimSpace(string(output)), err
}

func (w *worker) registerNavigation(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/navigation", func(out http.ResponseWriter, req *http.Request) {
		data, err := w.readNavigation()
		if err != nil {
			fail(out, 400, err)
			return
		}
		for index, repo := range data.Repos {
			if branch, err := git(req.Context(), repo.Path, "branch", "--show-current"); err == nil {
				if branch == "" {
					branch = "detached"
				}
				data.Repos[index].Branch = branch
			}
		}
		reply(out, 200, data)
	})
	mux.HandleFunc("POST /api/navigation", func(out http.ResponseWriter, req *http.Request) {
		var input struct {
			Kind, Path string
			Remove     bool
		}
		if !body(out, req, 65536, &input) {
			return
		}
		if input.Kind != "favorites" && input.Kind != "repos" {
			fail(out, 400, errors.New("Invalid list"))
			return
		}
		target, err := filepath.Abs(input.Path)
		if err != nil {
			fail(out, 400, err)
			return
		}
		if !input.Remove {
			if info, err := os.Stat(target); err != nil || !info.IsDir() {
				fail(out, 400, errors.New("Choose a directory."))
				return
			}
			if input.Kind == "repos" {
				target, err = git(req.Context(), target, "rev-parse", "--show-toplevel")
				if err != nil {
					fail(out, 400, errors.New("Choose a Git repository."))
					return
				}
			}
		}
		w.navigationMu.Lock()
		defer w.navigationMu.Unlock()
		data, err := w.readNavigation()
		if err != nil {
			fail(out, 400, err)
			return
		}
		list := &data.Favorites
		if input.Kind == "repos" {
			list = &data.Repos
		}
		*list = slices.DeleteFunc(*list, func(entry folder) bool { return entry.Path == target })
		if !input.Remove {
			*list = append(*list, folder{Path: target, Name: filepath.Base(target)})
		}
		content, err := json.MarshalIndent(data, "", "  ")
		path := w.navigationPath()
		if err == nil {
			err = os.MkdirAll(filepath.Dir(path), 0700)
		}
		if err == nil {
			err = replaceFile(path, content, 0600)
		}
		if err != nil {
			fail(out, 400, err)
			return
		}
		reply(out, 200, map[string]bool{"ok": true})
	})
}
