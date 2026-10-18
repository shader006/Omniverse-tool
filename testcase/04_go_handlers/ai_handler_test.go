package handler_test

import (
	"bytes"
	"context"
	"errors"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	delivery "omniverse_backend/internal/delivery/http"
)

// Mock AIUsecase
type mockAIUsecase struct {
	transcribeFunc func(ctx context.Context, fileBytes []byte, filename, language, format, task string) ([]byte, int, error)
	removeBgFunc   func(ctx context.Context, fileBytes []byte, filename, model, threshold, returnMask string) ([]byte, int, error)
}

func (m *mockAIUsecase) TranscribeAudio(ctx context.Context, fileBytes []byte, filename, language, format, task string) ([]byte, int, error) {
	if m.transcribeFunc != nil {
		return m.transcribeFunc(ctx, fileBytes, filename, language, format, task)
	}
	return []byte(`{"text":"Xin chào Việt Nam"}`), http.StatusOK, nil
}

func (m *mockAIUsecase) RemoveBackground(ctx context.Context, fileBytes []byte, filename, model, threshold, returnMask string) ([]byte, int, error) {
	if m.removeBgFunc != nil {
		return m.removeBgFunc(ctx, fileBytes, filename, model, threshold, returnMask)
	}
	return []byte("fake-png-transparent-bytes"), http.StatusOK, nil
}

func (m *mockAIUsecase) ForwardToWorker(ctx context.Context, workerURL, path string, fileBytes []byte, filename string, fieldName string, formValues map[string]string) ([]byte, int, error) {
	return nil, http.StatusNotImplemented, nil
}

func (m *mockAIUsecase) ForwardToWorkerLong(ctx context.Context, workerURL, path string, fileBytes []byte, filename string, fieldName string, formValues map[string]string) ([]byte, int, error) {
	return nil, http.StatusNotImplemented, nil
}

func (m *mockAIUsecase) CheckWorkerHealth(ctx context.Context, workerURL, path string) ([]byte, int, error) {
	return []byte(`{"status":"ok"}`), http.StatusOK, nil
}

func (m *mockAIUsecase) GetPixelfixerURL() string { return "http://localhost:8001" }
func (m *mockAIUsecase) GetUpscalerURL() string   { return "http://localhost:8002" }

// =============================================================================
// TEST CASES: AIHandler HandleTranscribe (B-52 -> B-68)
// =============================================================================

func TestAIHandler_HandleTranscribe(t *testing.T) {
	mockUC := &mockAIUsecase{}
	handler := delivery.NewAIHandler(mockUC, nil)

	t.Run("TC B-52: Từ chối method khác ngoài POST (GET -> 405)", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/transcribe", nil)
		rec := httptest.NewRecorder()

		handler.HandleTranscribe(rec, req)

		if rec.Code != http.StatusMethodNotAllowed {
			t.Errorf("Mong đợi HTTP 405, nhận được %d", rec.Code)
		}
	})

	t.Run("TC B-53: Thiếu file tải lên trong form -> 400", func(t *testing.T) {
		body := &bytes.Buffer{}
		writer := multipart.NewWriter(body)
		_ = writer.Close()

		req := httptest.NewRequest(http.MethodPost, "/api/transcribe", body)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		rec := httptest.NewRecorder()

		handler.HandleTranscribe(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Errorf("Mong đợi HTTP 400 khi thiếu file, nhận được %d", rec.Code)
		}
	})

	t.Run("TC B-54: Đuôi file không phải audio/video (.pdf, .exe -> 400)", func(t *testing.T) {
		invalidExts := []string{"document.pdf", "program.exe", "archive.zip", "data.csv"}

		for _, filename := range invalidExts {
			body := &bytes.Buffer{}
			writer := multipart.NewWriter(body)
			part, _ := writer.CreateFormFile("file", filename)
			_, _ = part.Write([]byte("fake data"))
			_ = writer.Close()

			req := httptest.NewRequest(http.MethodPost, "/api/transcribe", body)
			req.Header.Set("Content-Type", writer.FormDataContentType())
			rec := httptest.NewRecorder()

			handler.HandleTranscribe(rec, req)

			if rec.Code != http.StatusBadRequest {
				t.Errorf("File '%s' không phải âm thanh/video phải trả về 400, nhận được %d", filename, rec.Code)
			}
		}
	})

	t.Run("TC B-55: Định dạng xuất (format) không hợp lệ -> 400", func(t *testing.T) {
		body := &bytes.Buffer{}
		writer := multipart.NewWriter(body)
		part, _ := writer.CreateFormFile("file", "audio.mp3")
		_, _ = part.Write([]byte("fake audio content"))
		_ = writer.WriteField("format", "invalid_format")
		_ = writer.Close()

		req := httptest.NewRequest(http.MethodPost, "/api/transcribe", body)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		rec := httptest.NewRecorder()

		handler.HandleTranscribe(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Errorf("Format không hợp lệ phải trả về 400, nhận được %d", rec.Code)
		}
	})

	t.Run("TC B-56: Tác vụ (task) không hợp lệ -> 400", func(t *testing.T) {
		body := &bytes.Buffer{}
		writer := multipart.NewWriter(body)
		part, _ := writer.CreateFormFile("file", "audio.mp3")
		_, _ = part.Write([]byte("fake audio content"))
		_ = writer.WriteField("task", "hacker_task")
		_ = writer.Close()

		req := httptest.NewRequest(http.MethodPost, "/api/transcribe", body)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		rec := httptest.NewRecorder()

		handler.HandleTranscribe(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Errorf("Task không hợp lệ phải trả về 400, nhận được %d", rec.Code)
		}
	})

	t.Run("TC B-57: Nhận diện giọng nói thành công với WAV -> 200 OK", func(t *testing.T) {
		body := &bytes.Buffer{}
		writer := multipart.NewWriter(body)
		part, _ := writer.CreateFormFile("file", "interview.wav")
		_, _ = part.Write([]byte("RIFF wave header fake"))
		_ = writer.WriteField("language", "vi")
		_ = writer.WriteField("format", "json")
		_ = writer.WriteField("task", "transcribe")
		_ = writer.Close()

		req := httptest.NewRequest(http.MethodPost, "/api/transcribe", body)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		rec := httptest.NewRecorder()

		handler.HandleTranscribe(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("Transcribe thành công phải trả về 200, nhận được %d", rec.Code)
		}
	})

	t.Run("TC B-58: Tác vụ 'translate' hợp lệ được chấp nhận -> 200 OK", func(t *testing.T) {
		body := &bytes.Buffer{}
		writer := multipart.NewWriter(body)
		part, _ := writer.CreateFormFile("file", "speech.m4a")
		_, _ = part.Write([]byte("fake m4a data"))
		_ = writer.WriteField("task", "translate")
		_ = writer.WriteField("format", "txt")
		_ = writer.Close()

		req := httptest.NewRequest(http.MethodPost, "/api/transcribe", body)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		rec := httptest.NewRecorder()

		handler.HandleTranscribe(rec, req)

		if rec.Code != http.StatusOK {
			t.Errorf("Task 'translate' hợp lệ phải trả về 200, nhận được %d", rec.Code)
		}
	})

	t.Run("TC B-59: Format mặc định 'txt' khi không truyền format -> 200 OK", func(t *testing.T) {
		capturedFormat := ""
		mockUC.transcribeFunc = func(ctx context.Context, fileBytes []byte, filename, language, format, task string) ([]byte, int, error) {
			capturedFormat = format
			return []byte(`{"text":"test"}`), http.StatusOK, nil
		}

		body := &bytes.Buffer{}
		writer := multipart.NewWriter(body)
		part, _ := writer.CreateFormFile("file", "audio.ogg")
		_, _ = part.Write([]byte("fake ogg"))
		_ = writer.Close()

		req := httptest.NewRequest(http.MethodPost, "/api/transcribe", body)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		rec := httptest.NewRecorder()

		handler.HandleTranscribe(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("Format mặc định phải cho phép thành công, nhận được %d", rec.Code)
		}
		if capturedFormat != "txt" {
			t.Errorf("Format mặc định phải là 'txt', nhận được '%s'", capturedFormat)
		}
	})

	t.Run("TC B-60: Language mặc định 'auto' khi không truyền language -> 200 OK", func(t *testing.T) {
		capturedLang := ""
		mockUC.transcribeFunc = func(ctx context.Context, fileBytes []byte, filename, language, format, task string) ([]byte, int, error) {
			capturedLang = language
			return []byte(`{"text":"test"}`), http.StatusOK, nil
		}

		body := &bytes.Buffer{}
		writer := multipart.NewWriter(body)
		part, _ := writer.CreateFormFile("file", "audio.aac")
		_, _ = part.Write([]byte("fake aac"))
		_ = writer.Close()

		req := httptest.NewRequest(http.MethodPost, "/api/transcribe", body)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		rec := httptest.NewRecorder()

		handler.HandleTranscribe(rec, req)

		if capturedLang != "auto" {
			t.Errorf("Language mặc định phải là 'auto', nhận được '%s'", capturedLang)
		}
	})

	t.Run("TC B-61: AI service trả lỗi -> chuyển tiếp đúng status code", func(t *testing.T) {
		mockUC.transcribeFunc = func(ctx context.Context, fileBytes []byte, filename, language, format, task string) ([]byte, int, error) {
			return nil, http.StatusServiceUnavailable, errors.New("Worker Whisper đang bận")
		}

		body := &bytes.Buffer{}
		writer := multipart.NewWriter(body)
		part, _ := writer.CreateFormFile("file", "audio.mp3")
		_, _ = part.Write([]byte("fake mp3"))
		_ = writer.Close()

		req := httptest.NewRequest(http.MethodPost, "/api/transcribe", body)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		rec := httptest.NewRecorder()

		handler.HandleTranscribe(rec, req)

		if rec.Code != http.StatusServiceUnavailable {
			t.Errorf("Service unavailable phải chuyển tiếp 503, nhận được %d", rec.Code)
		}
	})

	t.Run("TC B-62: Tất cả định dạng audio/video hợp lệ đều được chấp nhận", func(t *testing.T) {
		mockUC.transcribeFunc = nil // reset về default
		validFiles := []string{"a.mp3", "b.mp4", "c.wav", "d.m4a", "e.webm", "f.flac", "g.ogg", "h.aac", "i.mov", "j.avi", "k.mkv"}

		for _, filename := range validFiles {
			body := &bytes.Buffer{}
			writer := multipart.NewWriter(body)
			part, _ := writer.CreateFormFile("file", filename)
			_, _ = part.Write([]byte("fake content"))
			_ = writer.Close()

			req := httptest.NewRequest(http.MethodPost, "/api/transcribe", body)
			req.Header.Set("Content-Type", writer.FormDataContentType())
			rec := httptest.NewRecorder()

			handler.HandleTranscribe(rec, req)

			if rec.Code != http.StatusOK {
				t.Errorf("File hợp lệ '%s' phải trả về 200, nhận được %d", filename, rec.Code)
			}
		}
	})

	t.Run("TC B-63: Tất cả format xuất hợp lệ (txt, srt, vtt, json) đều được chấp nhận", func(t *testing.T) {
		validFormats := []string{"txt", "srt", "vtt", "json"}

		for _, format := range validFormats {
			body := &bytes.Buffer{}
			writer := multipart.NewWriter(body)
			part, _ := writer.CreateFormFile("file", "audio.mp3")
			_, _ = part.Write([]byte("fake content"))
			_ = writer.WriteField("format", format)
			_ = writer.Close()

			req := httptest.NewRequest(http.MethodPost, "/api/transcribe", body)
			req.Header.Set("Content-Type", writer.FormDataContentType())
			rec := httptest.NewRecorder()

			handler.HandleTranscribe(rec, req)

			if rec.Code != http.StatusOK {
				t.Errorf("Format hợp lệ '%s' phải trả về 200, nhận được %d", format, rec.Code)
			}
		}
	})
}

// =============================================================================
// TEST CASES: AIHandler HandleRemoveBackground (B-64 -> B-78)
// =============================================================================

func TestAIHandler_HandleRemoveBackground(t *testing.T) {
	mockUC := &mockAIUsecase{}
	handler := delivery.NewAIHandler(mockUC, nil)

	t.Run("TC B-64: Từ chối method khác ngoài POST (GET -> 405)", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/remove-bg", nil)
		rec := httptest.NewRecorder()

		handler.HandleRemoveBackground(rec, req)

		if rec.Code != http.StatusMethodNotAllowed {
			t.Errorf("Mong đợi HTTP 405, nhận được %d", rec.Code)
		}
	})

	t.Run("TC B-65: Thiếu file tải lên trong form -> 400", func(t *testing.T) {
		body := &bytes.Buffer{}
		writer := multipart.NewWriter(body)
		_ = writer.WriteField("model", "General-Use")
		_ = writer.Close()

		req := httptest.NewRequest(http.MethodPost, "/api/remove-bg", body)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		rec := httptest.NewRecorder()

		handler.HandleRemoveBackground(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Errorf("Thiếu file phải trả về 400, nhận được %d", rec.Code)
		}
	})

	t.Run("TC B-66: Đuôi file không phải ảnh (.mp4, .txt -> 400)", func(t *testing.T) {
		invalidFiles := []string{"video.mp4", "doc.txt", "audio.mp3", "archive.zip"}

		for _, filename := range invalidFiles {
			body := &bytes.Buffer{}
			writer := multipart.NewWriter(body)
			part, _ := writer.CreateFormFile("file", filename)
			_, _ = part.Write([]byte("fake data"))
			_ = writer.Close()

			req := httptest.NewRequest(http.MethodPost, "/api/remove-bg", body)
			req.Header.Set("Content-Type", writer.FormDataContentType())
			rec := httptest.NewRecorder()

			handler.HandleRemoveBackground(rec, req)

			if rec.Code != http.StatusBadRequest {
				t.Errorf("File '%s' không phải ảnh phải trả về 400, nhận được %d", filename, rec.Code)
			}
		}
	})

	t.Run("TC B-67: Tách nền ảnh PNG thành công -> 200 OK", func(t *testing.T) {
		body := &bytes.Buffer{}
		writer := multipart.NewWriter(body)
		part, _ := writer.CreateFormFile("file", "portrait.png")
		_, _ = part.Write([]byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}) // PNG magic bytes
		_ = writer.WriteField("model", "birefnet-general")
		_ = writer.Close()

		req := httptest.NewRequest(http.MethodPost, "/api/remove-bg", body)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		rec := httptest.NewRecorder()

		handler.HandleRemoveBackground(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("Tách nền PNG thành công phải trả về 200, nhận được %d", rec.Code)
		}
	})

	t.Run("TC B-68: Tách nền ảnh JPEG thành công -> 200 OK", func(t *testing.T) {
		body := &bytes.Buffer{}
		writer := multipart.NewWriter(body)
		part, _ := writer.CreateFormFile("file", "photo.jpg")
		_, _ = part.Write([]byte{0xFF, 0xD8, 0xFF, 0xE0}) // JPEG magic bytes
		_ = writer.Close()

		req := httptest.NewRequest(http.MethodPost, "/api/remove-bg", body)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		rec := httptest.NewRecorder()

		handler.HandleRemoveBackground(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("Tách nền JPEG thành công phải trả về 200, nhận được %d", rec.Code)
		}
	})

	t.Run("TC B-69: Tách nền ảnh WEBP thành công -> 200 OK", func(t *testing.T) {
		body := &bytes.Buffer{}
		writer := multipart.NewWriter(body)
		part, _ := writer.CreateFormFile("file", "image.webp")
		_, _ = part.Write([]byte("RIFF????WEBP"))
		_ = writer.Close()

		req := httptest.NewRequest(http.MethodPost, "/api/remove-bg", body)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		rec := httptest.NewRecorder()

		handler.HandleRemoveBackground(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("Tách nền WEBP thành công phải trả về 200, nhận được %d", rec.Code)
		}
	})

	t.Run("TC B-70: Model mặc định 'General-Use' khi không truyền model -> 200 OK", func(t *testing.T) {
		capturedModel := ""
		mockUC.removeBgFunc = func(ctx context.Context, fileBytes []byte, filename, model, threshold, returnMask string) ([]byte, int, error) {
			capturedModel = model
			return []byte("fake-png-bytes"), http.StatusOK, nil
		}

		body := &bytes.Buffer{}
		writer := multipart.NewWriter(body)
		part, _ := writer.CreateFormFile("file", "image.png")
		_, _ = part.Write([]byte{0x89, 0x50, 0x4E, 0x47})
		_ = writer.Close()

		req := httptest.NewRequest(http.MethodPost, "/api/remove-bg", body)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		rec := httptest.NewRecorder()

		handler.HandleRemoveBackground(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("Không truyền model phải dùng mặc định và thành công, nhận được %d", rec.Code)
		}
		if capturedModel != "General-Use" {
			t.Errorf("Model mặc định phải là 'General-Use', nhận được '%s'", capturedModel)
		}
	})

	t.Run("TC B-71: Threshold mặc định '0.5' khi không truyền threshold", func(t *testing.T) {
		capturedThreshold := ""
		mockUC.removeBgFunc = func(ctx context.Context, fileBytes []byte, filename, model, threshold, returnMask string) ([]byte, int, error) {
			capturedThreshold = threshold
			return []byte("fake-png-bytes"), http.StatusOK, nil
		}

		body := &bytes.Buffer{}
		writer := multipart.NewWriter(body)
		part, _ := writer.CreateFormFile("file", "image.png")
		_, _ = part.Write([]byte{0x89, 0x50, 0x4E, 0x47})
		_ = writer.Close()

		req := httptest.NewRequest(http.MethodPost, "/api/remove-bg", body)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		rec := httptest.NewRecorder()

		handler.HandleRemoveBackground(rec, req)

		if capturedThreshold != "0.5" {
			t.Errorf("Threshold mặc định phải là '0.5', nhận được '%s'", capturedThreshold)
		}
	})

	t.Run("TC B-72: Truyền model custom và return_mask=true đến service đúng -> 200 OK", func(t *testing.T) {
		capturedReturnMask := ""
		mockUC.removeBgFunc = func(ctx context.Context, fileBytes []byte, filename, model, threshold, returnMask string) ([]byte, int, error) {
			capturedReturnMask = returnMask
			return []byte("fake-mask-bytes"), http.StatusOK, nil
		}

		body := &bytes.Buffer{}
		writer := multipart.NewWriter(body)
		part, _ := writer.CreateFormFile("file", "image.jpeg")
		_, _ = part.Write([]byte{0xFF, 0xD8, 0xFF})
		_ = writer.WriteField("model", "birefnet-portrait")
		_ = writer.WriteField("threshold", "0.7")
		_ = writer.WriteField("return_mask", "true")
		_ = writer.Close()

		req := httptest.NewRequest(http.MethodPost, "/api/remove-bg", body)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		rec := httptest.NewRecorder()

		handler.HandleRemoveBackground(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("Custom model phải trả về 200, nhận được %d", rec.Code)
		}
		if capturedReturnMask != "true" {
			t.Errorf("return_mask phải được chuyển tiếp là 'true', nhận được '%s'", capturedReturnMask)
		}
	})

	t.Run("TC B-73: AI service tách nền thất bại -> chuyển tiếp status code lỗi", func(t *testing.T) {
		mockUC.removeBgFunc = func(ctx context.Context, fileBytes []byte, filename, model, threshold, returnMask string) ([]byte, int, error) {
			return nil, http.StatusBadGateway, errors.New("Worker RemoveBG không phản hồi")
		}

		body := &bytes.Buffer{}
		writer := multipart.NewWriter(body)
		part, _ := writer.CreateFormFile("file", "image.png")
		_, _ = part.Write([]byte{0x89, 0x50, 0x4E, 0x47})
		_ = writer.Close()

		req := httptest.NewRequest(http.MethodPost, "/api/remove-bg", body)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		rec := httptest.NewRecorder()

		handler.HandleRemoveBackground(rec, req)

		if rec.Code != http.StatusBadGateway {
			t.Errorf("Worker lỗi phải chuyển tiếp 502 Bad Gateway, nhận được %d", rec.Code)
		}
	})
}
