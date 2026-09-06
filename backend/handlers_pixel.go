package main

import (
"bytes"
"encoding/json"
"fmt"
"io"
"mime/multipart"
"net/http"
"strings"
"time"
)

func (s *Server) forwardPixelRequest(targetURL string, r *http.Request, w http.ResponseWriter) {
// Giới hạn upload tối đa 50MB
if err := r.ParseMultipartForm(50 << 20); err != nil {
w.Header().Set("Content-Type", "application/json")
w.WriteHeader(http.StatusBadRequest)
_ = json.NewEncoder(w).Encode(map[string]interface{}{
"success": false,
"error":   "File upload vượt quá 50MB hoặc multipart không hợp lệ.",
})
return
}

file, header, err := r.FormFile("file")
if err != nil {
w.Header().Set("Content-Type", "application/json")
w.WriteHeader(http.StatusBadRequest)
_ = json.NewEncoder(w).Encode(map[string]interface{}{
"success": false,
"error":   "Không tìm thấy file ảnh tải lên (field 'file').",
})
return
}
defer file.Close()

// Tạo body multipart gửi sang worker
bodyBuf := &bytes.Buffer{}
writer := multipart.NewWriter(bodyBuf)
part, err := writer.CreateFormFile("file", header.Filename)
if err != nil {
http.Error(w, err.Error(), http.StatusInternalServerError)
return
}
if _, err := io.Copy(part, file); err != nil {
http.Error(w, err.Error(), http.StatusInternalServerError)
return
}

// Copy tất cả form values khác (mode, cols, rows, step_x, step_y, auto_palette...)
for k, vs := range r.MultipartForm.Value {
for _, v := range vs {
_ = writer.WriteField(k, v)
}
}
_ = writer.Close()

// Chuẩn bị URL kèm query parameters
finalURL := targetURL
if r.URL.RawQuery != "" {
if strings.Contains(finalURL, "?") {
finalURL += "&" + r.URL.RawQuery
} else {
finalURL += "?" + r.URL.RawQuery
}
}

req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, finalURL, bodyBuf)
if err != nil {
w.Header().Set("Content-Type", "application/json")
w.WriteHeader(http.StatusInternalServerError)
_ = json.NewEncoder(w).Encode(map[string]interface{}{
"success": false,
"error":   "Không thể tạo request sang worker: " + err.Error(),
})
return
}
req.Header.Set("Content-Type", writer.FormDataContentType())

client := &http.Client{Timeout: 60 * time.Second}
resp, err := client.Do(req)
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
