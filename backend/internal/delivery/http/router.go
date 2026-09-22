package http

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"omniverse_backend/internal/delivery/http/middleware"
	"omniverse_backend/internal/infrastructure/telemetry"
)

type RouterConfig struct {
	MediaHandler   *MediaHandler
	AIHandler      *AIHandler
	ConvertHandler *ConvertHandler
	JobHandler     *JobHandler
	FrontendDir    string
}

func NewRouter(cfg RouterConfig) http.Handler {
	mux := http.NewServeMux()

	// 1. Health & Discovery
	mux.HandleFunc("/health", cfg.JobHandler.HandleHealth)
	mux.HandleFunc("/api/health", cfg.JobHandler.HandleHealth)

	// 2. Media API
	mux.HandleFunc("/api/info", cfg.MediaHandler.HandleInfo)
	mux.Handle("/api/download", middleware.AuthMiddleware(http.HandlerFunc(cfg.MediaHandler.HandleDownload)))

	// 3. Document Convert API
	mux.Handle("/api/convert/file", middleware.AuthMiddleware(http.HandlerFunc(cfg.ConvertHandler.HandleConvertFile)))

	// 4. AI APIs (Protected)
	mux.Handle("/api/transcribe", middleware.AuthMiddleware(http.HandlerFunc(cfg.AIHandler.HandleTranscribe)))
	mux.Handle("/api/remove-bg", middleware.AuthMiddleware(http.HandlerFunc(cfg.AIHandler.HandleRemoveBackground)))

	// 5. AI Public APIs (PixelFixer & Upscaler)
	mux.HandleFunc("/api/pixel/detect", cfg.AIHandler.HandlePixelDetect)
	mux.HandleFunc("/api/pixel/fix", cfg.AIHandler.HandlePixelFix)
	mux.HandleFunc("/api/pixel/health", cfg.AIHandler.HandlePixelHealth)
	mux.HandleFunc("/api/upscale", cfg.AIHandler.HandleUpscale)
	mux.HandleFunc("/api/upscale/health", cfg.AIHandler.HandleUpscaleHealth)

	// 6. Job Status, Stream & File Serving
	mux.HandleFunc("/api/status/", cfg.JobHandler.HandleStatus)
	mux.HandleFunc("/api/stream/", cfg.JobHandler.HandleStream)
	mux.HandleFunc("/api/file/", cfg.JobHandler.HandleFile)

	// Helper headers cho static files
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

	// 7. Static Assets
	mux.HandleFunc("/static/", func(w http.ResponseWriter, r *http.Request) {
		relPath := strings.TrimPrefix(r.URL.Path, "/static/")
		if isBlockedStaticFile(relPath) {
			http.NotFound(w, r)
			return
		}
		filePath := filepath.Join(cfg.FrontendDir, relPath)
		if _, err := os.Stat(filePath); err == nil {
			setCachingHeaders(w)
			http.ServeFile(w, r, filePath)
			return
		}
		parentDir := filepath.Dir(cfg.FrontendDir)
		for _, candidate := range []string{
			filepath.Join(cfg.FrontendDir, "assets", relPath),
			filepath.Join(cfg.FrontendDir, "client", relPath),
			filepath.Join(cfg.FrontendDir, "ui", relPath),
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

	// 8. Static AI models
	mux.HandleFunc("/models/", func(w http.ResponseWriter, r *http.Request) {
		relPath := strings.TrimPrefix(r.URL.Path, "/models/")
		if isBlockedStaticFile(relPath) {
			http.NotFound(w, r)
			return
		}
		candidates := []string{
			filepath.Join(cfg.FrontendDir, "models", relPath),
			filepath.Join(filepath.Dir(cfg.FrontendDir), "models", relPath),
			filepath.Join("/models", relPath),
			filepath.Join("/app/models", relPath),
			filepath.Join(".", "models", relPath),
		}
		for _, cand := range candidates {
			if stat, err := os.Stat(cand); err == nil && !stat.IsDir() {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
				http.ServeFile(w, r, cand)
				return
			}
		}
		http.NotFound(w, r)
	})

	// 9. SPA Fallback
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
			http.ServeFile(w, r, filepath.Join(cfg.FrontendDir, "index.html"))
			return
		}
		filePath := filepath.Join(cfg.FrontendDir, r.URL.Path)
		if stat, err := os.Stat(filePath); err == nil && !stat.IsDir() {
			http.ServeFile(w, r, filePath)
			return
		}
		parentDir := filepath.Dir(cfg.FrontendDir)
		for _, candidate := range []string{
			filepath.Join(cfg.FrontendDir, "assets", r.URL.Path),
			filepath.Join(cfg.FrontendDir, "client", r.URL.Path),
			filepath.Join(cfg.FrontendDir, "ui", r.URL.Path),
			filepath.Join(parentDir, r.URL.Path),
			filepath.Join(parentDir, "client", r.URL.Path),
			filepath.Join(parentDir, "ui", r.URL.Path),
		} {
			if stat, err := os.Stat(candidate); err == nil && !stat.IsDir() {
				http.ServeFile(w, r, candidate)
				return
			}
		}
		setCachingHeaders(w)
		http.ServeFile(w, r, filepath.Join(cfg.FrontendDir, "index.html"))
	})

	// Gắn các middleware theo thứ tự: Tracing -> CORS -> RateLimit
	return telemetry.TracingMiddleware(middleware.CorsMiddleware(middleware.RateLimitMiddleware(mux)))
}
