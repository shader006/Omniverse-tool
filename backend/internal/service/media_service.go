package service

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os/exec"
	"strings"
	"time"

	"omniverse_backend/internal/domain"
	"omniverse_backend/internal/infrastructure/cache"
)

func randomID() string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

type MediaService struct {
	cache          domain.JobRepository
	workerClient   domain.WorkerClient
	mediaLimiter   chan struct{}
	downloadDir    string
	workerYtdlpURL string
}

func NewMediaService(
	c domain.JobRepository,
	wc domain.WorkerClient,
	limiter chan struct{},
	downloadDir string,
	workerYtdlpURL string,
) *MediaService {
	return &MediaService{
		cache:          c,
		workerClient:   wc,
		mediaLimiter:   limiter,
		downloadDir:    downloadDir,
		workerYtdlpURL: workerYtdlpURL,
	}
}

func (s *MediaService) GetMediaInfo(ctx context.Context, rawURL string) (map[string]interface{}, bool, error) {
	cacheKey := cache.GenerateCacheKey(rawURL, "info", "info")
	if cachedData, found := s.cache.GetMetadata(cacheKey); found {
		return cachedData, true, nil
	}

	if s.workerYtdlpURL != "" {
		req := domain.InfoRequest{URL: rawURL}
		respBytes, statusCode, err := s.workerClient.CallWorkerJSON(ctx, s.workerYtdlpURL, "/api/info", req)
		if err == nil && statusCode == http.StatusOK {
			var result struct {
				Success bool                   `json:"success"`
				Data    map[string]interface{} `json:"data,omitempty"`
				Error   string                 `json:"error,omitempty"`
			}
			if json.Unmarshal(respBytes, &result) == nil && result.Success {
				if result.Data != nil {
					s.cache.SetMetadata(cacheKey, result.Data, cache.DefaultCacheTTL)
				}
				return result.Data, false, nil
			}
		}
		log.Printf("⚠️ [WORKER YT-DLP] Gọi worker /api/info thất bại (%v), fallback sang CLI cục bộ...", err)
	}

	cmd := exec.Command("python3", "-m", "app.url_conver.cli", "info", "--url", rawURL)
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
		errMsg := result.Error
		if errMsg == "" {
			errMsg = "Không thể trích xuất thông tin từ liên kết này. Vui lòng kiểm tra lại URL."
		}
		return nil, false, fmt.Errorf("%s", errMsg)
	}

	if result.Data != nil {
		s.cache.SetMetadata(cacheKey, result.Data, cache.DefaultCacheTTL)
	}

	return result.Data, false, nil
}

func (s *MediaService) CreateDownloadJob(ctx context.Context, rawURL, mediaFormat, quality string) (string, bool, error) {
	jobID := randomID()

	if cachedFile, found := s.cache.FindCachedFile(rawURL, mediaFormat, quality); found {
		job := domain.Job{
			JobID:       jobID,
			URL:         rawURL,
			Format:      mediaFormat,
			Quality:     quality,
			Status:      "completed",
			Percent:     100.0,
			Speed:       "Cached",
			ETA:         "0s",
			Filename:    cachedFile,
			DownloadURL: fmt.Sprintf("/api/file/%s", cachedFile),
			CreatedAt:   float64(time.Now().Unix()),
		}
		s.cache.PublishJobUpdate(job)
		return jobID, true, nil
	}

	job := domain.Job{
		JobID:     jobID,
		URL:       rawURL,
		Format:    mediaFormat,
		Quality:   quality,
		Status:    "queued",
		Percent:   0.0,
		Speed:     "-",
		ETA:       "-",
		CreatedAt: float64(time.Now().Unix()),
	}
	s.cache.PublishJobUpdate(job)

	go s.processDownloadJob(context.Background(), jobID, rawURL, mediaFormat, quality)

	return jobID, false, nil
}

func (s *MediaService) processDownloadJob(ctx context.Context, jobID, url, mediaFormat, quality string) {
	s.mediaLimiter <- struct{}{}
	defer func() { <-s.mediaLimiter }()

	if j, ok := s.cache.GetJob(jobID); ok {
		j.Status = "downloading"
		s.cache.PublishJobUpdate(j)
	}

	if s.workerYtdlpURL != "" {
		payload := map[string]string{
			"job_id":       jobID,
			"url":          url,
			"format":       mediaFormat,
			"quality":      quality,
			"download_dir": s.downloadDir,
		}
		bodyBytes, _ := json.Marshal(payload)
		targetURL := strings.TrimRight(s.workerYtdlpURL, "/") + "/api/download"
		req, reqErr := http.NewRequestWithContext(ctx, "POST", targetURL, bytes.NewReader(bodyBytes))
		if reqErr == nil {
			req.Header.Set("Content-Type", "application/json")
			var receivedFinal bool
			respBytes, statusCode, callErr := s.workerClient.CallWorkerJSON(ctx, s.workerYtdlpURL, "/api/download", payload)
			if callErr == nil && statusCode == http.StatusOK {
				scanner := bufio.NewScanner(bytes.NewReader(respBytes))
				for scanner.Scan() {
					line := strings.TrimSpace(scanner.Text())
					if line == "" {
						continue
					}
					var event struct {
						Status      string  `json:"status"`
						Percent     float64 `json:"percent"`
						Speed       string  `json:"speed"`
						ETA         string  `json:"eta"`
						Filename    string  `json:"filename"`
						DownloadURL string  `json:"download_url"`
						Error       string  `json:"error"`
					}
					if err := json.Unmarshal([]byte(line), &event); err == nil {
						if event.Status == "downloading" {
							j, ok := s.cache.GetJob(jobID)
							if !ok {
								j = domain.Job{JobID: jobID, URL: url, Format: mediaFormat, Quality: quality}
							}
							j.Status = "downloading"
							j.Percent = event.Percent
							if event.Speed != "" {
								j.Speed = event.Speed
							}
							s.cache.PublishJobUpdate(j)
						} else if event.Status == "completed" {
							j, ok := s.cache.GetJob(jobID)
							if !ok {
								j = domain.Job{JobID: jobID, URL: url, Format: mediaFormat, Quality: quality}
							}
							j.Status = "completed"
							j.Percent = 100.0
							j.Filename = event.Filename
							j.DownloadURL = fmt.Sprintf("/api/file/%s", event.Filename)
							s.cache.PublishJobUpdate(j)
							receivedFinal = true
							return
						} else if event.Status == "error" {
							errText := event.Error
							if errText == "" {
								errText = "Lỗi khi xử lý tải file hoặc liên kết không khả dụng."
							}
							s.FailJob(jobID, errText)
							receivedFinal = true
							return
						}
					}
				}
				if receivedFinal {
					return
				}
			}
			log.Printf("⚠️ [WORKER YT-DLP] Kết thúc stream worker /api/download (callErr=%v, receivedFinal=%v)", callErr, receivedFinal)
		}
	}

	if cachedFile, found := s.cache.FindCachedFile(url, mediaFormat, quality); found {
		log.Printf("✅ [WORKER YT-DLP RECOVERY] Tìm thấy file đã tải thành công trong downloadDir: %s", cachedFile)
		j, ok := s.cache.GetJob(jobID)
		if !ok {
			j = domain.Job{JobID: jobID, URL: url, Format: mediaFormat, Quality: quality}
		}
		j.Status = "completed"
		j.Percent = 100.0
		j.Filename = cachedFile
		j.DownloadURL = fmt.Sprintf("/api/file/%s", cachedFile)
		s.cache.PublishJobUpdate(j)
		return
	}

	if _, err := exec.LookPath("python3"); err != nil {
		log.Printf("⚠️ [LOCAL FALLBACK] Không tìm thấy python3 trên hệ thống, không thể fallback.")
		s.FailJob(jobID, "Dịch vụ tải media hiện đang bận hoặc không khả dụng. Vui lòng thử lại sau.")
		return
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
		s.FailJob(jobID, err.Error())
		return
	}

	if err := cmd.Start(); err != nil {
		s.FailJob(jobID, err.Error())
		return
	}

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
				if j, ok := s.cache.GetJob(jobID); ok {
					j.Percent = prog.Percent
					j.Speed = prog.Message
					s.cache.PublishJobUpdate(j)
				}
			}
		}
	}

	_ = cmd.Wait()

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
			if j, ok := s.cache.GetJob(jobID); ok {
				j.Status = "completed"
				j.Percent = 100.0
				j.Filename = res.Filename
				j.DownloadURL = fmt.Sprintf("/api/file/%s", res.Filename)
				s.cache.PublishJobUpdate(j)
				return
			}
		}
	}

	errText := res.Error
	if errText == "" {
		errText = "Lỗi khi xử lý tải file hoặc liên kết không khả dụng."
	}
	s.FailJob(jobID, errText)
}

func (s *MediaService) FailJob(jobID, errMsg string) {
	if j, ok := s.cache.GetJob(jobID); ok {
		j.Status = "error"
		j.Error = errMsg
		s.cache.PublishJobUpdate(j)
	}
}
