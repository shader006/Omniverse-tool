package http

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"omniverse_backend/internal/domain"
)

type MediaHandler struct {
	mediaService domain.MediaUsecase
}

func NewMediaHandler(ms domain.MediaUsecase) *MediaHandler {
	return &MediaHandler{mediaService: ms}
}

func (h *MediaHandler) HandleInfo(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req domain.InfoRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.URL) == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"detail":  "Dữ liệu yêu cầu không hợp lệ hoặc thiếu URL.",
		})
		return
	}

	req.URL = strings.TrimSpace(req.URL)
	if !strings.HasPrefix(req.URL, "http://") && !strings.HasPrefix(req.URL, "https://") {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"detail":  "URL không hợp lệ. Đường dẫn phải bắt đầu bằng http:// hoặc https://",
		})
		return
	}

	data, cached, err := h.mediaService.GetMediaInfo(r.Context(), req.URL)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"detail":  err.Error(),
		})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"data":    data,
		"cached":  cached,
	})
}

func (h *MediaHandler) HandleDownload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req domain.DownloadRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.URL) == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"detail":  "Dữ liệu yêu cầu không hợp lệ hoặc thiếu URL.",
		})
		return
	}

	req.URL = strings.TrimSpace(req.URL)
	if !strings.HasPrefix(req.URL, "http://") && !strings.HasPrefix(req.URL, "https://") {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"detail":  "URL không hợp lệ. Đường dẫn phải bắt đầu bằng http:// hoặc https://",
		})
		return
	}

	allowedFormats := map[string]bool{
		"mp3": true, "mp4": true, "m4a": true, "wav": true, "flac": true, "webm": true,
	}
	req.Format = strings.ToLower(strings.TrimSpace(req.Format))
	if req.Format == "" {
		req.Format = "mp3"
	}
	if !allowedFormats[req.Format] {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"detail":  fmt.Sprintf("Định dạng '%s' không được hỗ trợ. Các định dạng hợp lệ: mp3, mp4, m4a, wav, flac, webm.", req.Format),
		})
		return
	}

	allowedQualities := map[string]bool{
		"64": true, "128": true, "192": true, "256": true, "320": true,
		"360": true, "480": true, "720": true, "1080": true, "1440": true, "2160": true, "best": true,
	}
	req.Quality = strings.ToLower(strings.TrimSpace(req.Quality))
	if req.Quality == "" {
		if req.Format == "mp4" {
			req.Quality = "720"
		} else {
			req.Quality = "320"
		}
	}
	if !allowedQualities[req.Quality] {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"detail":  fmt.Sprintf("Chất lượng '%s' không hợp lệ. Các chất lượng hợp lệ: 64, 128, 192, 256, 320, 360, 480, 720, 1080, 1440, 2160, best.", req.Quality),
		})
		return
	}

	jobID, cached, err := h.mediaService.CreateDownloadJob(r.Context(), req.URL, req.Format, req.Quality)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"detail":  err.Error(),
		})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"job_id":  jobID,
		"cached":  cached,
	})
}
