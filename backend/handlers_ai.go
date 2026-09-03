package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"omniverse_backend/transcribe"
)

func (s *Server) handleTranscribe(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Giới hạn kích thước upload media 250MB
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

	originalFilename := header.Filename
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

	language := r.FormValue("language")
	if language == "" {
		language = "auto"
	}
	format := r.FormValue("format")
	if format == "" {
		format = "txt"
	}
	task := r.FormValue("task")
	if task == "" {
		task = "transcribe"
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

	// 1. Nếu có Worker Whisper Microservice -> Forward qua HTTP
	if s.workerWhisperURL != "" {
		respBody, statusCode, callErr := s.forwardMultipartToWorker(
			s.workerWhisperURL,
			"/api/transcribe",
			fileBytes,
			originalFilename,
			"file",
			map[string]string{
				"language": language,
				"format":   format,
				"task":     task,
			},
		)
		if callErr == nil && statusCode == http.StatusOK {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(respBody)
			return
		}
		log.Printf("⚠️ [WORKER WHISPER] Gọi worker thất bại (%v), fallback sang cục bộ...", callErr)
	}

	// 2. Fallback sang Go Native Transcribe Engine (whisper.cpp cục bộ)
	tempFileName := fmt.Sprintf("%s_%s", randomID(), originalFilename)
	tempFilePath := filepath.Join(s.downloadDir, tempFileName)

	destFile, err := os.Create(tempFilePath)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"detail":  "Không thể lưu file tải lên: " + err.Error(),
		})
		return
	}

	_, _ = destFile.Write(fileBytes)
	destFile.Close()
	defer os.Remove(tempFilePath)

	// Dùng mediaLimiter để tránh nghẽn CPU khi nhiều user cùng transcribe
	s.mediaLimiter <- struct{}{}
	defer func() { <-s.mediaLimiter }()

	result, err := transcribe.TranscribeMedia(tempFilePath, language, format, task, s.downloadDir)
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
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(result)
}

func (s *Server) handleRemoveBackground(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Giới hạn upload ảnh tối đa 50MB
	if err := r.ParseMultipartForm(50 << 20); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"detail":  "Kích thước file tải lên vượt quá giới hạn cho phép (50MB).",
		})
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"detail":  "Không tìm thấy file ảnh tải lên (tham số 'file').",
		})
		return
	}
	defer file.Close()

	originalFilename := header.Filename
	ext := strings.ToLower(filepath.Ext(originalFilename))
	allowedExts := map[string]bool{
		".png": true, ".jpg": true, ".jpeg": true, ".webp": true, ".bmp": true,
	}

	if !allowedExts[ext] {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"detail":  fmt.Sprintf("Định dạng file '%s' không được hỗ trợ. Vui lòng chọn ảnh PNG, JPG, WEBP hoặc BMP.", ext),
		})
		return
	}

	model := r.FormValue("model")
	if model == "" {
		model = "bria-rmbg"
	}
	bgColor := r.FormValue("bg_color")
	alphaMatting := r.FormValue("alpha_matting") == "true"

	fileBytes, err := io.ReadAll(file)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"detail":  "Không thể đọc file ảnh: " + err.Error(),
		})
		return
	}

	// 1. Nếu có Worker RMBG Microservice -> Forward qua HTTP với retry 3 lần
	if s.workerRmbgURL != "" {
		alphaStr := "false"
		if alphaMatting {
			alphaStr = "true"
		}

		var respBody []byte
		var statusCode int
		var callErr error

		// Retry tối đa 3 lần đề phòng Worker đang khởi động lại hoặc nạp lại OpenVINO
		for attempt := 1; attempt <= 3; attempt++ {
			respBody, statusCode, callErr = s.forwardMultipartToWorker(
				s.workerRmbgURL,
				"/api/remove-bg",
				fileBytes,
				originalFilename,
				"file",
				map[string]string{
					"model":         model,
					"bg_color":      bgColor,
					"alpha_matting": alphaStr,
				},
			)
			if callErr == nil && statusCode == http.StatusOK {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusOK)
				_, _ = w.Write(respBody)
				return
			}
			if attempt < 3 {
				time.Sleep(time.Duration(attempt) * 600 * time.Millisecond)
			}
		}
		log.Printf("⚠️ [WORKER RMBG] Gọi worker thất bại sau 3 lần thử (%v), statusCode=%d", callErr, statusCode)
	}

	// 2. Fallback sang CLI cục bộ (nếu có python3 trên máy chủ)
	if _, err := exec.LookPath("python3"); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"detail":  "Dịch vụ AI BiRefNet-Lite trên máy chủ đang bận xử lý hoặc đang khởi động. Vui lòng bấm thử lại sau 2 giây.",
		})
		return
	}

	id := randomID()
	tempInputName := fmt.Sprintf("in_%s%s", id, ext)
	tempInputPath := filepath.Join(s.downloadDir, tempInputName)

	destFile, err := os.Create(tempInputPath)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"detail":  "Không thể lưu file tải lên: " + err.Error(),
		})
		return
	}

	_, _ = destFile.Write(fileBytes)
	destFile.Close()
	defer os.Remove(tempInputPath)

	// File kết quả lưu vào s.downloadDir
	baseNameWithoutExt := strings.TrimSuffix(originalFilename, filepath.Ext(originalFilename))
	outputFilename := fmt.Sprintf("%s_%s_nobg.png", id, baseNameWithoutExt)
	outputPath := filepath.Join(s.downloadDir, outputFilename)

	// Giới hạn concurrency để tránh nghẽn CPU
	s.mediaLimiter <- struct{}{}
	defer func() { <-s.mediaLimiter }()

	startTime := time.Now()

	// Gọi python subprocess app.rmbg.cli
	args := []string{
		"-m", "app.rmbg.cli", "process",
		"--input", tempInputPath,
		"--output", outputPath,
		"--model", model,
	}
	if bgColor != "" && bgColor != "transparent" {
		args = append(args, "--bg-color", bgColor)
	}
	if alphaMatting {
		args = append(args, "--alpha-matting")
	}

	cmd := exec.Command("python3", args...)
	var stdoutBuf, stderrBuf bytes.Buffer
	cmd.Stdout = &stdoutBuf
	cmd.Stderr = &stderrBuf

	if err := cmd.Run(); err != nil {
		log.Printf("[RMBG ERROR] Python execution failed: %v, stderr: %s", err, stderrBuf.String())
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"detail":  "Lỗi khi xử lý tách nền: " + stderrBuf.String(),
		})
		return
	}

	var cliResp struct {
		Success        bool                   `json:"success"`
		OutputPath     string                 `json:"output_path"`
		OutputFilename string                 `json:"output_filename"`
		Error          string                 `json:"error"`
		Metadata       map[string]interface{} `json:"metadata"`
	}

	if err := json.Unmarshal(stdoutBuf.Bytes(), &cliResp); err != nil || !cliResp.Success {
		errMsg := cliResp.Error
		if errMsg == "" {
			errMsg = "Không thể phân tích kết quả từ module AI"
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"detail":  errMsg,
		})
		return
	}

	// Đọc ảnh kết quả và mã hóa base64 để frontend preview tức thì
	outBytes, readErr := os.ReadFile(outputPath)
	var base64Data string
	var resultSize int64
	if readErr == nil {
		resultSize = int64(len(outBytes))
		base64Data = "data:image/png;base64," + base64.StdEncoding.EncodeToString(outBytes)
	}

	processingDuration := time.Since(startTime)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"success":            true,
		"filename":           outputFilename,
		"download_url":       "/api/file/" + outputFilename,
		"original_filename":  originalFilename,
		"processing_time_ms": processingDuration.Milliseconds(),
		"result_size_bytes":  resultSize,
		"preview_base64":     base64Data,
		"metadata":           cliResp.Metadata,
	})
}
