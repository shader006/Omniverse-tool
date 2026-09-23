package http

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"omniverse_backend/internal/domain"
)

type JobHandler struct {
	jobService               domain.JobUsecase
	gotenbergLB              domain.EndpointSelector
	downloadDir              string
	httpClient               *http.Client
	workerWhisperURL         string
	workerWhisperFallbackURL string
	workerRmbgURL            string
	workerRmbgFallbackURL    string
}

func NewJobHandler(
	js domain.JobUsecase,
	lb domain.EndpointSelector,
	downloadDir string,
	httpClient *http.Client,
	workerWhisperURL, workerWhisperFallbackURL, workerRmbgURL, workerRmbgFallbackURL string,
) *JobHandler {
	return &JobHandler{
		jobService:               js,
		gotenbergLB:              lb,
		downloadDir:              downloadDir,
		httpClient:               httpClient,
		workerWhisperURL:         workerWhisperURL,
		workerWhisperFallbackURL: workerWhisperFallbackURL,
		workerRmbgURL:            workerRmbgURL,
		workerRmbgFallbackURL:    workerRmbgFallbackURL,
	}
}

func (h *JobHandler) HandleStatus(w http.ResponseWriter, r *http.Request) {
	jobID := strings.TrimPrefix(r.URL.Path, "/api/status/")
	job, err := h.jobService.GetJob(jobID)
	if err != nil {
		http.Error(w, `{"error":"Không tìm thấy Job ID"}`, http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(job)
}

func (h *JobHandler) HandleCancel(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost && r.Method != http.MethodDelete {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	jobID := strings.TrimPrefix(r.URL.Path, "/api/cancel/")
	if jobID == "" {
		http.Error(w, `{"error":"Job ID không hợp lệ"}`, http.StatusBadRequest)
		return
	}

	job, err := h.jobService.CancelJob(jobID)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   err.Error(),
		})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Đã huỷ tác vụ thành công",
		"job":     job,
	})
}

func (h *JobHandler) HandleStream(w http.ResponseWriter, r *http.Request) {
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

	jobCh, cleanup := h.jobService.SubscribeJob(r.Context(), jobID)
	defer cleanup()

	var lastSentStatus string
	var lastSentPercent float64 = -1

	if initialJob, err := h.jobService.GetJob(jobID); err == nil {
		lastSentStatus = initialJob.Status
		lastSentPercent = initialJob.Percent
		data, _ := json.Marshal(initialJob)
		// nosemgrep: go.lang.security.audit.xss.no-fprintf-to-responsewriter.no-fprintf-to-responsewriter
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
			lastSentStatus = job.Status
			lastSentPercent = job.Percent
			data, _ := json.Marshal(job)
			// nosemgrep: go.lang.security.audit.xss.no-fprintf-to-responsewriter.no-fprintf-to-responsewriter
			_, _ = fmt.Fprintf(w, "event: progress\ndata: %s\n\n", string(data))
			flusher.Flush()
			if job.Status == "completed" || job.Status == "error" {
				return
			}
		case <-ticker.C:
			if currentJob, err := h.jobService.GetJob(jobID); err == nil {
				if currentJob.Status != lastSentStatus || currentJob.Percent != lastSentPercent {
					lastSentStatus = currentJob.Status
					lastSentPercent = currentJob.Percent
					data, _ := json.Marshal(currentJob)
					// nosemgrep: go.lang.security.audit.xss.no-fprintf-to-responsewriter.no-fprintf-to-responsewriter
					_, _ = fmt.Fprintf(w, "event: progress\ndata: %s\n\n", string(data))
					flusher.Flush()
					if currentJob.Status == "completed" || currentJob.Status == "error" {
						return
					}
					continue
				}
			}
			_, _ = fmt.Fprintf(w, ": ping\n\n")
			flusher.Flush()
		}
	}
}

func (h *JobHandler) HandleFile(w http.ResponseWriter, r *http.Request) {
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

	// nosemgrep: go.lang.security.filepath-clean-misuse.filepath-clean-misuse
	filename := filepath.Base(filepath.Clean(unescapedFilename))
	if filename == "." || filename == "/" || filename == "" || strings.ContainsAny(filename, "\x00\r\n") {
		http.Error(w, "Tên file không hợp lệ.", http.StatusBadRequest)
		return
	}
	filePath := filepath.Join(h.downloadDir, filename)

	relPath, relErr := filepath.Rel(h.downloadDir, filePath)
	if relErr != nil || strings.HasPrefix(relPath, "..") {
		http.Error(w, "Yêu cầu không hợp lệ.", http.StatusBadRequest)
		return
	}

	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		if h.proxyFileFromWorkers(w, r, filename) {
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

	cleanDisplayName := strings.Map(func(r rune) rune {
		if r < 32 || r == 127 || r == '"' || r == '\\' {
			return '_'
		}
		return r
	}, displayName)
	encodedName := url.PathEscape(displayName)
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"; filename*=UTF-8''%s", cleanDisplayName, encodedName))

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

func (h *JobHandler) proxyFileFromWorkers(w http.ResponseWriter, r *http.Request, filename string) bool {
	var workers []string
	lowerName := strings.ToLower(filename)
	if strings.HasPrefix(lowerName, "transcript_") || strings.HasPrefix(lowerName, "whisper_") || strings.HasSuffix(lowerName, ".vtt") || strings.HasSuffix(lowerName, ".srt") {
		workers = []string{h.workerWhisperURL, h.workerWhisperFallbackURL, h.workerRmbgURL, h.workerRmbgFallbackURL}
	} else if strings.HasPrefix(lowerName, "rmbg_") || strings.Contains(lowerName, "nobg") {
		workers = []string{h.workerRmbgURL, h.workerRmbgFallbackURL, h.workerWhisperURL, h.workerWhisperFallbackURL}
	} else {
		workers = []string{h.workerRmbgURL, h.workerRmbgFallbackURL, h.workerWhisperURL, h.workerWhisperFallbackURL}
	}

	for _, workerURL := range workers {
		if workerURL == "" {
			continue
		}
		targetURL := fmt.Sprintf("%s/api/file/%s", strings.TrimRight(workerURL, "/"), url.PathEscape(filename))
		req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, targetURL, nil)
		if err != nil {
			continue
		}
		resp, err := h.httpClient.Do(req)
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

			localPath := filepath.Join(h.downloadDir, filepath.Clean(filename))
			tmpLocalPath := localPath + ".tmp"
			localFile, err := os.OpenFile(tmpLocalPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
			if err == nil {
				multiWriter := io.MultiWriter(w, localFile)
				_, _ = io.Copy(multiWriter, resp.Body)
				_ = localFile.Close()
				_ = os.Rename(tmpLocalPath, localPath)
			} else {
				_, _ = io.Copy(w, resp.Body)
			}
			return true
		}
		resp.Body.Close()
	}
	return false
}

func (h *JobHandler) HandleHealth(w http.ResponseWriter, r *http.Request) {
	gotenbergHealthy := false
	healthURL, finish := h.gotenbergLB.SelectEndpoint("/health")
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
		"lb_algorithm":     "P2C-Peak-EWMA-Dynamic",
	})
}
