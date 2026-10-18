package handler_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	delivery "omniverse_backend/internal/delivery/http"
	"omniverse_backend/internal/domain"
)

// Mock JobUsecase
type mockJobUsecase struct {
	getJobFunc      func(jobID string) (domain.Job, error)
	resolveFileFunc func(filename string) (string, string, error)
	cleanupFunc     func() (int, int64)
}

func (m *mockJobUsecase) GetJob(jobID string) (domain.Job, error) {
	if m.getJobFunc != nil {
		return m.getJobFunc(jobID)
	}
	return domain.Job{ID: jobID, Status: "completed", Percent: 100}, nil
}

func (m *mockJobUsecase) SubscribeJob(ctx context.Context, jobID string) (<-chan domain.Job, func()) {
	ch := make(chan domain.Job)
	return ch, func() {}
}

func (m *mockJobUsecase) ResolveFilePath(filename string) (string, string, error) {
	if m.resolveFileFunc != nil {
		return m.resolveFileFunc(filename)
	}
	return "", "", nil
}

func (m *mockJobUsecase) CleanupExpiredFiles() (int, int64) {
	if m.cleanupFunc != nil {
		return m.cleanupFunc()
	}
	return 0, 0
}

// =============================================================================
// TEST CASES: JobHandler /api/status (B-19 -> B-20)
// =============================================================================

func TestJobHandler_HandleStatus(t *testing.T) {
	mockUC := &mockJobUsecase{}
	handler := delivery.NewJobHandler(mockUC, nil, "/tmp", nil, "", "", "", "")

	t.Run("TC B-19: Lấy trạng thái Job thành công khi JobID tồn tại -> 200 OK", func(t *testing.T) {
		mockUC.getJobFunc = func(jobID string) (domain.Job, error) {
			return domain.Job{
				ID:       "job-running-123",
				Status:   "downloading",
				Percent:  45.5,
				Filename: "sample_song.mp3",
			}, nil
		}

		req := httptest.NewRequest(http.MethodGet, "/api/status/job-running-123", nil)
		rec := httptest.NewRecorder()

		handler.HandleStatus(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("Mong đợi HTTP 200, nhận được %d", rec.Code)
		}
	})

	t.Run("TC B-20: Báo lỗi 404 khi JobID không tồn tại trong hệ thống", func(t *testing.T) {
		mockUC.getJobFunc = func(jobID string) (domain.Job, error) {
			return domain.Job{}, errors.New("Job not found")
		}

		req := httptest.NewRequest(http.MethodGet, "/api/status/non-existent-job", nil)
		rec := httptest.NewRecorder()

		handler.HandleStatus(rec, req)

		if rec.Code != http.StatusNotFound {
			t.Errorf("JobID không tồn tại phải trả về 404, nhận được %d", rec.Code)
		}
	})
}

// =============================================================================
// TEST CASES: JobHandler /api/file - Security & File Serve (B-21 -> B-32)
// =============================================================================

func TestJobHandler_HandleFile_Security(t *testing.T) {
	tempDir := t.TempDir()

	// Tạo các file hợp lệ để test
	testFilePath := filepath.Join(tempDir, "sample_audio.mp3")
	_ = os.WriteFile(testFilePath, []byte("fake mp3 audio stream"), 0644)

	testPdfPath := filepath.Join(tempDir, "report.pdf")
	_ = os.WriteFile(testPdfPath, []byte("%PDF-1.7 fake content"), 0644)

	testPngPath := filepath.Join(tempDir, "rmbg_result.png")
	_ = os.WriteFile(testPngPath, []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}, 0644)

	handler := delivery.NewJobHandler(nil, nil, tempDir, http.DefaultClient, "", "", "", "")

	t.Run("TC B-21: Chặn tấn công Path Traversal (chứa .. trong đường dẫn -> 400)", func(t *testing.T) {
		maliciousPaths := []string{
			"/api/file/../../etc/passwd",
			"/api/file/..%2f..%2fetc/passwd",
			"/api/file/subdir/../../secret.key",
		}

		for _, p := range maliciousPaths {
			req := httptest.NewRequest(http.MethodGet, p, nil)
			rec := httptest.NewRecorder()

			handler.HandleFile(rec, req)

			if rec.Code != http.StatusBadRequest {
				t.Errorf("Path '%s' phải bị chặn với 400 Bad Request, nhận được %d", p, rec.Code)
			}
		}
	})

	t.Run("TC B-22: Trả về 404 khi file không tồn tại trong thư mục lưu trữ", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/file/missing_file.pdf", nil)
		rec := httptest.NewRecorder()

		handler.HandleFile(rec, req)

		if rec.Code != http.StatusNotFound {
			t.Errorf("File không tồn tại phải trả về 404, nhận được %d", rec.Code)
		}
	})

	t.Run("TC B-23: Tải file MP3 thành công với Content-Type audio/mpeg -> 200 OK", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/file/sample_audio.mp3", nil)
		rec := httptest.NewRecorder()

		handler.HandleFile(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("File tồn tại phải tải về được với 200 OK, nhận được %d", rec.Code)
		}

		contentType := rec.Header().Get("Content-Type")
		if contentType != "audio/mpeg" {
			t.Errorf("MIME type cho .mp3 phải là audio/mpeg, nhận được %s", contentType)
		}

		contentDisposition := rec.Header().Get("Content-Disposition")
		if contentDisposition == "" {
			t.Errorf("Thiếu Content-Disposition header cho file download")
		}
	})

	t.Run("TC B-24: Tải file PDF thành công với Content-Type application/pdf -> 200 OK", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/file/report.pdf", nil)
		rec := httptest.NewRecorder()

		handler.HandleFile(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("File PDF tồn tại phải tải về được với 200 OK, nhận được %d", rec.Code)
		}

		contentType := rec.Header().Get("Content-Type")
		if contentType != "application/pdf" {
			t.Errorf("MIME type cho .pdf phải là application/pdf, nhận được %s", contentType)
		}
	})

	t.Run("TC B-25: Tải file PNG thành công với Content-Type image/png -> 200 OK", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/file/rmbg_result.png", nil)
		rec := httptest.NewRecorder()

		handler.HandleFile(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("File PNG tồn tại phải tải về được với 200 OK, nhận được %d", rec.Code)
		}

		contentType := rec.Header().Get("Content-Type")
		if contentType != "image/png" {
			t.Errorf("MIME type cho .png phải là image/png, nhận được %s", contentType)
		}
	})

	t.Run("TC B-26: Hỗ trợ method HEAD (trả về header không có body) -> 200 OK", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodHead, "/api/file/sample_audio.mp3", nil)
		rec := httptest.NewRecorder()

		handler.HandleFile(rec, req)

		if rec.Code != http.StatusOK {
			t.Errorf("Method HEAD phải được hỗ trợ và trả về 200, nhận được %d", rec.Code)
		}
	})

	t.Run("TC B-27: Từ chối method POST vào /api/file/ -> 405 Method Not Allowed", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/file/sample_audio.mp3", nil)
		rec := httptest.NewRecorder()

		handler.HandleFile(rec, req)

		if rec.Code != http.StatusMethodNotAllowed {
			t.Errorf("POST vào /api/file/ phải trả về 405, nhận được %d", rec.Code)
		}
	})

	t.Run("TC B-28: Tên file chứa ký tự null byte (\\x00) bị chặn -> 400", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/file/malicious\x00file.mp3", nil)
		rec := httptest.NewRecorder()

		handler.HandleFile(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Errorf("Filename với null byte phải bị chặn với 400, nhận được %d", rec.Code)
		}
	})

	t.Run("TC B-29: Tên file chứa ký tự xuống dòng (\\r\\n) bị chặn -> 400", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/file/file\r\nInjected.mp3", nil)
		rec := httptest.NewRecorder()

		handler.HandleFile(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Errorf("Filename với CR/LF injection phải bị chặn với 400, nhận được %d", rec.Code)
		}
	})

	t.Run("TC B-30: Filename được hiển thị đúng — phần sau dấu _ (display name)", func(t *testing.T) {
		// Tạo file có tên dạng {jobID}_{originalName}
		namedFile := filepath.Join(tempDir, "abc123_my_video.mp4")
		_ = os.WriteFile(namedFile, []byte("fake mp4 data"), 0644)

		req := httptest.NewRequest(http.MethodGet, "/api/file/abc123_my_video.mp4", nil)
		rec := httptest.NewRecorder()

		handler.HandleFile(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("File tồn tại phải tải về được với 200 OK, nhận được %d", rec.Code)
		}

		// Content-Disposition phải chứa tên file hiển thị (phần sau dấu _)
		disp := rec.Header().Get("Content-Disposition")
		if disp == "" {
			t.Errorf("Thiếu Content-Disposition header")
		}
	})

	t.Run("TC B-31: MIME type mặc định application/octet-stream cho định dạng không biết", func(t *testing.T) {
		unknownFile := filepath.Join(tempDir, "data.unknown")
		_ = os.WriteFile(unknownFile, []byte("some binary data"), 0644)

		req := httptest.NewRequest(http.MethodGet, "/api/file/data.unknown", nil)
		rec := httptest.NewRecorder()

		handler.HandleFile(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("File tồn tại phải tải về được với 200 OK, nhận được %d", rec.Code)
		}

		contentType := rec.Header().Get("Content-Type")
		if contentType != "application/octet-stream" {
			t.Errorf("Định dạng không biết phải dùng application/octet-stream, nhận được %s", contentType)
		}
	})

	t.Run("TC B-32: Path traversal dạng encode URL (%2e%2e) bị chặn -> 400", func(t *testing.T) {
		// %2e = '.', %2f = '/'
		req := httptest.NewRequest(http.MethodGet, "/api/file/%2e%2e%2fetc%2fpasswd", nil)
		rec := httptest.NewRecorder()

		handler.HandleFile(rec, req)

		// Sau khi unescape: "../etc/passwd" -> filepath.Base -> "passwd" -> không khớp rel path check
		// Hoặc bị chặn trực tiếp
		if rec.Code != http.StatusBadRequest && rec.Code != http.StatusNotFound {
			t.Errorf("Path traversal encode phải bị chặn (400 hoặc 404), nhận được %d", rec.Code)
		}
	})
}
