package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	gotenbergHealthy := false
	healthURL, finish := s.gotenbergLB.SelectEndpoint("/health")
	resp, err := http.Get(healthURL)
	finish(err)
	if err == nil && resp.StatusCode == http.StatusOK {
		gotenbergHealthy = true
		_ = resp.Body.Close()
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"status":           "healthy",
		"engine":           "Omniverse-Golang-Core",
		"version":          "3.1.0",
		"gotenberg_status": gotenbergHealthy,
		"gotenberg_url":    s.gotenbergLB.rawTarget,
		"lb_algorithm":     "P2C-Peak-EWMA-Dynamic",
	})
}

func (s *Server) handleFile(w http.ResponseWriter, r *http.Request) {
	filename := strings.TrimPrefix(r.URL.Path, "/api/file/")
	filePath := filepath.Join(s.downloadDir, filename)

	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		http.Error(w, "File không tồn tại hoặc đã hết hạn.", http.StatusNotFound)
		return
	}

	displayName := filename
	if strings.Contains(filename, "_") {
		parts := strings.SplitN(filename, "_", 2)
		displayName = parts[1]
	}

	encodedName := url.PathEscape(displayName)
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"; filename*=UTF-8''%s", displayName, encodedName))
	w.Header().Set("Content-Type", "application/octet-stream")

	http.ServeFile(w, r, filePath)
}
