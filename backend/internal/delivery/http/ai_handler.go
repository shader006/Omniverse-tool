package http

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"

	"omniverse_backend/internal/domain"
	"omniverse_backend/internal/infrastructure/telemetry"
)

type AIHandler struct {
	aiService  domain.AIUsecase
	httpClient *http.Client
}

func NewAIHandler(as domain.AIUsecase, httpClient *http.Client) *AIHandler {
	return &AIHandler{
		aiService:  as,
		httpClient: httpClient,
	}
}

// ── 1. TRANSCRIBE (WHISPER) ──

func (h *AIHandler) HandleTranscribe(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if err := r.ParseMultipartForm(250 << 20); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"detail":  "Kích thước file tải lên vượt quá giới hạn cho phép (250MB).",
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

	originalFilename := filepath.Base(filepath.Clean(header.Filename))
	if originalFilename == "" || originalFilename == "." || originalFilename == "/" {
		originalFilename = "media"
	}
	ext := strings.ToLower(filepath.Ext(originalFilename))
	allowedExts := map[string]bool{
		".mp3": true, ".mp4": true, ".wav": true, ".m4a": true,
		".webm": true, ".flac": true, ".ogg": true, ".aac": true,
		".mov": true, ".avi": true, ".mkv": true,
	}

	if !allowedExts[ext] {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"detail":  fmt.Sprintf("Định dạng file '%s' không được hỗ trợ để nhận diện giọng nói. Vui lòng tải file audio/video.", ext),
		})
		return
	}

	language := strings.ToLower(strings.TrimSpace(r.FormValue("language")))
	if language == "" {
		language = "auto"
	}
	format := strings.ToLower(strings.TrimSpace(r.FormValue("format")))
	if format == "" {
		format = "txt"
	}
	task := strings.ToLower(strings.TrimSpace(r.FormValue("task")))
	if task == "" {
		task = "transcribe"
	}

	allowedFormats := map[string]bool{"txt": true, "srt": true, "vtt": true, "json": true}
	if !allowedFormats[format] {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"detail":  fmt.Sprintf("Định dạng xuất '%s' không hợp lệ. Các định dạng hợp lệ: txt, srt, vtt, json.", format),
		})
		return
	}

	allowedTasks := map[string]bool{"transcribe": true, "translate": true}
	if !allowedTasks[task] {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"detail":  fmt.Sprintf("Tác vụ '%s' không hợp lệ. Các tác vụ hợp lệ: transcribe, translate.", task),
		})
		return
	}

	fileBytes, err := io.ReadAll(file)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"detail":  "Không thể đọc nội dung file: " + err.Error(),
		})
		return
	}

	respBody, statusCode, err := h.aiService.TranscribeAudio(r.Context(), fileBytes, originalFilename, language, format, task)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(statusCode)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"detail":  err.Error(),
		})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(statusCode)
	// nosemgrep: go.lang.security.audit.xss.no-direct-write-to-responsewriter.no-direct-write-to-responsewriter
	_, _ = w.Write(respBody)
}

// ── 2. REMOVE BACKGROUND (BIREFNET) ──

func (h *AIHandler) HandleRemoveBackground(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if err := r.ParseMultipartForm(50 << 20); err != nil {
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

	originalFilename := filepath.Base(filepath.Clean(header.Filename))
	if originalFilename == "" || originalFilename == "." || originalFilename == "/" {
		originalFilename = "image.png"
	}
	ext := strings.ToLower(filepath.Ext(originalFilename))
	allowedExts := map[string]bool{".png": true, ".jpg": true, ".jpeg": true, ".webp": true}
	if !allowedExts[ext] {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"detail":  fmt.Sprintf("Định dạng file '%s' không được hỗ trợ để tách nền. Vui lòng tải file ảnh (PNG, JPG, WEBP).", ext),
		})
		return
	}

	fileBytes, err := io.ReadAll(file)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"detail":  "Không thể đọc nội dung file: " + err.Error(),
		})
		return
	}

	model := r.FormValue("model")
	if model == "" {
		model = "General-Use"
	}
	threshold := r.FormValue("threshold")
	if threshold == "" {
		threshold = "0.5"
	}
	returnMask := r.FormValue("return_mask")
	if returnMask == "" {
		returnMask = "false"
	}

	respBody, statusCode, err := h.aiService.RemoveBackground(r.Context(), fileBytes, originalFilename, model, threshold, returnMask)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(statusCode)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"detail":  err.Error(),
		})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(statusCode)
	// nosemgrep: go.lang.security.audit.xss.no-direct-write-to-responsewriter.no-direct-write-to-responsewriter
	_, _ = w.Write(respBody)
}

// ── 3. PIXELFIXER & UPSCALER ──

func (h *AIHandler) forwardWorkerStream(targetURL string, r *http.Request, w http.ResponseWriter) {
	r.Body = http.MaxBytesReader(w, r.Body, 50<<20)

	finalURL := targetURL
	if r.URL.RawQuery != "" {
		if strings.Contains(finalURL, "?") {
			finalURL += "&" + r.URL.RawQuery
		} else {
			finalURL += "?" + r.URL.RawQuery
		}
	}

	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, finalURL, r.Body)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Không thể tạo request sang worker: " + err.Error(),
		})
		return
	}

	if ct := r.Header.Get("Content-Type"); ct != "" {
		req.Header.Set("Content-Type", ct)
	}
	if r.ContentLength > 0 {
		req.ContentLength = r.ContentLength
	}
	telemetry.InjectTraceparent(r.Context(), req)

	resp, err := h.httpClient.Do(req)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Không thể kết nối tới worker (%s): %v", targetURL, err),
		})
		return
	}
	defer resp.Body.Close()

	for k, vs := range resp.Header {
		for _, v := range vs {
			w.Header().Add(k, v)
		}
	}
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}

func (h *AIHandler) HandlePixelDetect(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	target := h.aiService.GetPixelfixerURL() + "/api/pixel/detect"
	h.forwardWorkerStream(target, r, w)
}

func (h *AIHandler) HandlePixelFix(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	target := h.aiService.GetPixelfixerURL() + "/api/pixel/fix"
	h.forwardWorkerStream(target, r, w)
}

func (h *AIHandler) HandlePixelHealth(w http.ResponseWriter, r *http.Request) {
	target := h.aiService.GetPixelfixerURL() + "/health"
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, target, nil)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"status":  "down",
			"service": "worker-pixelfixer",
			"error":   err.Error(),
		})
		return
	}
	resp, err := h.httpClient.Do(req)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"status":  "down",
			"service": "worker-pixelfixer",
			"error":   err.Error(),
		})
		return
	}
	defer resp.Body.Close()
	for k, vs := range resp.Header {
		for _, v := range vs {
			w.Header().Add(k, v)
		}
	}
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}

func (h *AIHandler) HandleUpscale(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	target := h.aiService.GetUpscalerURL() + "/api/upscale"
	h.forwardWorkerStream(target, r, w)
}

func (h *AIHandler) HandleUpscaleHealth(w http.ResponseWriter, r *http.Request) {
	target := h.aiService.GetUpscalerURL() + "/health"
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, target, nil)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"status":  "down",
			"service": "worker-upscaler",
			"error":   err.Error(),
		})
		return
	}
	resp, err := h.httpClient.Do(req)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"status":  "down",
			"service": "worker-upscaler",
			"error":   err.Error(),
		})
		return
	}
	defer resp.Body.Close()
	for k, vs := range resp.Header {
		for _, v := range vs {
			w.Header().Add(k, v)
		}
	}
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}
