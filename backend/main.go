package main

import (
	"bufio"
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	mathRand "math/rand"
	"mime/multipart"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
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

// -------------------------------------------------------------
// THUẬT TOÁN LOAD BALANCING TẦNG NỘI BỘ: P2C + PEAK-EWMA + DYNAMIC DNS + CIRCUIT BREAKER
// -------------------------------------------------------------
type NodeStats struct {
	activeConns         int64
	ewmaLatencyMs       float64
	consecutiveFailures int
	circuitOpenUntil    time.Time
	mu                  sync.Mutex
}

type GotenbergLoadBalancer struct {
	rawTarget string
	scheme    string
	host      string
	port      string
	statsMap  sync.Map // map[string]*NodeStats
	alpha     float64
}

func NewGotenbergLoadBalancer(rawURL string) *GotenbergLoadBalancer {
	scheme := "http"
	host := "gotenberg"
	port := "3000"

	u, err := url.Parse(rawURL)
	if err == nil && u.Host != "" {
		if u.Scheme != "" {
			scheme = u.Scheme
		}
		h, p, splitErr := net.SplitHostPort(u.Host)
		if splitErr == nil {
			host = h
			port = p
		} else {
			host = u.Host
		}
	} else {
		trimmed := strings.TrimPrefix(strings.TrimPrefix(rawURL, "http://"), "https://")
		parts := strings.Split(trimmed, ":")
		if len(parts) == 2 {
			host = parts[0]
			port = parts[1]
		} else if len(parts) == 1 && parts[0] != "" {
			host = parts[0]
		}
	}

	return &GotenbergLoadBalancer{
		rawTarget: strings.TrimRight(rawURL, "/"),
		scheme:    scheme,
		host:      host,
		port:      port,
		alpha:     0.2,
	}
}

func (lb *GotenbergLoadBalancer) getOrCreateStats(addr string) *NodeStats {
	val, loaded := lb.statsMap.Load(addr)
	if loaded {
		return val.(*NodeStats)
	}
	newStats := &NodeStats{
		activeConns:   0,
		ewmaLatencyMs: 15.0,
	}
	actual, _ := lb.statsMap.LoadOrStore(addr, newStats)
	return actual.(*NodeStats)
}

func (lb *GotenbergLoadBalancer) SelectEndpoint(subPath string) (string, func(err error)) {
	// 1. Dynamic DNS Discovery: Phân giải danh sách IP thực tế của các replicas trong Swarm
	var allAddrs []string
	ips, err := net.LookupIP(lb.host)
	if err == nil && len(ips) > 0 {
		for _, ip := range ips {
			allAddrs = append(allAddrs, net.JoinHostPort(ip.String(), lb.port))
		}
	}

	now := time.Now()
	var eligibleAddrs []string

	// 2. Lọc qua Circuit Breaker & Concurrency Threshold (Max 4 active jobs)
	for _, addr := range allAddrs {
		s := lb.getOrCreateStats(addr)
		s.mu.Lock()
		isCircuitOpen := now.Before(s.circuitOpenUntil)
		conns := atomic.LoadInt64(&s.activeConns)
		s.mu.Unlock()

		if !isCircuitOpen && conns < 4 {
			eligibleAddrs = append(eligibleAddrs, addr)
		}
	}

	// Nếu tất cả node đều bận/khóa, fallback chọn các node không bị circuit breaker
	if len(eligibleAddrs) == 0 {
		for _, addr := range allAddrs {
			s := lb.getOrCreateStats(addr)
			s.mu.Lock()
			isCircuitOpen := now.Before(s.circuitOpenUntil)
			s.mu.Unlock()
			if !isCircuitOpen {
				eligibleAddrs = append(eligibleAddrs, addr)
			}
		}
	}

	// Fallback cuối cùng nếu mọi node đều bị circuit breaker
	if len(eligibleAddrs) == 0 {
		eligibleAddrs = allAddrs
	}

	var selectedAddr string
	if len(eligibleAddrs) >= 2 {
		// 3. Thuật toán P2C: Bốc ngẫu nhiên 2 node ứng viên từ tập eligible
		idx1 := mathRand.Intn(len(eligibleAddrs))
		idx2 := mathRand.Intn(len(eligibleAddrs))
		for idx2 == idx1 {
			idx2 = mathRand.Intn(len(eligibleAddrs))
		}

		a1 := eligibleAddrs[idx1]
		a2 := eligibleAddrs[idx2]

		s1 := lb.getOrCreateStats(a1)
		s2 := lb.getOrCreateStats(a2)

		s1.mu.Lock()
		ewma1 := s1.ewmaLatencyMs
		s1.mu.Unlock()

		s2.mu.Lock()
		ewma2 := s2.ewmaLatencyMs
		s2.mu.Unlock()

		conns1 := float64(atomic.LoadInt64(&s1.activeConns))
		conns2 := float64(atomic.LoadInt64(&s2.activeConns))

		// Peak-EWMA Load Score = (ActiveConns + 1) * EWMA_Latency
		score1 := (conns1 + 1.0) * ewma1
		score2 := (conns2 + 1.0) * ewma2

		if score1 <= score2 {
			selectedAddr = a1
		} else {
			selectedAddr = a2
		}
	} else if len(eligibleAddrs) == 1 {
		selectedAddr = eligibleAddrs[0]
	} else {
		selectedAddr = net.JoinHostPort(lb.host, lb.port)
	}

	stats := lb.getOrCreateStats(selectedAddr)
	atomic.AddInt64(&stats.activeConns, 1)
	startTime := time.Now()

	finishFunc := func(reqErr error) {
		elapsedMs := float64(time.Since(startTime).Microseconds()) / 1000.0
		atomic.AddInt64(&stats.activeConns, -1)

		stats.mu.Lock()
		defer stats.mu.Unlock()
		if reqErr != nil {
			// Penalty cho node phản hồi lỗi/timeout
			stats.ewmaLatencyMs = lb.alpha*(elapsedMs+500.0) + (1.0-lb.alpha)*stats.ewmaLatencyMs
			stats.consecutiveFailures++
			// Nếu lỗi liên tiếp >= 3 lần ➔ Khóa node 15s (Circuit Breaker Tripped)
			if stats.consecutiveFailures >= 3 {
				stats.circuitOpenUntil = time.Now().Add(15 * time.Second)
				log.Printf("⚠️ [CIRCUIT BREAKER] Node Gotenberg '%s' lỗi %d lần ➔ Tạm ngắt trong 15s!", selectedAddr, stats.consecutiveFailures)
			}
		} else {
			stats.ewmaLatencyMs = lb.alpha*elapsedMs + (1.0-lb.alpha)*stats.ewmaLatencyMs
			stats.consecutiveFailures = 0
		}
	}

	fullURL := fmt.Sprintf("%s://%s%s", lb.scheme, selectedAddr, subPath)
	return fullURL, finishFunc
}

type Server struct {
	pogo         *PogocacheEngine
	mediaLimiter chan struct{}
	downloadDir  string
	frontendDir  string
	gotenbergLB  *GotenbergLoadBalancer
}

func randomID() string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func formatBytes(b int64) string {
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%d B", b)
	}
	div, exp := int64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(b)/float64(div), "KMGTPE"[exp])
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

func (s *Server) handleConvertFile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Giới hạn upload tối đa 100MB
	if err := r.ParseMultipartForm(100 << 20); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"detail":  "File upload vượt quá giới hạn hoặc định dạng multipart không hợp lệ.",
		})
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"detail":  "Không tìm thấy file tải lên (tham số 'file').",
		})
		return
	}
	defer file.Close()

	originalFilename := header.Filename
	ext := strings.ToLower(filepath.Ext(originalFilename))
	baseNameWithoutExt := strings.TrimSuffix(originalFilename, filepath.Ext(originalFilename))
	if baseNameWithoutExt == "" {
		baseNameWithoutExt = "document"
	}

	landscape := r.FormValue("landscape") == "true"
	pdfa := r.FormValue("pdfa") // ví dụ: "PDF/A-1b", "PDF/A-2b", "PDF/A-3b"

	// Quyết định endpoint Gotenberg dựa trên đuôi file
	var endpointSubpath string
	switch ext {
	case ".html", ".htm":
		endpointSubpath = "/forms/chromium/convert/html"
	case ".md", ".markdown":
		endpointSubpath = "/forms/libreoffice/convert"
	default:
		// Office formats (.docx, .doc, .xlsx, .xls, .pptx, .ppt, .odt, .ods, .odp, .rtf, .txt, .pdf)
		endpointSubpath = "/forms/libreoffice/convert"
	}

	gotenbergEndpoint, finish := s.gotenbergLB.SelectEndpoint(endpointSubpath)

	// Chuẩn bị multipart body gửi sang Gotenberg
	bodyBuf := &bytes.Buffer{}
	bodyWriter := multipart.NewWriter(bodyBuf)

	// Thêm các option nếu có
	if landscape {
		_ = bodyWriter.WriteField("landscape", "true")
	}
	if pdfa != "" {
		_ = bodyWriter.WriteField("pdfa", pdfa)
	}

	// Thêm file vào form
	targetFileName := originalFilename
	if ext == ".html" || ext == ".htm" {
		targetFileName = "index.html"
	} else if ext == ".md" || ext == ".markdown" {
		targetFileName = baseNameWithoutExt + ".txt"
	}

	part, err := bodyWriter.CreateFormFile("files", targetFileName)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"detail":  "Lỗi xử lý file stream: " + err.Error(),
		})
		return
	}

	if _, err := io.Copy(part, file); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"detail":  "Lỗi sao chép file dữ liệu: " + err.Error(),
		})
		return
	}

	_ = bodyWriter.Close()

	// Gửi request tới Gotenberg
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, gotenbergEndpoint, bodyBuf)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"detail":  "Lỗi khởi tạo kết nối tới Gotenberg: " + err.Error(),
		})
		return
	}
	req.Header.Set("Content-Type", bodyWriter.FormDataContentType())

	client := &http.Client{Timeout: 120 * time.Second}
	resp, err := client.Do(req)
	finish(err)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"detail":  "Không thể kết nối tới Gotenberg service. Vui lòng kiểm tra container Gotenberg.",
		})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBytes, _ := io.ReadAll(resp.Body)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(resp.StatusCode)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"detail":  "Gotenberg chuyển đổi thất bại: " + string(respBytes),
		})
		return
	}

	// Tạo tên file output và lưu vào downloadDir
	outFilename := fmt.Sprintf("%s_%s.pdf", randomID(), baseNameWithoutExt)
	outPath := filepath.Join(s.downloadDir, outFilename)

	outFile, err := os.Create(outPath)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"detail":  "Không thể lưu file PDF sau khi convert: " + err.Error(),
		})
		return
	}
	defer outFile.Close()

	writtenBytes, err := io.Copy(outFile, resp.Body)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"detail":  "Lỗi ghi dữ liệu PDF: " + err.Error(),
		})
		return
	}

	downloadURL := fmt.Sprintf("/api/file/%s", outFilename)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"success":           true,
		"filename":          outFilename,
		"original_filename": originalFilename,
		"output_filename":   baseNameWithoutExt + ".pdf",
		"download_url":      downloadURL,
		"size":              writtenBytes,
		"size_str":          formatBytes(writtenBytes),
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

	gotenbergURL := os.Getenv("GOTENBERG_URL")
	if gotenbergURL == "" {
		gotenbergURL = "http://gotenberg:3000"
	}

	pogoAddr := os.Getenv("POGOCACHE_ADDR")
	if pogoAddr == "" {
		pogoAddr = os.Getenv("REDIS_ADDR")
	}
	if pogoAddr == "" {
		pogoAddr = "pogocache:9401"
	}

	maxMediaJobs := 2
	if envVal := os.Getenv("MAX_MEDIA_CONCURRENT_JOBS"); envVal != "" {
		if val, err := strconv.Atoi(envVal); err == nil && val > 0 {
			maxMediaJobs = val
		}
	}

	server := &Server{
		pogo:         NewPogocacheEngine(pogoAddr, downloadDir),
		mediaLimiter: make(chan struct{}, maxMediaJobs),
		downloadDir:  downloadDir,
		frontendDir:  frontendDir,
		gotenbergLB:  NewGotenbergLoadBalancer(gotenbergURL),
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", server.handleHealth)
	mux.HandleFunc("/api/info", server.handleInfo)
	mux.HandleFunc("/api/download", server.handleDownload)
	mux.HandleFunc("/api/convert/file", server.handleConvertFile)
	mux.HandleFunc("/api/status/", server.handleStatus)
	mux.HandleFunc("/api/stream/", server.handleStream)
	mux.HandleFunc("/api/file/", server.handleFile)

	// Serve static assets under /static/
	mux.HandleFunc("/static/", func(w http.ResponseWriter, r *http.Request) {
		relPath := strings.TrimPrefix(r.URL.Path, "/static/")
		filePath := filepath.Join(frontendDir, relPath)
		if _, err := os.Stat(filePath); err == nil {
			http.ServeFile(w, r, filePath)
			return
		}
		http.NotFound(w, r)
	})

	// Serve Frontend Web UI
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" || r.URL.Path == "/index.html" {
			http.ServeFile(w, r, filepath.Join(frontendDir, "index.html"))
			return
		}
		// Direct asset check
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
