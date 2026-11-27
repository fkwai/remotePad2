package main

import (
	"bytes"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

const editorLimit = 2 * 1024 * 1024

type fileContent struct {
	Path     string `json:"path"`
	Content  string `json:"content"`
	Revision string `json:"revision"`
}

type fileEntry struct {
	Name       string `json:"name"`
	Path       string `json:"path"`
	Directory  bool   `json:"directory"`
	Size       *int64 `json:"size,omitempty"`
	ModifiedAt *int64 `json:"modifiedAt,omitempty"`
}

func openRegular(path string) (*os.File, os.FileInfo, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, nil, errors.New("Choose a regular file.")
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, nil, err
	}
	info, err = file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		file.Close()
		if err == nil {
			err = errors.New("Choose a regular file.")
		}
		return nil, nil, err
	}
	return file, info, nil
}

func readFile(path string) (fileContent, os.FileMode, error) {
	file, info, err := openRegular(path)
	if err != nil {
		return fileContent{}, 0, err
	}
	defer file.Close()
	if info.Size() > editorLimit {
		return fileContent{}, 0, errors.New("File exceeds the 2 MB editor limit.")
	}
	data, err := io.ReadAll(io.LimitReader(file, editorLimit+1))
	if err != nil {
		return fileContent{}, 0, err
	}
	if len(data) > editorLimit {
		return fileContent{}, 0, errors.New("File exceeds the 2 MB editor limit.")
	}
	if !utf8.Valid(data) || bytes.IndexByte(data, 0) >= 0 {
		return fileContent{}, 0, errors.New("Binary file cannot be edited as text.")
	}
	return fileContent{Path: path, Content: strings.TrimPrefix(string(data), "\uFEFF"),
		Revision: fmt.Sprintf("%x", sha256.Sum256(data))}, info.Mode().Perm(), nil
}

func replaceFile(path string, data []byte, mode os.FileMode) error {
	file, err := os.CreateTemp(filepath.Dir(path), ".remotepad-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	_, writeErr := file.Write(data)
	modeErr := file.Chmod(mode)
	closeErr := file.Close()
	if err := errors.Join(writeErr, modeErr, closeErr); err != nil {
		return err
	}
	return os.Rename(file.Name(), path)
}

func resolveFile(path string) (string, error) {
	if path == "" {
		return "", errors.New("Choose a file.")
	}
	path, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	return filepath.EvalSymlinks(path)
}

func (w *worker) directory(req *http.Request) (string, error) {
	path := req.URL.Query().Get("path")
	if path == "" {
		path = w.home
	}
	return filepath.Abs(path)
}

func (w *worker) registerFiles(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/files", w.listFiles)
	mux.HandleFunc("GET /api/search", w.searchFiles)
	mux.HandleFunc("GET /api/preview/{key}/{path...}", w.previewFile)
	mux.HandleFunc("GET /api/file", func(out http.ResponseWriter, req *http.Request) {
		path, err := resolveFile(req.URL.Query().Get("path"))
		if err != nil {
			fail(out, 400, err)
			return
		}
		content, _, err := readFile(path)
		if err != nil {
			fail(out, 400, err)
			return
		}
		reply(out, 200, content)
	})
	mux.HandleFunc("PUT /api/file", w.saveFile)
}

func (w *worker) saveFile(out http.ResponseWriter, req *http.Request) {
	var input struct {
		Path, Revision string
		Content        *string
	}
	if !body(out, req, editorLimit+65536, &input) {
		return
	}
	if input.Content == nil || len(*input.Content) > editorLimit {
		fail(out, 400, errors.New("Invalid file content or file too large."))
		return
	}
	w.filesMu.Lock()
	defer w.filesMu.Unlock()
	path, err := resolveFile(input.Path)
	if err != nil {
		fail(out, 400, err)
		return
	}
	current, mode, err := readFile(path)
	if err != nil {
		fail(out, 400, err)
		return
	}
	if current.Revision != input.Revision {
		fail(out, 409, errors.New("File changed on disk. Reopen it to compare before saving."))
		return
	}
	if err := replaceFile(path, []byte(*input.Content), mode); err != nil {
		fail(out, 400, err)
		return
	}
	content, _, err := readFile(path)
	if err != nil {
		fail(out, 400, err)
		return
	}
	reply(out, 200, content)
}

func (w *worker) listFiles(out http.ResponseWriter, req *http.Request) {
	path, err := w.directory(req)
	if err != nil {
		fail(out, 400, err)
		return
	}
	children, err := os.ReadDir(path)
	if err != nil {
		fail(out, 400, err)
		return
	}
	details := req.URL.Query().Get("details") == "1"
	entries := []fileEntry{}
	for _, child := range children {
		if !child.IsDir() && !child.Type().IsRegular() {
			continue
		}
		entry := fileEntry{Name: child.Name(), Path: filepath.Join(path, child.Name()), Directory: child.IsDir()}
		if details {
			if info, err := child.Info(); err == nil {
				size, mtime := info.Size(), info.ModTime().UnixMilli()
				entry.Size, entry.ModifiedAt = &size, &mtime
			}
		}
		entries = append(entries, entry)
	}
	sort.SliceStable(entries, func(i, j int) bool {
		if entries[i].Directory != entries[j].Directory {
			return entries[i].Directory
		}
		return strings.ToLower(entries[i].Name) < strings.ToLower(entries[j].Name)
	})
	reply(out, 200, map[string]any{"path": path, "parent": filepath.Dir(path), "entries": entries})
}

var previewTypes = map[string]string{
	".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8",
	".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
	".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
	".bmp": "image/bmp", ".ico": "image/x-icon", ".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8", ".woff": "font/woff", ".woff2": "font/woff2", ".json": "application/json",
}

func (w *worker) previewFile(out http.ResponseWriter, req *http.Request) {
	key := req.PathValue("key")
	if key != w.previewKey && key != req.Header.Get("X-RemotePad2-Preview-Key") {
		fail(out, 404, errors.New("Preview unavailable."))
		return
	}
	path, err := resolveFile("/" + req.PathValue("path"))
	if err != nil {
		fail(out, 404, err)
		return
	}
	file, info, err := openRegular(path)
	if err != nil {
		fail(out, 400, err)
		return
	}
	defer file.Close()
	if info.Size() > 32*1024*1024 {
		fail(out, 413, errors.New("Preview exceeds 32 MB."))
		return
	}
	contentType := previewTypes[strings.ToLower(filepath.Ext(path))]
	if contentType == "" {
		contentType = "text/plain; charset=utf-8"
	}
	out.Header().Set("Content-Type", contentType)
	out.Header().Set("Content-Security-Policy", "sandbox allow-scripts allow-downloads")
	out.Header().Set("X-Content-Type-Options", "nosniff")
	out.Header().Set("Cache-Control", "no-cache")
	http.ServeContent(out, req, filepath.Base(path), info.ModTime(), file)
}

func (w *worker) searchFiles(out http.ResponseWriter, req *http.Request) {
	query := strings.ToLower(strings.TrimSpace(req.URL.Query().Get("q")))
	if query == "" || utf8.RuneCountInString(query) > 200 {
		fail(out, 400, errors.New("Enter a file or folder name (up to 200 characters)."))
		return
	}
	root, err := w.directory(req)
	if err != nil {
		fail(out, 400, err)
		return
	}
	if info, err := os.Stat(root); err != nil || !info.IsDir() {
		fail(out, 400, errors.New("Choose a searchable directory."))
		return
	}
	hidden := req.URL.Query().Get("hidden") == "true"
	truncated := false
	deadline := time.Now().Add(3 * time.Second)
	hits, queue, entries := []fileEntry{}, []string{root}, 0
walk:
	for index := 0; index < len(queue); index++ {
		if index >= 1500 || time.Now().After(deadline) || req.Context().Err() != nil {
			truncated = true
			break
		}
		children, _ := os.ReadDir(queue[index])
		for _, child := range children {
			entries++
			if entries > 30000 {
				truncated = true
				break walk
			}
			name := child.Name()
			switch name {
			case "node_modules", ".git", "dist", ".pnpm-store", ".cache":
				continue
			}
			if (!hidden && strings.HasPrefix(name, ".")) || (!child.IsDir() && !child.Type().IsRegular()) {
				continue
			}
			path := filepath.Join(queue[index], name)
			if strings.Contains(strings.ToLower(name), query) {
				hits = append(hits, fileEntry{Name: name, Path: path, Directory: child.IsDir()})
				if len(hits) == 200 {
					truncated = true
					break walk
				}
			}
			if child.IsDir() {
				queue = append(queue, path)
			}
		}
	}
	reply(out, 200, map[string]any{"path": root, "hits": hits, "truncated": truncated})
}
