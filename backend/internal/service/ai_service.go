package service

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"

	"omniverse_backend/internal/domain"
	"omniverse_backend/internal/infrastructure/engine/transcribe"
)

type AIService struct {
	workerClient             domain.WorkerClient
	mediaLimiter             chan struct{}
	downloadDir              string
	workerWhisperURL         string
	workerWhisperFallbackURL string
	workerRmbgURL            string
	workerRmbgFallbackURL    string
	workerPixelfixerURL      string
	workerUpscalerURL        string
}

func NewAIService(
	wc domain.WorkerClient,
	limiter chan struct{},
	downloadDir string,
	workerWhisperURL string,
	workerWhisperFallbackURL string,
	workerRmbgURL string,
	workerRmbgFallbackURL string,
	workerPixelfixerURL string,
	workerUpscalerURL string,
) *AIService {
	return &AIService{
		workerClient:             wc,
		mediaLimiter:             limiter,
		downloadDir:              downloadDir,
		workerWhisperURL:         workerWhisperURL,
		workerWhisperFallbackURL: workerWhisperFallbackURL,
		workerRmbgURL:            workerRmbgURL,
		workerRmbgFallbackURL:    workerRmbgFallbackURL,
		workerPixelfixerURL:      workerPixelfixerURL,
		workerUpscalerURL:        workerUpscalerURL,
	}
}

// ── 1. NHẬN DIỆN GIỌNG NÓI (WHISPER) ──

func (s *AIService) TranscribeAudio(
	ctx context.Context,
	fileBytes []byte,
	filename string,
	language string,
	format string,
	task string,
) ([]byte, int, error) {
	var whisperWorkers []string
	if s.workerWhisperURL != "" {
		whisperWorkers = append(whisperWorkers, s.workerWhisperURL)
	}
	if s.workerWhisperFallbackURL != "" && s.workerWhisperFallbackURL != s.workerWhisperURL {
		whisperWorkers = append(whisperWorkers, s.workerWhisperFallbackURL)
	}

	for idx, targetWorker := range whisperWorkers {
		respBody, statusCode, callErr := s.workerClient.ForwardMultipartToWorker(
			ctx,
			targetWorker,
			"/api/transcribe",
			fileBytes,
			filename,
			"file",
			map[string]string{
				"language": language,
				"format":   format,
				"task":     task,
			},
		)
		if callErr == nil && (statusCode == http.StatusOK || statusCode == http.StatusBadRequest) {
			return respBody, statusCode, nil
		}
		log.Printf("⚠️ [WORKER WHISPER] Gọi worker (%s) thất bại (%v), statusCode=%d", targetWorker, callErr, statusCode)
		if idx < len(whisperWorkers)-1 {
			log.Printf("🔄 [WORKER WHISPER] Tự động chuyển đổi sang worker dự phòng: %s", whisperWorkers[idx+1])
		}
	}

	// 2. Fallback sang Go Native Transcribe Engine (whisper.cpp cục bộ)
	whisperBin := os.Getenv("WHISPER_BIN")
	if whisperBin == "" {
		whisperBin = "/usr/local/bin/whisper-cli"
	}
	_, lookErr := exec.LookPath(whisperBin)
	_, statErr := os.Stat(whisperBin)
	if lookErr != nil && statErr != nil {
		return nil, http.StatusServiceUnavailable, fmt.Errorf("Dịch vụ nhận diện giọng nói hiện đang bận hoặc không khả dụng. Vui lòng thử lại sau giây lát.")
	}

	tempFileName := fmt.Sprintf("%s_%s", randomID(), filename)
	tempFilePath := filepath.Join(s.downloadDir, tempFileName)

	destFile, err := os.Create(tempFilePath)
	if err != nil {
		return nil, http.StatusInternalServerError, fmt.Errorf("Không thể lưu file tải lên: %w", err)
	}
	_, _ = destFile.Write(fileBytes)
	destFile.Close()
	defer os.Remove(tempFilePath)

	s.mediaLimiter <- struct{}{}
	defer func() { <-s.mediaLimiter }()

	res, transErr := transcribe.TranscribeMedia(tempFilePath, language, format, task, s.downloadDir)
	if transErr != nil {
		return nil, http.StatusInternalServerError, fmt.Errorf("Nhận diện giọng nói thất bại: %w", transErr)
	}

	respJSON, _ := json.Marshal(map[string]interface{}{
		"success":  true,
		"text":     res.Text,
		"format":   format,
		"segments": res.Segments,
		"language": res.DetectedLanguage,
		"engine":   "native-whisper.cpp",
	})

	return respJSON, http.StatusOK, nil
}

// ── 2. TÁCH NỀN ẢNH (BIREFNET) ──

func (s *AIService) RemoveBackground(ctx context.Context, fileBytes []byte, filename, model, threshold, returnMask string) ([]byte, int, error) {
	var rmbgWorkers []string
	if s.workerRmbgURL != "" {
		rmbgWorkers = append(rmbgWorkers, s.workerRmbgURL)
	}
	if s.workerRmbgFallbackURL != "" && s.workerRmbgFallbackURL != s.workerRmbgURL {
		rmbgWorkers = append(rmbgWorkers, s.workerRmbgFallbackURL)
	}

	for idx, targetWorker := range rmbgWorkers {
		respBody, statusCode, callErr := s.workerClient.ForwardMultipartToWorker(
			ctx,
			targetWorker,
			"/api/remove-bg",
			fileBytes,
			filename,
			"file",
			map[string]string{
				"model":              model,
				"threshold":          threshold,
				"return_mask":        returnMask,
				"response_as_base64": "true",
			},
		)
		if callErr == nil && (statusCode == http.StatusOK || statusCode == http.StatusBadRequest) {
			return respBody, statusCode, nil
		}
		log.Printf("⚠️ [WORKER RMBG] Gọi worker (%s) thất bại (%v), statusCode=%d", targetWorker, callErr, statusCode)
		if idx < len(rmbgWorkers)-1 {
			log.Printf("🔄 [WORKER RMBG] Tự động chuyển sang worker dự phòng: %s", rmbgWorkers[idx+1])
		}
	}

	return nil, http.StatusServiceUnavailable, fmt.Errorf("Dịch vụ tách nền AI hiện không khả dụng. Vui lòng thử lại sau.")
}

// ── 3. PIXELFIXER & UPSCALER ──

func (s *AIService) ForwardToWorker(ctx context.Context, workerURL, path string, fileBytes []byte, filename string, fieldName string, formValues map[string]string) ([]byte, int, error) {
	return s.workerClient.ForwardMultipartToWorker(ctx, workerURL, path, fileBytes, filename, fieldName, formValues)
}

func (s *AIService) ForwardToWorkerLong(ctx context.Context, workerURL, path string, fileBytes []byte, filename string, fieldName string, formValues map[string]string) ([]byte, int, error) {
	return s.workerClient.ForwardMultipartToWorkerLong(ctx, workerURL, path, fileBytes, filename, fieldName, formValues)
}

func (s *AIService) CheckWorkerHealth(ctx context.Context, workerURL, path string) ([]byte, int, error) {
	return s.workerClient.CallWorkerJSON(ctx, workerURL, path, map[string]string{})
}

func (s *AIService) GetPixelfixerURL() string {
	return s.workerPixelfixerURL
}

func (s *AIService) GetUpscalerURL() string {
	return s.workerUpscalerURL
}
