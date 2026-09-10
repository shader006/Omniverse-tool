package main

import (
	"encoding/json"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

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

	workerYtdlpURL := os.Getenv("WORKER_YTDLP_URL")
	workerWhisperURL := os.Getenv("WORKER_WHISPER_URL")
	workerRmbgURL := os.Getenv("WORKER_RMBG_URL")
	workerPixelfixerURL := os.Getenv("WORKER_PIXELFIXER_URL")
	if workerPixelfixerURL == "" {
		workerPixelfixerURL = "http://worker-pixelfixer:8004"
	}

	workerPdf2docxURL := os.Getenv("WORKER_PDF2DOCX_URL")
	if workerPdf2docxURL == "" {
		workerPdf2docxURL = "http://worker-pdf2docx:8005"
	}

	sharedTransport := &http.Transport{
		Proxy: http.ProxyFromEnvironment,
		DialContext: (&net.Dialer{
			Timeout:   30 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          200,
		MaxIdleConnsPerHost:   50,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}

	server := &Server{
		pogo:                NewPogocacheEngine(pogoAddr, downloadDir),
		mediaLimiter:        make(chan struct{}, maxMediaJobs),
		downloadDir:         downloadDir,
		frontendDir:         frontendDir,
		gotenbergLB:         NewGotenbergLoadBalancer(gotenbergURL),
		workerYtdlpURL:      workerYtdlpURL,
		workerWhisperURL:    workerWhisperURL,
		workerRmbgURL:       workerRmbgURL,
		workerPixelfixerURL: workerPixelfixerURL,
		workerPdf2docxURL:   workerPdf2docxURL,
		httpClient: &http.Client{
			Transport: sharedTransport,
			Timeout:   180 * time.Second,
		},
		httpLongClient: &http.Client{
			Transport: sharedTransport,
			Timeout:   900 * time.Second,
		},
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", server.handleHealth)
	mux.HandleFunc("/api/health", server.handleHealth)
	mux.HandleFunc("/api/info", server.handleInfo)
	mux.HandleFunc("/api/download", server.handleDownload)
	mux.HandleFunc("/api/convert/file", server.handleConvertFile)
	mux.HandleFunc("/api/transcribe", server.handleTranscribe)
	mux.HandleFunc("/api/remove-bg", server.handleRemoveBackground)
	mux.HandleFunc("/api/pixel/detect", server.handlePixelDetect)
	mux.HandleFunc("/api/pixel/fix", server.handlePixelFix)
	mux.HandleFunc("/api/pixel/health", server.handlePixelHealth)
	mux.HandleFunc("/api/status/", server.handleStatus)
	mux.HandleFunc("/api/stream/", server.handleStream)
	mux.HandleFunc("/api/file/", server.handleFile)

	// Serve static assets under /static/
	mux.HandleFunc("/static/", func(w http.ResponseWriter, r *http.Request) {
		relPath := strings.TrimPrefix(r.URL.Path, "/static/")
		filePath := filepath.Join(frontendDir, relPath)
		setCachingHeaders := func(w http.ResponseWriter) {
			w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0")
			w.Header().Set("Pragma", "no-cache")
			w.Header().Set("Expires", "0")
		}
		if _, err := os.Stat(filePath); err == nil {
			setCachingHeaders(w)
			http.ServeFile(w, r, filePath)
			return
		}
		for _, sub := range []string{"client", "ui"} {
			subPath := filepath.Join(frontendDir, sub, relPath)
			if _, err := os.Stat(subPath); err == nil {
				setCachingHeaders(w)
				http.ServeFile(w, r, subPath)
				return
			}
		}
		http.NotFound(w, r)
	})

	// Serve Frontend Web UI
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"error":   "API endpoint không tồn tại: " + r.URL.Path,
			})
			return
		}
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
		for _, sub := range []string{"client", "ui"} {
			subPath := filepath.Join(frontendDir, sub, r.URL.Path)
			if _, err := os.Stat(subPath); err == nil {
				http.ServeFile(w, r, subPath)
				return
			}
		}
		http.ServeFile(w, r, filepath.Join(frontendDir, "index.html"))
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8000"
	}

	initTracer()
	log.Printf("🚀 [OMNIVERSE GO SERVER] Đang lắng nghe tại http://0.0.0.0:%s (OTLP Tracing Active)", port)
	handler := tracingMiddleware(corsMiddleware(rateLimitMiddleware(mux)))
	if err := http.ListenAndServe(":"+port, handler); err != nil {
		log.Fatalf("Lỗi khởi động Server: %v", err)
	}
}
