package main

import (
	"bufio"
	"database/sql"
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

type codexSession struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Cwd       string `json:"cwd"`
	UpdatedAt int64  `json:"updatedAt"`
	Project   string `json:"project,omitempty"`
}

func (w *worker) codexHome() string {
	if home := os.Getenv("CODEX_HOME"); home != "" {
		return home
	}
	return filepath.Join(w.home, ".codex")
}

func (w *worker) lookupCodex(id string) (codexSession, error) {
	// During rollout an App-owned target uses the Node worker. If the App
	// appeared after the Go worker was started, avoid a second CLI owner.
	if info, err := os.Stat(filepath.Join(w.codexHome(), "ipc", "ipc.sock")); err == nil && info.Mode()&os.ModeSocket != 0 {
		return codexSession{}, errors.New("Codex App is running on the target. Reconnect SSH to use the App follower.")
	}
	rows, err := w.codexSessions()
	if err != nil {
		return codexSession{}, err
	}
	for _, row := range rows {
		if row.ID == id {
			return row, nil
		}
	}
	return codexSession{}, errors.New("Codex session unavailable.")
}

func (w *worker) codexSessions() ([]codexSession, error) {
	home := w.codexHome()
	entries, err := os.ReadDir(home)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	type database struct {
		path    string
		version int
	}
	var databases []database
	for _, entry := range entries {
		if version, ok := strings.CutPrefix(entry.Name(), "state_"); ok {
			if version, ok := strings.CutSuffix(version, ".sqlite"); ok {
				if number, err := strconv.Atoi(version); err == nil {
					databases = append(databases, database{filepath.Join(home, entry.Name()), number})
				}
			}
		}
	}
	sort.Slice(databases, func(i, j int) bool { return databases[i].version > databases[j].version })
	for _, db := range databases {
		if rows, err := w.sqliteSessions(db.path); err == nil {
			return rows, nil
		}
	}
	return w.indexSessions(filepath.Join(home, "session_index.jsonl"))
}

func (w *worker) sqliteSessions(path string) ([]codexSession, error) {
	name := url.URL{Scheme: "file", Path: path, RawQuery: "mode=ro"}
	db, err := sql.Open("sqlite", name.String())
	if err != nil {
		return nil, err
	}
	defer db.Close()
	var customName, projectID, projectTables int
	if err := db.QueryRow("SELECT count(*) FROM pragma_table_info('threads') WHERE name='name'").Scan(&customName); err != nil {
		return nil, err
	}
	if err := db.QueryRow("SELECT count(*) FROM pragma_table_info('threads') WHERE name='project_id'").Scan(&projectID); err != nil {
		return nil, err
	}
	if err := db.QueryRow("SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('projects', 'project_roots')").Scan(&projectTables); err != nil {
		return nil, err
	}
	title, project, join := "t.title", "NULL", ""
	if customName != 0 {
		title = "COALESCE(NULLIF(t.name, ''), t.title)"
	}
	if projectID != 0 && projectTables == 2 {
		project = "COALESCE(p.name, (SELECT p2.name FROM projects p2 JOIN project_roots r ON r.project_id=p2.id WHERE r.path=t.cwd ORDER BY r.position LIMIT 1))"
		join = "LEFT JOIN projects p ON p.id=t.project_id"
	}
	rows, err := db.Query("SELECT t.id, " + title + ", t.cwd, t.updated_at, " + project + " FROM threads t " + join +
		" WHERE t.archived=0 ORDER BY t.updated_at DESC LIMIT 200")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []codexSession{}
	for rows.Next() {
		var row codexSession
		var title, cwd, project sql.NullString
		var updated sql.NullInt64
		if err := rows.Scan(&row.ID, &title, &cwd, &updated, &project); err != nil {
			return nil, err
		}
		row.Title, row.Cwd, row.Project, row.UpdatedAt = title.String, cwd.String, project.String, updated.Int64*1000
		if row.Title == "" {
			row.Title = row.ID
		}
		if row.Project == "" && row.Cwd != "" {
			row.Project = filepath.Base(row.Cwd)
		}
		if row.Cwd == "" {
			row.Cwd = w.home
		}
		result = append(result, row)
	}
	return result, rows.Err()
}

func (w *worker) indexSessions(path string) ([]codexSession, error) {
	rows := []codexSession{}
	file, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return rows, nil
	}
	if err != nil {
		return nil, err
	}
	defer file.Close()
	seen := map[string]codexSession{}
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 4096), 4*1024*1024)
	for scanner.Scan() {
		var line struct {
			ID        string
			Title     string `json:"thread_name"`
			UpdatedAt string `json:"updated_at"`
		}
		if json.Unmarshal(scanner.Bytes(), &line) != nil || line.ID == "" {
			continue
		}
		row := codexSession{ID: line.ID, Title: line.Title, Cwd: w.home}
		if row.Title == "" {
			row.Title = row.ID
		}
		if updated, err := time.Parse(time.RFC3339Nano, line.UpdatedAt); err == nil {
			row.UpdatedAt = updated.UnixMilli()
		}
		seen[row.ID] = row
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	for _, row := range seen {
		rows = append(rows, row)
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].UpdatedAt > rows[j].UpdatedAt })
	return rows[:min(len(rows), 200)], nil
}
