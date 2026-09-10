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
	if resp != nil {
		defer resp.Body.Close()
	}
	if err == nil && resp.StatusCode == http.StatusOK {
		gotenbergHealthy = true
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
	filename := filepath.Base(filepath.Clean(strings.TrimPrefix(r.URL.Path, "/api/file/")))
	if filename == "" || filename == "." || filename == "/" {
		http.Error(w, "Tên file không hợp lệ.", http.StatusBadRequest)
		return
	}
	filePath := filepath.Join(s.downloadDir, filename)

	relPath, relErr := filepath.Rel(s.downloadDir, filePath)
	if relErr != nil || strings.HasPrefix(relPath, "..") {
		http.Error(w, "Yêu cầu không hợp lệ.", http.StatusBadRequest)
		return
	}

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

	mimeType := "application/octet-stream"
	switch strings.ToLower(filepath.Ext(displayName)) {
	case ".vtt":
		mimeType = "text/vtt; charset=utf-8"
	case ".srt", ".txt":
		mimeType = "text/plain; charset=utf-8"
	case ".json":
		mimeType = "application/json; charset=utf-8"
	case ".mp3":
		mimeType = "audio/mpeg"
	case ".mp4":
		mimeType = "video/mp4"
	case ".png":
		mimeType = "image/png"
	case ".jpg", ".jpeg":
		mimeType = "image/jpeg"
	case ".webp":
		mimeType = "image/webp"
	case ".pdf":
		mimeType = "application/pdf"
	case ".docx":
		mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	case ".xlsx":
		mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	case ".pptx":
		mimeType = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
	}
	w.Header().Set("Content-Type", mimeType)

	http.ServeFile(w, r, filePath)
}
