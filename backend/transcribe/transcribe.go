package transcribe

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// TranscribeSegment represents a single timestamped subtitle chunk
type TranscribeSegment struct {
	ID         int     `json:"id"`
	Start      float64 `json:"start"`
	End        float64 `json:"end"`
	Text       string  `json:"text"`
	AvgLogprob float64 `json:"avg_logprob,omitempty"`
}

// TranscribeResult is the response format returned to Web UI & API
type TranscribeResult struct {
	Success             bool                `json:"success"`
	Text                string              `json:"text"`
	DetectedLanguage    string              `json:"detected_language"`
	LanguageProbability float64             `json:"language_probability"`
	AudioDuration       float64             `json:"audio_duration"`
	ProcessingTime      float64             `json:"processing_time"`
	Segments            []TranscribeSegment `json:"segments"`
	Filename            string              `json:"filename,omitempty"`
	FilePath            string              `json:"file_path,omitempty"`
	DownloadURL         string              `json:"download_url,omitempty"`
	ExportFormat        string              `json:"export_format,omitempty"`
	Error               string              `json:"error,omitempty"`
}

// PreprocessAudio applies FFmpeg Bandpass + Noise Reduction + Loudnorm and converts to 16kHz mono WAV
func PreprocessAudio(inputPath string) (string, bool, error) {
	if _, err := os.Stat(inputPath); err != nil {
		return inputPath, false, err
	}

	tempWav := filepath.Join(os.TempDir(), fmt.Sprintf("prep_%d_%s.wav", time.Now().UnixNano(), filepath.Base(inputPath)))
	audioFilter := "highpass=f=80,lowpass=f=8000,afftdn=nr=10:nf=-25,loudnorm=I=-16:TP=-1.5:LRA=11"

	cmd := exec.Command("ffmpeg", "-y", "-i", inputPath,
		"-vn", "-sn",
		"-af", audioFilter,
		"-ar", "16000",
		"-ac", "1",
		"-c:a", "pcm_s16le",
		tempWav,
	)

	if err := cmd.Run(); err == nil {
		if fi, statErr := os.Stat(tempWav); statErr == nil && fi.Size() > 100 {
			return tempWav, true, nil
		}
	}

	// Fallback to basic 16kHz mono if complex filter fails
	cmdFallback := exec.Command("ffmpeg", "-y", "-i", inputPath,
		"-vn", "-sn",
		"-ar", "16000",
		"-ac", "1",
		"-c:a", "pcm_s16le",
		tempWav,
	)
	if err := cmdFallback.Run(); err == nil {
		if fi, statErr := os.Stat(tempWav); statErr == nil && fi.Size() > 100 {
			return tempWav, true, nil
		}
	}

	return inputPath, false, nil
}

// FindWhisperModel locates the whisper.cpp GGML model file
func FindWhisperModel() string {
	modelEnv := os.Getenv("WHISPER_MODEL_PATH")
	if modelEnv != "" && fileExists(modelEnv) {
		return modelEnv
	}

	candidates := []string{
		"/app/models/whisper/ggml-base.bin",
		"/app/models/whisper/ggml-small.bin",
		"/app/models/ggml-base.bin",
		"models/whisper/ggml-base.bin",
		"models/ggml-base.bin",
		"/tmp/models/ggml-base.bin",
	}

	for _, c := range candidates {
		if fileExists(c) {
			return c
		}
	}

	return "/app/models/whisper/ggml-base.bin"
}

func fileExists(p string) bool {
	fi, err := os.Stat(p)
	return err == nil && !fi.IsDir() && fi.Size() > 0
}

// TranscribeMedia transcribes audio/video using whisper.cpp native engine in Go
func TranscribeMedia(inputPath, language, format, task, downloadDir string) (*TranscribeResult, error) {
	if _, err := os.Stat(inputPath); err != nil {
		return nil, fmt.Errorf("không tìm thấy file: %s", inputPath)
	}

	startTime := time.Now()

	// 1. Tiền xử lý âm thanh qua FFmpeg
	audioToProcess, isTemp, _ := PreprocessAudio(inputPath)
	if isTemp {
		defer os.Remove(audioToProcess)
	}

	// 2. Tìm binary whisper-cli và model
	whisperBin := os.Getenv("WHISPER_BIN")
	if whisperBin == "" {
		whisperBin = "/usr/local/bin/whisper-cli"
		if !fileExists(whisperBin) {
			whisperBin = "whisper-cli"
		}
	}

	modelPath := FindWhisperModel()

	baseName := strings.TrimSuffix(filepath.Base(inputPath), filepath.Ext(inputPath))
	outFormat := strings.ToLower(strings.TrimPrefix(format, "."))
	if outFormat == "" {
		outFormat = "txt"
	}

	outPrefix := filepath.Join(downloadDir, fmt.Sprintf("%s_transcript", baseName))

	// 3. Chuẩn bị tham số gọi whisper.cpp
	args := []string{
		"-m", modelPath,
		"-f", audioToProcess,
		"-t", "4",
		"--output-file", outPrefix,
		"--output-txt",
		"--output-srt",
		"--output-vtt",
		"--output-json",
	}

	lang := strings.TrimSpace(strings.ToLower(language))
	if lang != "" && lang != "auto" {
		args = append(args, "-l", lang)
	} else {
		args = append(args, "-l", "auto")
	}

	if task == "translate" {
		args = append(args, "--translate")
	}

	// 4. Chạy whisper-cli
	cmd := exec.Command(whisperBin, args...)
	outputBytes, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("whisper-cli thất bại (%v): %s", err, string(outputBytes))
	}

	processingDuration := time.Since(startTime).Seconds()

	// 5. Đọc file kết quả JSON do whisper.cpp sinh ra
	jsonFilePath := outPrefix + ".json"
	txtFilePath := outPrefix + ".txt"
	srtFilePath := outPrefix + ".srt"
	vttFilePath := outPrefix + ".vtt"

	var segments []TranscribeSegment
	var fullText string
	var detectedLang string = "vi"

	if fileExists(jsonFilePath) {
		rawJSON, readErr := os.ReadFile(jsonFilePath)
		if readErr == nil {
			var wData struct {
				Systeminfo string `json:"systeminfo"`
				Model      struct {
					Type     string `json:"type"`
					Multilin bool   `json:"multilingual"`
				} `json:"model"`
				Result struct {
					Language string `json:"language"`
				} `json:"result"`
				Transcription []struct {
					Timestamps struct {
						From string `json:"from"`
						To   string `json:"to"`
					} `json:"timestamps"`
					Offsets struct {
						From int64 `json:"from"`
						To   int64 `json:"to"`
					} `json:"offsets"`
					Text string `json:"text"`
				} `json:"transcription"`
			}

			if unmarshalErr := json.Unmarshal(rawJSON, &wData); unmarshalErr == nil {
				if wData.Result.Language != "" {
					detectedLang = wData.Result.Language
				}
				var textParts []string
				for idx, item := range wData.Transcription {
					t := strings.TrimSpace(item.Text)
					if t != "" {
						textParts = append(textParts, t)
						startSec := float64(item.Offsets.From) / 1000.0
						endSec := float64(item.Offsets.To) / 1000.0
						segments = append(segments, TranscribeSegment{
							ID:    idx + 1,
							Start: startSec,
							End:   endSec,
							Text:  t,
						})
					}
				}
				fullText = strings.Join(textParts, " ")
			}
		}
	}

	if fullText == "" && fileExists(txtFilePath) {
		rawTxt, _ := os.ReadFile(txtFilePath)
		fullText = strings.TrimSpace(string(rawTxt))
	}

	targetFilename := fmt.Sprintf("%s_transcript.%s", baseName, outFormat)
	targetFilePath := filepath.Join(downloadDir, targetFilename)

	// Đảm bảo file định dạng mong muốn tồn tại
	switch outFormat {
	case "srt":
		if fileExists(srtFilePath) && srtFilePath != targetFilePath {
			_ = os.Rename(srtFilePath, targetFilePath)
		}
	case "vtt":
		if fileExists(vttFilePath) && vttFilePath != targetFilePath {
			_ = os.Rename(vttFilePath, targetFilePath)
		}
	case "json":
		if fileExists(jsonFilePath) && jsonFilePath != targetFilePath {
			_ = os.Rename(jsonFilePath, targetFilePath)
		}
	default: // txt
		if fileExists(txtFilePath) && txtFilePath != targetFilePath {
			_ = os.Rename(txtFilePath, targetFilePath)
		}
	}

	realAudioDur := getMediaDuration(inputPath)
	if realAudioDur == 0 && len(segments) > 0 {
		realAudioDur = mathRound(segments[len(segments)-1].End, 2)
	}

	return &TranscribeResult{
		Success:             true,
		Text:                fullText,
		DetectedLanguage:    detectedLang,
		LanguageProbability: 0.95,
		AudioDuration:       realAudioDur,
		ProcessingTime:      mathRound(processingDuration, 2),
		Segments:            segments,
		Filename:            targetFilename,
		FilePath:            targetFilePath,
		DownloadURL:         fmt.Sprintf("/api/file/%s", targetFilename),
		ExportFormat:        outFormat,
	}, nil
}

func getMediaDuration(filePath string) float64 {
	cmd := exec.Command("ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath)
	out, err := cmd.Output()
	if err == nil {
		durStr := strings.TrimSpace(string(out))
		if d, parseErr := strconv.ParseFloat(durStr, 64); parseErr == nil && d > 0 {
			return mathRound(d, 2)
		}
	}
	return 0.0
}

func mathRound(val float64, precision int) float64 {
	p := 1.0
	for i := 0; i < precision; i++ {
		p *= 10.0
	}
	return float64(int(val*p+0.5)) / p
}
