package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"os/exec"
	"strings"
	"time"
)

func (s *Server) callWorkerJSON(workerBaseURL string, path string, payload interface{}) ([]byte, int, error) {
	jsonBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, http.StatusBadRequest, err
	}
	targetURL := strings.TrimRight(workerBaseURL, "/") + path
	req, err := http.NewRequest(http.MethodPost, targetURL, bytes.NewReader(jsonBytes))
	if err != nil {
		return nil, http.StatusInternalServerError, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, http.StatusBadGateway, err
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	return respBody, resp.StatusCode, err
}

func (s *Server) forwardMultipartToWorker(workerBaseURL string, path string, fileBytes []byte, filename string, fieldName string, formValues map[string]string) ([]byte, int, error) {
	bodyBuf := &bytes.Buffer{}
	writer := multipart.NewWriter(bodyBuf)
	part, err := writer.CreateFormFile(fieldName, filename)
	if err != nil {
		return nil, http.StatusInternalServerError, err
	}
	if _, err := part.Write(fileBytes); err != nil {
		return nil, http.StatusInternalServerError, err
	}
	for k, v := range formValues {
		_ = writer.WriteField(k, v)
	}
	if err := writer.Close(); err != nil {
		return nil, http.StatusInternalServerError, err
	}

	targetURL := strings.TrimRight(workerBaseURL, "/") + path
	req, err := http.NewRequest(http.MethodPost, targetURL, bodyBuf)
	if err != nil {
		return nil, http.StatusInternalServerError, err
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, http.StatusBadGateway, err
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	return respBody, resp.StatusCode, err
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

	// 1. Kiểm tra Pogocache Engine (0.0001 ms)
	cacheKey := GenerateCacheKey(req.URL, "info", "info")
	if cachedData, found := s.pogo.GetMetadata(cacheKey); found {
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"data":    cachedData,
			"cached":  true,
		})
		return
	}

	// 2. Nếu có Worker YT-DLP Microservice -> Gọi qua HTTP
	if s.workerYtdlpURL != "" {
		respBytes, statusCode, err := s.callWorkerJSON(s.workerYtdlpURL, "/api/info", req)
		if err == nil && statusCode == http.StatusOK {
			var result struct {
				Success bool                   `json:"success"`
				Data    map[string]interface{} `json:"data,omitempty"`
				Error   string                 `json:"error,omitempty"`
			}
			if json.Unmarshal(respBytes, &result) == nil && result.Success {
				if result.Data != nil {
					s.pogo.SetMetadata(cacheKey, result.Data, DefaultCacheTTL)
				}
				w.WriteHeader(http.StatusOK)
				_, _ = w.Write(respBytes)
				return
			}
		}
		log.Printf("⚠️ [WORKER YT-DLP] Gọi worker /api/info thất bại (%v), fallback sang CLI cục bộ...", err)
	}

	// 3. Chạy Python url_conver worker qua CLI cục bộ
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
		s.pogo.SetMetadata(cacheKey, result.Data, DefaultCacheTTL)
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
	if cachedFile, found := s.pogo.FindCachedFile(req.URL, req.Format, req.Quality); found {
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
		s.pogo.PublishJobUpdate(job)

		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"job_id":  jobID,
			"cached":  true,
		})
		return
	}

	// 2. Tạo Job mới và lưu vào Pogocache Engine
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
	s.pogo.PublishJobUpdate(job)

	// 3. Khởi động Goroutine tải ngầm gọi Python url_conver (kèm Semaphore Concurrency Limiter)
	go s.processDownloadJob(jobID, req.URL, req.Format, req.Quality)

	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"job_id":  jobID,
		"cached":  false,
	})
}

func (s *Server) processDownloadJob(jobID, url, mediaFormat, quality string) {
	// Giới hạn số lượng ffmpeg chạy đồng thời (tránh bóp nghẽn CPU)
	s.mediaLimiter <- struct{}{}
	defer func() { <-s.mediaLimiter }()

	if j, ok := s.pogo.GetJob(jobID); ok {
		j.Status = "downloading"
		s.pogo.PublishJobUpdate(j)
	}

	// 1. Nếu có Worker YT-DLP Microservice -> Chuyển giao qua HTTP
	if s.workerYtdlpURL != "" {
		payload := map[string]string{
			"job_id":       jobID,
			"url":          url,
			"format":       mediaFormat,
			"quality":      quality,
			"download_dir": s.downloadDir,
		}
		_, statusCode, err := s.callWorkerJSON(s.workerYtdlpURL, "/api/download", payload)
		if err == nil && statusCode == http.StatusOK {
			log.Printf("✅ [WORKER YT-DLP] Đã chuyển giao Job %s sang worker-ytdlp xử lý", jobID)
			return
		}
		log.Printf("⚠️ [WORKER YT-DLP] Gọi worker /api/download thất bại (%v), fallback sang CLI cục bộ...", err)
	}

	// 2. Fallback sang CLI cục bộ
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
				if j, ok := s.pogo.GetJob(jobID); ok {
					j.Percent = prog.Percent
					j.Speed = prog.Message
					s.pogo.PublishJobUpdate(j)
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
			if j, ok := s.pogo.GetJob(jobID); ok {
				j.Status = "completed"
				j.Percent = 100.0
				j.Filename = res.Filename
				j.DownloadURL = fmt.Sprintf("/api/file/%s", res.Filename)
				s.pogo.PublishJobUpdate(j)
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
	if j, ok := s.pogo.GetJob(jobID); ok {
		j.Status = "error"
		j.Error = errMsg
		s.pogo.PublishJobUpdate(j)
	}
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	jobID := strings.TrimPrefix(r.URL.Path, "/api/status/")
	val, ok := s.pogo.GetJob(jobID)
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
	w.Header().Set("X-Accel-Buffering", "no")

	// Đăng ký nhận sự kiện realtime từ Pogocache Engine
	jobCh, cleanup := s.pogo.SubscribeJob(r.Context(), jobID)
	defer cleanup()

	// Gửi ngay trạng thái ban đầu nếu có
	if initialJob, exists := s.pogo.GetJob(jobID); exists {
		data, _ := json.Marshal(initialJob)
		_, _ = fmt.Fprintf(w, "event: progress\ndata: %s\n\n", string(data))
		flusher.Flush()
		if initialJob.Status == "completed" || initialJob.Status == "error" {
			return
		}
	}

	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case job, ok := <-jobCh:
			if !ok {
				return
			}
			data, _ := json.Marshal(job)
			_, _ = fmt.Fprintf(w, "event: progress\ndata: %s\n\n", string(data))
			flusher.Flush()
			if job.Status == "completed" || job.Status == "error" {
				return
			}
		case <-ticker.C:
			// Heartbeat và Polling an toàn
			if currentJob, exists := s.pogo.GetJob(jobID); exists {
				data, _ := json.Marshal(currentJob)
				_, _ = fmt.Fprintf(w, "event: progress\ndata: %s\n\n", string(data))
				flusher.Flush()
				if currentJob.Status == "completed" || currentJob.Status == "error" {
					return
				}
			}
		}
	}
}
