package handler_test

import (
	"bytes"
	"context"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	delivery "omniverse_backend/internal/delivery/http"
)

// Mock ConvertUsecase
type mockConvertUsecase struct {
	validateMagicBytesFunc func(ext string, headerBytes []byte) error
	convertFunc            func(ctx context.Context, file io.Reader, fileSize int64, originalFilename, baseNameWithoutExt string, landscape bool, pdfa string) (map[string]interface{}, int, error)
}

func (m *mockConvertUsecase) ValidateFileMagicBytes(ext string, headerBytes []byte) error {
	if m.validateMagicBytesFunc != nil {
		return m.validateMagicBytesFunc(ext, headerBytes)
	}
	return nil
}

func (m *mockConvertUsecase) ConvertOfficeToPdf(
	ctx context.Context,
	file io.Reader,
	fileSize int64,
	originalFilename, baseNameWithoutExt string,
	landscape bool,
	pdfa string,
) (map[string]interface{}, int, error) {
	if m.convertFunc != nil {
		return m.convertFunc(ctx, file, fileSize, originalFilename, baseNameWithoutExt, landscape, pdfa)
	}
	return map[string]interface{}{"download_url": "/api/file/output.pdf", "filename": "output.pdf"}, http.StatusOK, nil
}

func (m *mockConvertUsecase) ConvertPdfToDocx(
	ctx context.Context,
	file io.Reader,
	fileSize int64,
	originalFilename, baseNameWithoutExt string,
) (map[string]interface{}, int, error) {
	return map[string]interface{}{"download_url": "/api/file/output.docx"}, http.StatusOK, nil
}

// =============================================================================
// TEST CASES: ConvertHandler (/api/convert/file) (B-45 -> B-51)
// =============================================================================

func TestConvertHandler_HandleConvertFile(t *testing.T) {
	mockUC := &mockConvertUsecase{}
	handler := delivery.NewConvertHandler(mockUC)

	t.Run("TC B-45: Từ chối method khác ngoài POST (GET -> 405)", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/convert/file", nil)
		rec := httptest.NewRecorder()

		handler.HandleConvertFile(rec, req)

		if rec.Code != http.StatusMethodNotAllowed {
			t.Errorf("Mong đợi HTTP 405, nhận được %d", rec.Code)
		}
	})

	t.Run("TC B-46: Request không phải Multipart Form (application/json -> 400)", func(t *testing.T) {
		body := bytes.NewReader([]byte(`{"file": "fake"}`))
		req := httptest.NewRequest(http.MethodPost, "/api/convert/file", body)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()

		handler.HandleConvertFile(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Errorf("Mong đợi HTTP 400, nhận được %d", rec.Code)
		}
	})

	t.Run("TC B-47: Thiếu trường 'file' trong Multipart Form -> 400", func(t *testing.T) {
		body := &bytes.Buffer{}
		writer := multipart.NewWriter(body)
		_ = writer.WriteField("landscape", "true")
		_ = writer.Close()

		req := httptest.NewRequest(http.MethodPost, "/api/convert/file", body)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		rec := httptest.NewRecorder()

		handler.HandleConvertFile(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Errorf("Thiếu file phải trả về 400, nhận được %d", rec.Code)
		}
	})

	t.Run("TC B-48: File có kích thước rỗng 0 bytes -> 400", func(t *testing.T) {
		body := &bytes.Buffer{}
		writer := multipart.NewWriter(body)
		part, _ := writer.CreateFormFile("file", "empty.docx")
		_, _ = part.Write([]byte{})
		_ = writer.Close()

		req := httptest.NewRequest(http.MethodPost, "/api/convert/file", body)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		rec := httptest.NewRecorder()

		handler.HandleConvertFile(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Errorf("File rỗng phải trả về 400, nhận được %d", rec.Code)
		}
	})

	t.Run("TC B-49: File có định dạng không được hỗ trợ (.exe -> 400)", func(t *testing.T) {
		body := &bytes.Buffer{}
		writer := multipart.NewWriter(body)
		part, _ := writer.CreateFormFile("file", "program.exe")
		_, _ = part.Write([]byte("fake executable data"))
		_ = writer.Close()

		req := httptest.NewRequest(http.MethodPost, "/api/convert/file", body)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		rec := httptest.NewRecorder()

		handler.HandleConvertFile(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Errorf("File .exe phải trả về 400, nhận được %d", rec.Code)
		}
	})

	t.Run("TC B-50: ValidateFileMagicBytes thất bại (File giả mạo đuôi -> 400)", func(t *testing.T) {
		mockUC.validateMagicBytesFunc = func(ext string, headerBytes []byte) error {
			return errors.New("thiếu chữ ký ZIP container (PK)")
		}

		body := &bytes.Buffer{}
		writer := multipart.NewWriter(body)
		part, _ := writer.CreateFormFile("file", "fake.docx")
		_, _ = part.Write([]byte("not a real docx file"))
		_ = writer.Close()

		req := httptest.NewRequest(http.MethodPost, "/api/convert/file", body)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		rec := httptest.NewRecorder()

		handler.HandleConvertFile(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Errorf("Chữ ký file không hợp lệ phải trả về 400, nhận được %d", rec.Code)
		}
	})

	t.Run("TC B-51: Chuyển đổi thành công tài liệu DOCX sang PDF -> 200 OK", func(t *testing.T) {
		mockUC.validateMagicBytesFunc = func(ext string, headerBytes []byte) error {
			return nil
		}
		mockUC.convertFunc = func(ctx context.Context, file io.Reader, fileSize int64, originalFilename, baseNameWithoutExt string, landscape bool, pdfa string) (map[string]interface{}, int, error) {
			return map[string]interface{}{
				"download_url": "/api/file/report.pdf",
				"filename":     "report.pdf",
				"file_size":    10240,
			}, http.StatusOK, nil
		}

		body := &bytes.Buffer{}
		writer := multipart.NewWriter(body)
		part, _ := writer.CreateFormFile("file", "report.docx")
		_, _ = part.Write([]byte{0x50, 0x4B, 0x03, 0x04, 0x00, 0x00}) // PK zip magic bytes
		_ = writer.Close()

		req := httptest.NewRequest(http.MethodPost, "/api/convert/file", body)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		rec := httptest.NewRecorder()

		handler.HandleConvertFile(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("Chuyển đổi thành công phải trả về 200, nhận được %d: %s", rec.Code, rec.Body.String())
		}

		if !strings.Contains(rec.Body.String(), "report.pdf") {
			t.Errorf("Body phản hồi phải chứa download URL file pdf: %s", rec.Body.String())
		}
	})
}
