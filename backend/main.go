package main

import (
	"log"
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

	server := &Server{
		pogo:             NewPogocacheEngine(pogoAddr, downloadDir),
		mediaLimiter:     make(chan struct{}, maxMediaJobs),
		downloadDir:      downloadDir,
		frontendDir:      frontendDir,
		gotenbergLB:      NewGotenbergLoadBalancer(gotenbergURL),
		workerYtdlpURL:   workerYtdlpURL,
		workerWhisperURL: workerWhisperURL,
		workerRmbgURL:    workerRmbgURL,
		httpClient: &http.Client{
			Timeout: 180 * time.Second,
		},
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", server.handleHealth)
	mux.HandleFunc("/api/info", server.handleInfo)
	mux.HandleFunc("/api/download", server.handleDownload)
	mux.HandleFunc("/api/convert/file", server.handleConvertFile)
	mux.HandleFunc("/api/transcribe", server.handleTranscribe)
	mux.HandleFunc("/api/remove-bg", server.handleRemoveBackground)
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

	initTracer()
	log.Printf("🚀 [OMNIVERSE GO SERVER] Đang lắng nghe tại http://0.0.0.0:%s (OTLP Tracing Active)", port)
	if err := http.ListenAndServe(":"+port, tracingMiddleware(corsMiddleware(mux))); err != nil {
		log.Fatalf("Lỗi khởi động Server: %v", err)
	}
}
