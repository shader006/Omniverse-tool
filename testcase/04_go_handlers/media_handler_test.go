package handler_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	delivery "omniverse_backend/internal/delivery/http"
)

// Mock MediaUsecase
type mockMediaUsecase struct {
	getInfoFunc  func(ctx context.Context, rawURL string) (map[string]interface{}, bool, error)
	downloadFunc func(ctx context.Context, rawURL, format, quality string) (string, bool, error)
	failJobFunc  func(jobID, errMsg string)
}

func (m *mockMediaUsecase) GetMediaInfo(ctx context.Context, rawURL string) (map[string]interface{}, bool, error) {
	if m.getInfoFunc != nil {
		return m.getInfoFunc(ctx, rawURL)
	}
	return map[string]interface{}{"title": "Default Video"}, false, nil
}

func (m *mockMediaUsecase) CreateDownloadJob(ctx context.Context, rawURL, format, quality string) (string, bool, error) {
	if m.downloadFunc != nil {
		return m.downloadFunc(ctx, rawURL, format, quality)
	}
	return "job-uuid-12345", false, nil
}

func (m *mockMediaUsecase) FailJob(jobID, errMsg string) {
	if m.failJobFunc != nil {
		m.failJobFunc(jobID, errMsg)
	}
}

// =============================================================================
// TEST CASES: MediaHandler /api/info (B-04 -> B-08)
// =============================================================================

func TestMediaHandler_HandleInfo(t *testing.T) {
	mockUC := &mockMediaUsecase{}
	handler := delivery.NewMediaHandler(mockUC)

	t.Run("TC B-04: Từ chối method khác ngoài POST (GET -> 405)", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/info", nil)
		rec := httptest.NewRecorder()

		handler.HandleInfo(rec, req)

		if rec.Code != http.StatusMethodNotAllowed {
			t.Errorf("Mong đợi HTTP 405, nhận được %d", rec.Code)
		}
	})

	t.Run("TC B-05: Thiếu hoặc rỗng URL (Body rỗng -> 400)", func(t *testing.T) {
		body := []byte(`{"url": ""}`)
		req := httptest.NewRequest(http.MethodPost, "/api/info", bytes.NewReader(body))
		rec := httptest.NewRecorder()

		handler.HandleInfo(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Errorf("Mong đợi HTTP 400, nhận được %d", rec.Code)
		}
	})

	t.Run("TC B-06: URL không có tiền tố http/https (SSRF / Scheme check -> 400)", func(t *testing.T) {
		invalidURLs := []string{"ftp://example.com/file", "file:///etc/passwd", "javascript:alert(1)", "localhost:8080"}

		for _, badURL := range invalidURLs {
			body, _ := json.Marshal(map[string]string{"url": badURL})
			req := httptest.NewRequest(http.MethodPost, "/api/info", bytes.NewReader(body))
			rec := httptest.NewRecorder()

			handler.HandleInfo(rec, req)

			if rec.Code != http.StatusBadRequest {
				t.Errorf("URL '%s' phải bị chặn với 400, nhận được %d", badURL, rec.Code)
			}
		}
	})

	t.Run("TC B-07: GetMediaInfo báo lỗi từ Service -> 400", func(t *testing.T) {
		mockUC.getInfoFunc = func(ctx context.Context, rawURL string) (map[string]interface{}, bool, error) {
			return nil, false, errors.New("Video không khả dụng hoặc bị riêng tư")
		}

		body, _ := json.Marshal(map[string]string{"url": "https://www.youtube.com/watch?v=private"})
		req := httptest.NewRequest(http.MethodPost, "/api/info", bytes.NewReader(body))
		rec := httptest.NewRecorder()

		handler.HandleInfo(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Errorf("Mong đợi HTTP 400 khi service lỗi, nhận được %d", rec.Code)
		}
	})

	t.Run("TC B-08: Thành công trả về thông tin Media -> 200 OK", func(t *testing.T) {
		mockUC.getInfoFunc = func(ctx context.Context, rawURL string) (map[string]interface{}, bool, error) {
			return map[string]interface{}{"title": "Good Video", "duration": 180}, true, nil
		}

		body, _ := json.Marshal(map[string]string{"url": "https://www.youtube.com/watch?v=valid"})
		req := httptest.NewRequest(http.MethodPost, "/api/info", bytes.NewReader(body))
		rec := httptest.NewRecorder()

		handler.HandleInfo(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("Mong đợi HTTP 200, nhận được %d", rec.Code)
		}

		var res struct {
			Success bool                   `json:"success"`
			Data    map[string]interface{} `json:"data"`
			Cached  bool                   `json:"cached"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &res)

		if !res.Success || res.Data["title"] != "Good Video" || !res.Cached {
			t.Errorf("Phản hồi không đúng định dạng mong đợi: %+v", res)
		}
	})
}

// =============================================================================
// TEST CASES: MediaHandler /api/download (B-09 -> B-18)
// =============================================================================

func TestMediaHandler_HandleDownload(t *testing.T) {
	mockUC := &mockMediaUsecase{}
	handler := delivery.NewMediaHandler(mockUC)

	t.Run("TC B-09: Từ chối method khác ngoài POST (GET -> 405)", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/download", nil)
		rec := httptest.NewRecorder()

		handler.HandleDownload(rec, req)

		if rec.Code != http.StatusMethodNotAllowed {
			t.Errorf("Mong đợi HTTP 405, nhận được %d", rec.Code)
		}
	})

	t.Run("TC B-10: Thiếu trường URL trong request body -> 400", func(t *testing.T) {
		body := []byte(`{"format": "mp3"}`)
		req := httptest.NewRequest(http.MethodPost, "/api/download", bytes.NewReader(body))
		rec := httptest.NewRecorder()

		handler.HandleDownload(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Errorf("Mong đợi HTTP 400 khi thiếu URL, nhận được %d", rec.Code)
		}
	})

	t.Run("TC B-11: URL không có tiền tố http/https (SSRF cho download -> 400)", func(t *testing.T) {
		invalidURLs := []string{"ftp://storage.server/file.mp4", "file:///etc/secret", "javascript:void(0)"}

		for _, badURL := range invalidURLs {
			body, _ := json.Marshal(map[string]string{"url": badURL, "format": "mp3"})
			req := httptest.NewRequest(http.MethodPost, "/api/download", bytes.NewReader(body))
			rec := httptest.NewRecorder()

			handler.HandleDownload(rec, req)

			if rec.Code != http.StatusBadRequest {
				t.Errorf("URL download '%s' không hợp lệ phải trả về 400, nhận được %d", badURL, rec.Code)
			}
		}
	})

	t.Run("TC B-12: Định dạng file không được hỗ trợ (exe, iso -> 400)", func(t *testing.T) {
		unsupportedFormats := []string{"exe", "iso", "zip", "bat"}
		for _, format := range unsupportedFormats {
			body, _ := json.Marshal(map[string]string{
				"url":    "https://www.youtube.com/watch?v=123",
				"format": format,
			})
			req := httptest.NewRequest(http.MethodPost, "/api/download", bytes.NewReader(body))
			rec := httptest.NewRecorder()

			handler.HandleDownload(rec, req)

			if rec.Code != http.StatusBadRequest {
				t.Errorf("Định dạng '%s' không hợp lệ phải trả về 400, nhận được %d", format, rec.Code)
			}
		}
	})

	t.Run("TC B-13: Chất lượng video/audio không hợp lệ (9999p -> 400)", func(t *testing.T) {
		body, _ := json.Marshal(map[string]string{
			"url":     "https://www.youtube.com/watch?v=123",
			"format":  "mp4",
			"quality": "9999p",
		})
		req := httptest.NewRequest(http.MethodPost, "/api/download", bytes.NewReader(body))
		rec := httptest.NewRecorder()

		handler.HandleDownload(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Errorf("Chất lượng không hợp lệ phải trả về 400, nhận được %d", rec.Code)
		}
	})

	t.Run("TC B-14: Tạo Job tải xuống thành công -> 200 OK với JobID", func(t *testing.T) {
		mockUC.downloadFunc = func(ctx context.Context, rawURL, format, quality string) (string, bool, error) {
			return "job-created-999", false, nil
		}

		body, _ := json.Marshal(map[string]string{
			"url":     "https://www.youtube.com/watch?v=123",
			"format":  "mp3",
			"quality": "320",
		})
		req := httptest.NewRequest(http.MethodPost, "/api/download", bytes.NewReader(body))
		rec := httptest.NewRecorder()

		handler.HandleDownload(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("Mong đợi HTTP 200, nhận được %d", rec.Code)
		}

		var res struct {
			Success bool   `json:"success"`
			JobID   string `json:"job_id"`
			Cached  bool   `json:"cached"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &res)

		if !res.Success || res.JobID != "job-created-999" {
			t.Errorf("JobID trả về không khớp: %+v", res)
		}
	})

	t.Run("TC B-15: Tải file đã cached (cached=true) trả về jobID ngay -> 200 OK", func(t *testing.T) {
		mockUC.downloadFunc = func(ctx context.Context, rawURL, format, quality string) (string, bool, error) {
			return "cached-job-001", true, nil
		}

		body, _ := json.Marshal(map[string]string{
			"url":     "https://www.youtube.com/watch?v=cached-video",
			"format":  "mp4",
			"quality": "720",
		})
		req := httptest.NewRequest(http.MethodPost, "/api/download", bytes.NewReader(body))
		rec := httptest.NewRecorder()

		handler.HandleDownload(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("File cached phải trả về 200 OK, nhận được %d", rec.Code)
		}

		var res struct {
			Success bool   `json:"success"`
			JobID   string `json:"job_id"`
			Cached  bool   `json:"cached"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &res)

		if !res.Cached {
			t.Errorf("File đã cached phải trả về cached=true trong response")
		}
		if res.JobID != "cached-job-001" {
			t.Errorf("JobID không khớp: nhận %s", res.JobID)
		}
	})

	t.Run("TC B-16: Format mặc định khi không truyền format (mặc định mp3) -> 200 OK", func(t *testing.T) {
		capturedFormat := ""
		mockUC.downloadFunc = func(ctx context.Context, rawURL, format, quality string) (string, bool, error) {
			capturedFormat = format
			return "job-default-fmt", false, nil
		}

		body, _ := json.Marshal(map[string]string{
			"url": "https://www.youtube.com/watch?v=no-format",
		})
		req := httptest.NewRequest(http.MethodPost, "/api/download", bytes.NewReader(body))
		rec := httptest.NewRecorder()

		handler.HandleDownload(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("Không truyền format phải thành công với mặc định, nhận được %d", rec.Code)
		}
		if capturedFormat != "mp3" {
			t.Errorf("Format mặc định phải là 'mp3', nhận được '%s'", capturedFormat)
		}
	})

	t.Run("TC B-17: Service tạo job thất bại -> 500 Internal Server Error", func(t *testing.T) {
		mockUC.downloadFunc = func(ctx context.Context, rawURL, format, quality string) (string, bool, error) {
			return "", false, errors.New("yt-dlp process crashed unexpectedly")
		}

		body, _ := json.Marshal(map[string]string{
			"url":    "https://www.youtube.com/watch?v=error",
			"format": "mp3",
		})
		req := httptest.NewRequest(http.MethodPost, "/api/download", bytes.NewReader(body))
		rec := httptest.NewRecorder()

		handler.HandleDownload(rec, req)

		if rec.Code != http.StatusInternalServerError {
			t.Errorf("Service lỗi nội bộ phải trả về 500, nhận được %d", rec.Code)
		}
	})

	t.Run("TC B-18: Tất cả các định dạng hợp lệ đều được chấp nhận", func(t *testing.T) {
		mockUC.downloadFunc = func(ctx context.Context, rawURL, format, quality string) (string, bool, error) {
			return "job-valid-fmt", false, nil
		}

		validFormats := []string{"mp3", "mp4", "m4a", "wav", "flac", "webm"}
		for _, format := range validFormats {
			body, _ := json.Marshal(map[string]string{
				"url":    "https://www.youtube.com/watch?v=valid",
				"format": format,
			})
			req := httptest.NewRequest(http.MethodPost, "/api/download", bytes.NewReader(body))
			rec := httptest.NewRecorder()

			handler.HandleDownload(rec, req)

			if rec.Code != http.StatusOK {
				t.Errorf("Định dạng hợp lệ '%s' phải trả về 200, nhận được %d", format, rec.Code)
			}
		}
	})
}
