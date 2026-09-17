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
	// Tự động phát hiện thư mục dist (sản phẩm đóng gói của Vite/React)
	if stat, err := os.Stat(filepath.Join(frontendDir, "dist", "index.html")); err == nil && !stat.IsDir() {
		frontendDir = filepath.Join(frontendDir, "dist")
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

	// Caching headers helper cho static files & SPA index
	setCachingHeaders := func(w http.ResponseWriter) {
		w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0")
		w.Header().Set("Pragma", "no-cache")
		w.Header().Set("Expires", "0")
	}

	isBlockedStaticFile := func(p string) bool {
		base := strings.ToLower(filepath.Base(filepath.Clean(p)))
		if strings.HasPrefix(base, ".") {
			return true
		}
		blockedExact := map[string]bool{
			"package.json":      true,
			"package-lock.json": true,
			"tsconfig.json":     true,
			"vite.config.js":    true,
			"vite.config.ts":    true,
		}
		if blockedExact[base] {
			return true
		}
		ext := filepath.Ext(base)
		blockedExts := map[string]bool{
			".go": true, ".py": true, ".sh": true, ".ts": true, ".tsx": true,
			".env": true, ".lock": true,
		}
		return blockedExts[ext]
	}

	// Serve static assets under /static/
	mux.HandleFunc("/static/", func(w http.ResponseWriter, r *http.Request) {
		relPath := strings.TrimPrefix(r.URL.Path, "/static/")
		if isBlockedStaticFile(relPath) {
			http.NotFound(w, r)
			return
		}
		filePath := filepath.Join(frontendDir, relPath)
		if _, err := os.Stat(filePath); err == nil {
			setCachingHeaders(w)
			http.ServeFile(w, r, filePath)
			return
		}
		parentDir := filepath.Dir(frontendDir)
		for _, candidate := range []string{
			filepath.Join(frontendDir, "assets", relPath),
			filepath.Join(frontendDir, "client", relPath),
			filepath.Join(frontendDir, "ui", relPath),
			filepath.Join(parentDir, relPath),
			filepath.Join(parentDir, "client", relPath),
			filepath.Join(parentDir, "ui", relPath),
		} {
			if _, err := os.Stat(candidate); err == nil {
				setCachingHeaders(w)
				http.ServeFile(w, r, candidate)
				return
			}
		}
		http.NotFound(w, r)
	})

	// Serve Frontend Web UI (SPA Fallback)
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
		if isBlockedStaticFile(r.URL.Path) {
			http.NotFound(w, r)
			return
		}
		if r.URL.Path == "/" || r.URL.Path == "/index.html" {
			setCachingHeaders(w)
			http.ServeFile(w, r, filepath.Join(frontendDir, "index.html"))
			return
		}
		// Direct asset check
		filePath := filepath.Join(frontendDir, r.URL.Path)
		if stat, err := os.Stat(filePath); err == nil && !stat.IsDir() {
			http.ServeFile(w, r, filePath)
			return
		}
		parentDir := filepath.Dir(frontendDir)
		for _, candidate := range []string{
			filepath.Join(frontendDir, "assets", r.URL.Path),
			filepath.Join(frontendDir, "client", r.URL.Path),
			filepath.Join(frontendDir, "ui", r.URL.Path),
			filepath.Join(parentDir, r.URL.Path),
			filepath.Join(parentDir, "client", r.URL.Path),
			filepath.Join(parentDir, "ui", r.URL.Path),
		} {
			if stat, err := os.Stat(candidate); err == nil && !stat.IsDir() {
				http.ServeFile(w, r, candidate)
				return
			}
		}
		// Fallback cho client-side routing (React SPA)
		setCachingHeaders(w)
		http.ServeFile(w, r, filepath.Join(frontendDir, "index.html"))
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8000"
	}

	initTracer()
	log.Printf("🚀 [OMNIVERSE GO SERVER] Đang lắng nghe tại http://0.0.0.0:%s (OTLP Tracing Active)", port)
	handler := tracingMiddleware(corsMiddleware(rateLimitMiddleware(mux)))
	tlsCert := os.Getenv("TLS_CERT_FILE")
	tlsKey := os.Getenv("TLS_KEY_FILE")
	if tlsCert != "" && tlsKey != "" {
		log.Printf("🔒 [OMNIVERSE GO SERVER] Bật TLS với cert: %s", tlsCert)
		if err := http.ListenAndServeTLS(":"+port, tlsCert, tlsKey, handler); err != nil {
			log.Fatalf("Lỗi khởi động HTTPS Server: %v", err)
		}
	} else {
		// nosemgrep: go.lang.security.audit.net.use-tls.use-tls
		if err := http.ListenAndServe(":"+port, handler); err != nil {
			log.Fatalf("Lỗi khởi động Server: %v", err)
		}
	}
}
