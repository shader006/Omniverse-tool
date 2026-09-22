package main

import (
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"omniverse_backend/internal/delivery/http/middleware"
	"omniverse_backend/internal/infrastructure/cache"
	"omniverse_backend/internal/infrastructure/telemetry"
	"omniverse_backend/internal/infrastructure/worker"
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
	workerWhisperFallbackURL := os.Getenv("WORKER_WHISPER_FALLBACK_URL")
	if workerWhisperFallbackURL == "" {
		workerWhisperFallbackURL = "http://tasks.worker-whisper:8002"
	}

	workerRmbgURL := os.Getenv("WORKER_RMBG_URL")
	workerRmbgFallbackURL := os.Getenv("WORKER_RMBG_FALLBACK_URL")
	if workerRmbgFallbackURL == "" {
		workerRmbgFallbackURL = "http://tasks.worker-rmbg:8003"
	}

	workerPixelfixerURL := os.Getenv("WORKER_PIXELFIXER_URL")
	if workerPixelfixerURL == "" {
		workerPixelfixerURL = "http://worker-pixelfixer:8004"
	}

	workerPdf2docxURL := os.Getenv("WORKER_PDF2DOCX_URL")
	if workerPdf2docxURL == "" {
		workerPdf2docxURL = "http://worker-pdf2docx:8005"
	}

	workerUpscalerURL := os.Getenv("WORKER_UPSCALER_URL")
	if workerUpscalerURL == "" {
		workerUpscalerURL = "http://worker-upscaler:8006"
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

	httpClient := &http.Client{
		Transport: sharedTransport,
		Timeout:   180 * time.Second,
	}
	httpLongClient := &http.Client{
		Transport: sharedTransport,
		Timeout:   900 * time.Second,
	}

	mediaLimiter := make(chan struct{}, maxMediaJobs)

	pogoEngine := cache.NewPogocacheEngine(pogoAddr, downloadDir)
	gotenbergLB := worker.NewGotenbergLoadBalancer(gotenbergURL)
	telemetry.InitTracer()
	middleware.InitFirebase()

	server := NewServer(
		pogoEngine,
		gotenbergLB,
		downloadDir,
		frontendDir,
		mediaLimiter,
		httpClient,
		httpLongClient,
		workerYtdlpURL,
		workerWhisperURL,
		workerWhisperFallbackURL,
		workerRmbgURL,
		workerRmbgFallbackURL,
		workerPixelfixerURL,
		workerPdf2docxURL,
		workerUpscalerURL,
	)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8000"
	}

	log.Printf("🚀 [OMNIVERSE GO SERVER 4-LAYER] Đang lắng nghe tại http://0.0.0.0:%s", port)
	tlsCert := os.Getenv("TLS_CERT_FILE")
	tlsKey := os.Getenv("TLS_KEY_FILE")
	if tlsCert != "" && tlsKey != "" {
		log.Printf("🔒 [OMNIVERSE GO SERVER] Bật TLS với cert: %s", tlsCert)
		if err := http.ListenAndServeTLS(":"+port, tlsCert, tlsKey, server.router); err != nil {
			log.Fatalf("Lỗi khởi động HTTPS Server: %v", err)
		}
	} else {
		// nosemgrep: go.lang.security.audit.net.use-tls.use-tls
		if err := http.ListenAndServe(":"+port, server.router); err != nil {
			log.Fatalf("Lỗi khởi động Server: %v", err)
		}
	}
}
