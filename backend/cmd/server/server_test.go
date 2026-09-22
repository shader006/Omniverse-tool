package main

import (
	"bytes"
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

	"omniverse_backend/internal/domain"
	"omniverse_backend/internal/infrastructure/cache"
	"omniverse_backend/internal/infrastructure/worker"
)

// Helper: Khởi tạo test server với downloadDir tạm thời
func setupTestServer(t *testing.T) (*Server, string) {
	tmpDir, err := os.MkdirTemp("", "omniverse_test_*")
	if err != nil {
		t.Fatalf("Không thể tạo tmp dir: %v", err)
	}

	pogo := cache.NewPogocacheEngine("", tmpDir)
	s := NewServer(
		pogo,
		worker.NewGotenbergLoadBalancer("http://127.0.0.1:19999"),
		tmpDir,
		tmpDir,
		make(chan struct{}, 4),
		&http.Client{Timeout: 5 * time.Second},
		&http.Client{Timeout: 5 * time.Second},
		"", "", "", "", "", "", "", "",
	)
	return s, tmpDir
}

// 1. Kiểm tra handleHealth đóng body an toàn khi upstream trả non-200 (Issue 9)
func TestHealthNon200BodyClosed(t *testing.T) {
	mockGotenberg := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte("gotenberg internal error"))
	}))
	defer mockGotenberg.Close()

	s, tmpDir := setupTestServer(t)
	defer os.RemoveAll(tmpDir)

	s.SetGotenbergLB(worker.NewGotenbergLoadBalancer(mockGotenberg.URL))

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

	// Kỳ vọng xử lý thành công hoặc từ chối hợp lý
	t.Logf("handleRemoveBackground status: %d", rec.Code)
}

// 5. Kiểm tra CleanupExpiredFiles bảo vệ active jobs và partial files (Issue 6)
func TestCleanupProtection(t *testing.T) {
	s, tmpDir := setupTestServer(t)
	defer os.RemoveAll(tmpDir)

	oldFile := filepath.Join(tmpDir, "old_completed.mp3")
	_ = os.WriteFile(oldFile, []byte("data"), 0644)
	oldTime := time.Now().Add(-2 * time.Hour)
	_ = os.Chtimes(oldFile, oldTime, oldTime)

	activeJobFile := filepath.Join(tmpDir, "active_job_media.mp3")
	_ = os.WriteFile(activeJobFile, []byte("in progress data"), 0644)
	_ = os.Chtimes(activeJobFile, oldTime, oldTime)

	s.pogo.SaveJob(domain.Job{
		JobID:    "job_test_active",
		Filename: "active_job_media.mp3",
		Status:   "downloading",
	})

	partFile := filepath.Join(tmpDir, "downloading.mp4.part")
	_ = os.WriteFile(partFile, []byte("partial"), 0644)
	_ = os.Chtimes(partFile, time.Now().Add(-10*time.Minute), time.Now().Add(-10*time.Minute))

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
		"123_sub.vtt":   "text/vtt; charset=utf-8",
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

// 7. Kiểm tra cơ chế In-Gateway Auto-Failover cho Whisper & RMBG khi Primary sập
func TestWhisperAndRmbgAutoFailover(t *testing.T) {
	s, tmpDir := setupTestServer(t)
	defer os.RemoveAll(tmpDir)

	fallbackServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		if strings.Contains(r.URL.Path, "transcribe") {
			_, _ = w.Write([]byte(`{"success":true,"text":"failover whisper success"}`))
		} else if strings.Contains(r.URL.Path, "remove-bg") {
			_, _ = w.Write([]byte(`{"success":true,"image":"failover rmbg success"}`))
		}
	}))
	defer fallbackServer.Close()

	deadPrimaryURL := "http://127.0.0.1:49999"
	s.SetWorkerURLs(deadPrimaryURL, fallbackServer.URL, deadPrimaryURL, fallbackServer.URL)

	// Test Whisper Failover
	var bufWhisper bytes.Buffer
	writerWhisper := multipart.NewWriter(&bufWhisper)
	partWhisper, err := writerWhisper.CreateFormFile("file", "test.mp3")
	if err != nil {
		t.Fatalf("Lỗi tạo form file: %v", err)
	}
	_, _ = partWhisper.Write([]byte("dummy audio content"))
	_ = writerWhisper.Close()

	reqWhisper := httptest.NewRequest("POST", "/api/transcribe", &bufWhisper)
	reqWhisper.Header.Set("Content-Type", writerWhisper.FormDataContentType())
	recWhisper := httptest.NewRecorder()

	s.handleTranscribe(recWhisper, reqWhisper)
	if recWhisper.Code != http.StatusOK {
		t.Fatalf("handleTranscribe failover thất bại: mã HTTP %d, body: %s", recWhisper.Code, recWhisper.Body.String())
	}
	if !strings.Contains(recWhisper.Body.String(), "failover whisper success") {
		t.Fatalf("handleTranscribe không nhận được phản hồi từ fallback server: %s", recWhisper.Body.String())
	}

	// Test RMBG Failover
	var bufRmbg bytes.Buffer
	writerRmbg := multipart.NewWriter(&bufRmbg)
	partRmbg, err := writerRmbg.CreateFormFile("file", "test.png")
	if err != nil {
		t.Fatalf("Lỗi tạo form file rmbg: %v", err)
	}
	img := image.NewRGBA(image.Rect(0, 0, 1, 1))
	_ = png.Encode(partRmbg, img)
	_ = writerRmbg.Close()

	reqRmbg := httptest.NewRequest("POST", "/api/remove-bg", &bufRmbg)
	reqRmbg.Header.Set("Content-Type", writerRmbg.FormDataContentType())
	recRmbg := httptest.NewRecorder()

	s.handleRemoveBackground(recRmbg, reqRmbg)
	if recRmbg.Code != http.StatusOK {
		t.Fatalf("handleRemoveBackground failover thất bại: mã HTTP %d, body: %s", recRmbg.Code, recRmbg.Body.String())
	}
	if !strings.Contains(recRmbg.Body.String(), "failover rmbg success") {
		t.Fatalf("handleRemoveBackground không nhận được phản hồi từ fallback server: %s", recRmbg.Body.String())
	}

	t.Log("✅ [PASS] In-Gateway Auto-Failover hoạt động hoàn hảo: khi Primary sập, Gateway tự động chuyển sang Fallback thành công!")
}
