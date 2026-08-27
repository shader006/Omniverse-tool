package main

import (
	"bufio"
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type Job struct {
	JobID       string  `json:"job_id"`
	URL         string  `json:"url"`
	Format      string  `json:"format"`
	Quality     string  `json:"quality"`
	Status      string  `json:"status"` // "queued", "downloading", "completed", "error"
	Percent     float64 `json:"percent"`
	Speed       string  `json:"speed"`
	ETA         string  `json:"eta"`
	Filename    string  `json:"filename,omitempty"`
	DownloadURL string  `json:"download_url,omitempty"`
	Error       string  `json:"error,omitempty"`
	CreatedAt   float64 `json:"created_at"`
}

type InfoRequest struct {
	URL string `json:"url"`
}

type DownloadRequest struct {
	URL     string `json:"url"`
	Format  string `json:"format"`
	Quality string `json:"quality"`
}

type Server struct {
	cache       *CacheManager
	jobs        sync.Map
	downloadDir string
	frontendDir string
}

func randomID() string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"status":  "healthy",
		"engine":  "Omniverse-Golang-Core",
		"version": "3.0.0",
	})
}

func (s *Server) handleInfo(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req InfoRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.URL) == "" {
		http.Error(w, `{"success":false,"detail":"URL không hợp lệ"}`, http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")

	// 1. Kiểm tra Go In-Memory Cache (0.0001 ms)
	cacheKey := GenerateCacheKey(req.URL, "info", "info")
	if cachedData, found := s.cache.GetMetadata(cacheKey); found {
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"data":    cachedData,
			"cached":  true,
		})
		return
	}

	// 2. Chạy Python url_conver worker qua CLI
	cmd := exec.Command("python3", "-m", "app.url_conver.cli", "info", "--url", req.URL)
	cmd.Dir = "/app"
	out, _ := cmd.CombinedOutput()
	outStr := string(out)

	var jsonStr string
	if strings.Contains(outStr, "FINAL_RESULT:") {
		jsonStr = strings.TrimSpace(outStr[strings.Index(outStr, "FINAL_RESULT:")+len("FINAL_RESULT:"):])
	} else {
		jsonStr = strings.TrimSpace(outStr)
	}

	var result struct {
		Success bool                   `json:"success"`
		Data    map[string]interface{} `json:"data,omitempty"`
		Error   string                 `json:"error,omitempty"`
	}

	if err := json.Unmarshal([]byte(jsonStr), &result); err != nil || !result.Success {
		w.WriteHeader(http.StatusBadRequest)
		errMsg := result.Error
		if errMsg == "" {
			errMsg = "Không thể trích xuất thông tin từ liên kết này. Vui lòng kiểm tra lại URL."
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"detail":  errMsg,
		})
		return
	}

	if result.Data != nil {
		s.cache.SetMetadata(cacheKey, result.Data, DefaultCacheTTL)
	}

	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(jsonStr))
}

func (s *Server) handleDownload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req DownloadRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.URL) == "" {
		http.Error(w, `{"success":false,"detail":"Dữ liệu request không hợp lệ"}`, http.StatusBadRequest)
		return
	}

	if req.Format == "" {
		req.Format = "mp3"
	}
	if req.Quality == "" {
		req.Quality = "320"
	}

	jobID := randomID()
	w.Header().Set("Content-Type", "application/json")

	// 1. Kiểm tra File Cache trong ổ đĩa
	if cachedFile, found := s.cache.FindCachedFile(req.URL, req.Format, req.Quality); found {
		job := Job{
			JobID:       jobID,
			URL:         req.URL,
			Format:      req.Format,
			Quality:     req.Quality,
			Status:      "completed",
			Percent:     100.0,
			Speed:       "Cached",
			ETA:         "0s",
			Filename:    cachedFile,
			DownloadURL: fmt.Sprintf("/api/file/%s", cachedFile),
			CreatedAt:   float64(time.Now().Unix()),
		}
		s.jobs.Store(jobID, job)

		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"job_id":  jobID,
			"cached":  true,
		})
		return
	}

	// 2. Tạo Job mới trong RAM
	job := Job{
		JobID:     jobID,
		URL:       req.URL,
		Format:    req.Format,
		Quality:   req.Quality,
		Status:    "queued",
		Percent:   0.0,
		Speed:     "-",
		ETA:       "-",
		CreatedAt: float64(time.Now().Unix()),
	}
	s.jobs.Store(jobID, job)

	// 3. Khởi động Goroutine tải ngầm gọi Python url_conver
	go s.processDownloadJob(jobID, req.URL, req.Format, req.Quality)

	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"job_id":  jobID,
		"cached":  false,
	})
}

func (s *Server) processDownloadJob(jobID, url, mediaFormat, quality string) {
	if val, ok := s.jobs.Load(jobID); ok {
		j := val.(Job)
		j.Status = "downloading"
		s.jobs.Store(jobID, j)
	}

	cmd := exec.Command("python3", "-m", "app.url_conver.cli", "download",
		"--url", url,
		"--format", mediaFormat,
		"--quality", quality,
		"--output", s.downloadDir,
	)
	cmd.Dir = "/app"

	var stdoutBuf bytes.Buffer
	cmd.Stdout = &stdoutBuf

	stderr, err := cmd.StderrPipe()
	if err != nil {
		s.failJob(jobID, err.Error())
		return
	}

	if err := cmd.Start(); err != nil {
		s.failJob(jobID, err.Error())
		return
	}

	// Đọc realtime progress từ stderr
	scanner := bufio.NewScanner(stderr)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "PROGRESS:") {
			jsonStr := strings.TrimPrefix(line, "PROGRESS:")
			var prog struct {
				Percent float64 `json:"percent"`
				Message string  `json:"message"`
			}
			if err := json.Unmarshal([]byte(jsonStr), &prog); err == nil {
				if val, ok := s.jobs.Load(jobID); ok {
					j := val.(Job)
					j.Percent = prog.Percent
					j.Speed = prog.Message
					s.jobs.Store(jobID, j)
				}
			}
		}
	}

	_ = cmd.Wait()

	// Parse JSON output từ stdout
	var res struct {
		Success  bool   `json:"success"`
		Filename string `json:"filename"`
		Error    string `json:"error"`
	}

	stdoutBytes := bytes.TrimSpace(stdoutBuf.Bytes())
	if len(stdoutBytes) > 0 {
		outStr := string(stdoutBytes)
		var jsonStr string
		if strings.Contains(outStr, "FINAL_RESULT:") {
			jsonStr = strings.TrimSpace(outStr[strings.Index(outStr, "FINAL_RESULT:")+len("FINAL_RESULT:"):])
		} else {
			lines := strings.Split(outStr, "\n")
			for i := len(lines) - 1; i >= 0; i-- {
				line := strings.TrimSpace(lines[i])
				if strings.HasPrefix(line, "{") && strings.HasSuffix(line, "}") {
					jsonStr = line
					break
				}
			}
		}

		if jsonStr != "" && json.Unmarshal([]byte(jsonStr), &res) == nil && res.Success {
			if val, ok := s.jobs.Load(jobID); ok {
				j := val.(Job)
				j.Status = "completed"
				j.Percent = 100.0
				j.Filename = res.Filename
				j.DownloadURL = fmt.Sprintf("/api/file/%s", res.Filename)
				s.jobs.Store(jobID, j)
				return
			}
		}
	}

	errText := res.Error
	if errText == "" {
		errText = "Lỗi khi xử lý tải file hoặc liên kết không khả dụng."
	}
	s.failJob(jobID, errText)
}

func (s *Server) failJob(jobID, errMsg string) {
	if val, ok := s.jobs.Load(jobID); ok {
		j := val.(Job)
		j.Status = "error"
		j.Error = errMsg
		s.jobs.Store(jobID, j)
	}
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	jobID := strings.TrimPrefix(r.URL.Path, "/api/status/")
	val, ok := s.jobs.Load(jobID)
	if !ok {
		http.Error(w, `{"error":"Không tìm thấy Job ID"}`, http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(val)
}

func (s *Server) handleStream(w http.ResponseWriter, r *http.Request) {
	jobID := strings.TrimPrefix(r.URL.Path, "/api/stream/")
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "SSE Streaming không được hỗ trợ", http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
			val, exists := s.jobs.Load(jobID)
			if !exists {
				return
			}
			job := val.(Job)
			data, _ := json.Marshal(job)
			_, _ = fmt.Fprintf(w, "event: progress\ndata: %s\n\n", string(data))
			flusher.Flush()

			if job.Status == "completed" || job.Status == "error" {
				return
			}
		}
	}
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

func main() {
	downloadDir := os.Getenv("DOWNLOAD_DIR")
	if downloadDir == "" {
		downloadDir = "/app/downloads"
	}

	frontendDir := os.Getenv("FRONTEND_DIR")
	if frontendDir == "" {
		frontendDir = "/frontend"
	}

	server := &Server{
		cache:       NewCacheManager(downloadDir),
		downloadDir: downloadDir,
		frontendDir: frontendDir,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", server.handleHealth)
	mux.HandleFunc("/api/info", server.handleInfo)
	mux.HandleFunc("/api/download", server.handleDownload)
	mux.HandleFunc("/api/status/", server.handleStatus)
	mux.HandleFunc("/api/stream/", server.handleStream)
	mux.HandleFunc("/api/file/", server.handleFile)

	// Serve Frontend Web UI
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" || r.URL.Path == "/index.html" {
			http.ServeFile(w, r, filepath.Join(frontendDir, "index.html"))
			return
		}
		// Serve static assets
		filePath := filepath.Join(frontendDir, r.URL.Path)
		if _, err := os.Stat(filePath); err == nil {
			http.ServeFile(w, r, filePath)
			return
		}
		http.ServeFile(w, r, filepath.Join(frontendDir, "index.html"))
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8000"
	}

	log.Printf("🚀 [OMNIVERSE GO SERVER] Đang lắng nghe tại http://0.0.0.0:%s", port)
	if err := http.ListenAndServe(":"+port, corsMiddleware(mux)); err != nil {
		log.Fatalf("Lỗi khởi động Server: %v", err)
	}
}
