package main

import (
	"encoding/json"
	"fmt"
	"io"
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
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	rawFilename := strings.TrimPrefix(r.URL.Path, "/api/file/")
	unescapedFilename, err := url.PathUnescape(rawFilename)
	if err != nil {
		http.Error(w, "Đường dẫn file không hợp lệ.", http.StatusBadRequest)
		return
	}

	filename := filepath.Base(filepath.Clean(unescapedFilename))
	if filename == "." || filename == "/" || filename == "" {
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
		if s.proxyFileFromWorkers(w, r, filename) {
			return
		}
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

func (s *Server) proxyFileFromWorkers(w http.ResponseWriter, r *http.Request, filename string) bool {
	workers := []string{s.workerRmbgURL, s.workerWhisperURL}
	for _, workerURL := range workers {
		if workerURL == "" {
			continue
		}
		targetURL := fmt.Sprintf("%s/api/file/%s", strings.TrimRight(workerURL, "/"), url.PathEscape(filename))
		req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, targetURL, nil)
		if err != nil {
			continue
		}
		resp, err := s.httpClient.Do(req)
		if err != nil {
			continue
		}
		if resp.StatusCode == http.StatusOK {
			defer resp.Body.Close()
			for k, v := range resp.Header {
				if strings.EqualFold(k, "Content-Type") || strings.EqualFold(k, "Content-Disposition") || strings.EqualFold(k, "Content-Length") {
					w.Header()[k] = v
				}
			}
			w.WriteHeader(http.StatusOK)
			_, _ = io.Copy(w, resp.Body)
			return true
		}
		resp.Body.Close()
	}
	return false
}

