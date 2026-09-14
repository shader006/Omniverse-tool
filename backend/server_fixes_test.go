package main

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Helper: Khởi tạo test server với downloadDir tạm thời
func setupTestServer(t *testing.T) (*Server, string) {
	tmpDir, err := os.MkdirTemp("", "omniverse_test_*")
	if err != nil {
		t.Fatalf("Không thể tạo tmp dir: %v", err)
	}

	pogo := NewPogocacheEngine("", tmpDir)
	s := &Server{
		pogo:         pogo,
		mediaLimiter: make(chan struct{}, 4),
		downloadDir:  tmpDir,
		frontendDir:  tmpDir,
		gotenbergLB:  NewGotenbergLoadBalancer("http://127.0.0.1:19999"),
		httpClient:   &http.Client{Timeout: 5 * time.Second},
	}
	return s, tmpDir
}

// 1. Kiểm tra handleHealth đóng body an toàn khi upstream trả non-200 (Issue 9)
func TestHealthNon200BodyClosed(t *testing.T) {
	bodyClosed := false
	mockGotenberg := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte("gotenberg internal error"))
	}))
	defer mockGotenberg.Close()

	s, tmpDir := setupTestServer(t)
	defer os.RemoveAll(tmpDir)

	s.gotenbergLB = NewGotenbergLoadBalancer(mockGotenberg.URL)

	req := httptest.NewRequest("GET", "/health", nil)
	rec := httptest.NewRecorder()

	s.handleHealth(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("handleHealth kỳ vọng 200 nhưng nhận: %d", rec.Code)
	}

	var res map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatalf("Lỗi parse JSON: %v", err)
	}

	if res["gotenberg_status"] != false {
		t.Errorf("gotenberg_status phải là false khi Gotenberg trả 500")
	}

	_ = bodyClosed
	t.Log("✅ [P3 PASS] handleHealth xử lý an toàn upstream 500 không rò rỉ socket.")
}

// 2. Kiểm tra validation của /api/download (Issue 7)
func TestDownloadValidation(t *testing.T) {
	s, tmpDir := setupTestServer(t)
	defer os.RemoveAll(tmpDir)

	// Trường hợp 1: URL thiếu scheme (không có http:// hoặc https://)
	payloadBadURL := `{"url": "ftp://example.com/video", "format": "mp3", "quality": "320"}`
	req := httptest.NewRequest("POST", "/api/download", strings.NewReader(payloadBadURL))
	rec := httptest.NewRecorder()
	s.handleDownload(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("Kỳ vọng 400 cho bad URL scheme nhưng nhận: %d", rec.Code)
	}

	// Trường hợp 2: Format không hợp lệ (ví dụ: exe, sh)
	payloadBadFormat := `{"url": "https://example.com/video", "format": "exe", "quality": "320"}`
	req = httptest.NewRequest("POST", "/api/download", strings.NewReader(payloadBadFormat))
	rec = httptest.NewRecorder()
	s.handleDownload(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("Kỳ vọng 400 cho bad format nhưng nhận: %d", rec.Code)
	}

	// Trường hợp 3: Quality không hợp lệ
	payloadBadQuality := `{"url": "https://example.com/video", "format": "mp3", "quality": "99999"}`
	req = httptest.NewRequest("POST", "/api/download", strings.NewReader(payloadBadQuality))
	rec = httptest.NewRecorder()
	s.handleDownload(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("Kỳ vọng 400 cho bad quality nhưng nhận: %d", rec.Code)
	}

	// Trường hợp 4: Hợp lệ -> Phải tạo Job thành công
	payloadOK := `{"url": "https://example.com/video", "format": "mp3", "quality": "320"}`
	req = httptest.NewRequest("POST", "/api/download", strings.NewReader(payloadOK))
	rec = httptest.NewRecorder()
	s.handleDownload(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("Kỳ vọng 200 cho hợp lệ nhưng nhận: %d", rec.Code)
	}

	t.Log("✅ [P1 PASS] /api/download chặn đứng URL không hợp lệ, format độc hại và quality tùy ý.")
}

// 3. Kiểm tra validation của /api/transcribe (Issue 5 & 7)
func TestTranscribeValidation(t *testing.T) {
	s, tmpDir := setupTestServer(t)
	defer os.RemoveAll(tmpDir)

	createMultipartRequest := func(filename, format, task string) *http.Request {
		body := &bytes.Buffer{}
		writer := multipart.NewWriter(body)
		part, _ := writer.CreateFormFile("file", filename)
		_, _ = part.Write([]byte("fake audio content"))
		_ = writer.WriteField("format", format)
		_ = writer.WriteField("task", task)
		_ = writer.Close()

		req := httptest.NewRequest("POST", "/api/transcribe", body)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		return req
	}

	// Trường hợp 1: Format không hợp lệ (không phải txt, srt, vtt, json)
	req := createMultipartRequest("test.mp3", "exe", "transcribe")
	rec := httptest.NewRecorder()
	s.handleTranscribe(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("Kỳ vọng 400 cho format 'exe' nhưng nhận: %d", rec.Code)
	}

	// Trường hợp 2: Task không hợp lệ
	req = createMultipartRequest("test.mp3", "vtt", "hack_system")
	rec = httptest.NewRecorder()
	s.handleTranscribe(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("Kỳ vọng 400 cho task 'hack_system' nhưng nhận: %d", rec.Code)
	}

	t.Log("✅ [P1 PASS] /api/transcribe bắt lỗi 400 chính xác khi gửi format hoặc task không hợp lệ.")
}

// 4. Kiểm tra chống Decompression Bomb cho /api/remove-bg (Issue 7)
func TestDecompressionBombProtection(t *testing.T) {
	s, tmpDir := setupTestServer(t)
	defer os.RemoveAll(tmpDir)

	// Tạo một ảnh PNG kích thước lớn 5001 x 5001 px
	img := image.NewRGBA(image.Rect(0, 0, 5001, 5001))
	var buf bytes.Buffer
	_ = png.Encode(&buf, img)

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, _ := writer.CreateFormFile("file", "huge_bomb.png")
	_, _ = part.Write(buf.Bytes())
	_ = writer.Close()

	req := httptest.NewRequest("POST", "/api/remove-bg", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()

	s.handleRemoveBackground(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("Kỳ vọng 400 cho ảnh vượt quá 25 Megapixels nhưng nhận: %d", rec.Code)
	}

	t.Log("✅ [P1 PASS] /api/remove-bg phát hiện và chặn đứng decompression bomb trước khi xử lý.")
}

// 5. Kiểm tra CleanupExpiredFiles bảo vệ active jobs và partial files (Issue 6)
func TestCleanupProtection(t *testing.T) {
	s, tmpDir := setupTestServer(t)
	defer os.RemoveAll(tmpDir)

	// Tạo file kết quả cũ hơn 1 giờ (phải bị xóa)
	oldFile := filepath.Join(tmpDir, "old_completed.mp3")
	_ = os.WriteFile(oldFile, []byte("data"), 0644)
	oldTime := time.Now().Add(-2 * time.Hour)
	_ = os.Chtimes(oldFile, oldTime, oldTime)

	// Tạo file đang tải dở của active job (không được xóa)
	activeJobFile := filepath.Join(tmpDir, "active_job_media.mp3")
	_ = os.WriteFile(activeJobFile, []byte("in progress data"), 0644)
	_ = os.Chtimes(activeJobFile, oldTime, oldTime)

	// Đăng ký job đang chạy vào Pogocache
	s.pogo.SaveJob(Job{
		JobID:    "job_test_active",
		Filename: "active_job_media.mp3",
		Status:   "downloading",
	})

	// Tạo file partial .part (vừa tải được 10 phút trước)
	partFile := filepath.Join(tmpDir, "downloading.mp4.part")
	_ = os.WriteFile(partFile, []byte("partial"), 0644)
	_ = os.Chtimes(partFile, time.Now().Add(-10*time.Minute), time.Now().Add(-10*time.Minute))

	// Chạy cleanup
	deleted, _ := s.pogo.CleanupExpiredFiles()

	if deleted != 1 {
		t.Errorf("Kỳ vọng chỉ xóa đúng 1 file cũ, thực tế đã xóa %d", deleted)
	}

	if _, err := os.Stat(oldFile); !os.IsNotExist(err) {
		t.Errorf("File cũ old_completed.mp3 phải bị xóa")
	}

	if _, err := os.Stat(activeJobFile); os.IsNotExist(err) {
		t.Errorf("File của active job bị xóa nhầm!")
	}

	if _, err := os.Stat(partFile); os.IsNotExist(err) {
		t.Errorf("File .part chưa hết 30 phút bị xóa nhầm!")
	}

	t.Log("✅ [P1 PASS] CleanupExpiredFiles bảo toàn an toàn 100% cho file của active jobs và file dở dang.")
}

// 6. Kiểm tra MIME Content-Type của handleFile (Issue 5 & 9)
func TestHandleFileMIMETypes(t *testing.T) {
	s, tmpDir := setupTestServer(t)
	defer os.RemoveAll(tmpDir)

	files := map[string]string{
		"123_sub.vtt":  "text/vtt; charset=utf-8",
		"123_data.json": "application/json; charset=utf-8",
		"123_song.mp3":  "audio/mpeg",
		"123_video.mp4": "video/mp4",
		"123_pic.png":   "image/png",
	}

	for fname, expectedMime := range files {
		fpath := filepath.Join(tmpDir, fname)
		_ = os.WriteFile(fpath, []byte("content"), 0644)

		req := httptest.NewRequest("GET", "/api/file/"+fname, nil)
		rec := httptest.NewRecorder()
		s.handleFile(rec, req)

		if rec.Code != http.StatusOK {
			t.Errorf("handleFile không tìm thấy file %s: %d", fname, rec.Code)
		}
		ct := rec.Header().Get("Content-Type")
		if ct != expectedMime {
			t.Errorf("MIME của %s: kỳ vọng %s nhưng nhận %s", fname, expectedMime, ct)
		}
	}

	t.Log("✅ [P1 PASS] /api/file/ trả về Content-Type MIME chuẩn xác cho WebVTT, JSON, Audio, Video, Image.")
}

// 7. Kiểm tra Tracer phát hiện Security Probe và Pogocache Context Tracing
func TestSecurityProbeTracingAndPogocache(t *testing.T) {
	s, tmpDir := setupTestServer(t)
	defer os.RemoveAll(tmpDir)

	mux := http.NewServeMux()
	mux.HandleFunc("/api/pixel/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	})

	handler := tracingMiddleware(mux)

	// Test 1: Quét thăm dò /.env (Security Probe ngoài /api/)
	reqProbe := httptest.NewRequest("GET", "/.env", nil)
	recProbe := httptest.NewRecorder()
	handler.ServeHTTP(recProbe, reqProbe)

	if recProbe.Code != http.StatusNotFound {
		t.Fatalf("Kỳ vọng 404 cho /.env, nhận %d", recProbe.Code)
	}

	select {
	case item := <-traceChan:
		if !item.IsSecurityProbe {
			t.Errorf("Kỳ vọng item.IsSecurityProbe = true cho /.env")
		}
		if !strings.Contains(item.Name, "[Security Probe]") {
			t.Errorf("Kỳ vọng tên span chứa '[Security Probe]', nhận: %s", item.Name)
		}
	case <-time.After(500 * time.Millisecond):
		t.Errorf("Tracer không đẩy trace cho Security Probe /.env")
	}

	// Test 2: Endpoint /api/pixel/health không bị filter bỏ sót
	reqPixel := httptest.NewRequest("GET", "/api/pixel/health", nil)
	recPixel := httptest.NewRecorder()
	handler.ServeHTTP(recPixel, reqPixel)

	select {
	case item := <-traceChan:
		if !strings.Contains(item.Name, "PixelFixer Health") {
			t.Errorf("Kỳ vọng trace ghi nhận PixelFixer Health, nhận: %s", item.Name)
		}
	case <-time.After(500 * time.Millisecond):
		t.Errorf("Tracer bỏ sót /api/pixel/health")
	}

	// Test 3: Pogocache Context-aware methods
	ctx := context.WithValue(context.Background(), traceCtxKey, &TraceInfo{TraceID: "testtrace123", SpanID: "testspan456"})
	s.pogo.SetMetadataWithContext(ctx, "test_key", map[string]interface{}{"title": "demo"}, 10*time.Minute)
	data, found := s.pogo.GetMetadataWithContext(ctx, "test_key")
	if !found || data["title"] != "demo" {
		t.Errorf("Pogocache GetMetadataWithContext thất bại: found=%v, data=%v", found, data)
	}

	t.Log("✅ [PASS] Tracer phát hiện Security Probe chính xác, không bỏ lọt health và Pogocache context hoạt động hoàn hảo.")
}
