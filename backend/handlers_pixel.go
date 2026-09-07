package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

func (s *Server) forwardPixelRequest(targetURL string, r *http.Request, w http.ResponseWriter) {
	// Giới hạn upload tối đa 50MB mà không cần buffer toàn bộ vào memory
	r.Body = http.MaxBytesReader(w, r.Body, 50<<20)

	// Chuẩn bị URL kèm query parameters
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

	// Chuyển tiếp nguyên vẹn Content-Type (bao gồm multipart boundary)
	if ct := r.Header.Get("Content-Type"); ct != "" {
		req.Header.Set("Content-Type", ct)
	}

	// Tái sử dụng s.httpClient với Connection Pooling (Keep-Alive)
	resp, err := s.httpClient.Do(req)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   fmt.Sprintf("Không thể kết nối tới worker-pixelfixer (%s): %v", s.workerPixelfixerURL, err),
		})
		return
	}
	defer resp.Body.Close()

	// Sao chép headers trả về
	for k, vs := range resp.Header {
		for _, v := range vs {
			w.Header().Add(k, v)
		}
	}
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}

func (s *Server) handlePixelDetect(w http.ResponseWriter, r *http.Request) {
if r.Method != http.MethodPost {
http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
return
}
target := s.workerPixelfixerURL + "/api/pixel/detect"
s.forwardPixelRequest(target, r, w)
}

func (s *Server) handlePixelFix(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	target := s.workerPixelfixerURL + "/api/pixel/fix"
	s.forwardPixelRequest(target, r, w)
}

func (s *Server) handlePixelHealth(w http.ResponseWriter, r *http.Request) {
	resp, err := http.Get(s.workerPixelfixerURL + "/health")
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

