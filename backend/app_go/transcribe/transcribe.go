package transcribe

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
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
	ModelUsed           string              `json:"model_used"`
	Segments            []TranscribeSegment `json:"segments"`
	Filename            string              `json:"filename,omitempty"`
	FilePath            string              `json:"file_path,omitempty"`
	DownloadURL         string              `json:"download_url,omitempty"`
	ExportFormat        string              `json:"export_format,omitempty"`
	Error               string              `json:"error,omitempty"`
}

// Global semaphore để kiểm soát concurrency, tránh oversubscription CPU (Issue 13)
var (
	transcribeSem     chan struct{}
	transcribeSemOnce sync.Once
)

func getTranscribeSemaphore() chan struct{} {
	transcribeSemOnce.Do(func() {
		maxConcurrency := 2
		if envMax := os.Getenv("MAX_WHISPER_CONCURRENT_JOBS"); envMax != "" {
			if c, err := strconv.Atoi(envMax); err == nil && c > 0 {
				maxConcurrency = c
			}
		}
		transcribeSem = make(chan struct{}, maxConcurrency)
	})
	return transcribeSem
}

// Cache kiểm tra whisper-cli có hỗ trợ --flash-attn hay không (Issue 1)
var (
	flashAttnSupportedMap = make(map[string]bool)
	flashAttnLock         sync.Mutex
)

func supportsFlashAttn(whisperBin string) bool {
	flashAttnLock.Lock()
	defer flashAttnLock.Unlock()
	if val, exists := flashAttnSupportedMap[whisperBin]; exists {
		return val
	}
	cmd := exec.Command(whisperBin, "--help")
	out, _ := cmd.CombinedOutput()
	outStr := string(out)
	supported := strings.Contains(outStr, "--flash-attn") || strings.Contains(outStr, "-fa")
	flashAttnSupportedMap[whisperBin] = supported
	return supported
}

func randomID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// PreprocessAudio applies FFmpeg Bandpass + Balanced Noise Reduction + Fast Speech Normalization and converts to 16kHz mono WAV
// Giải quyết Issue 3 (không nuốt lỗi), Issue 4 (dọn dẹp tempWav khi lỗi), Issue 5 (thay loudnorm nặng CPU), Issue 6 (giảm afftdn nr=6)
func PreprocessAudio(inputPath string) (string, bool, error) {
	if _, err := os.Stat(inputPath); err != nil {
		return inputPath, false, err
	}

	tempWav := filepath.Join(os.TempDir(), fmt.Sprintf("prep_%s_%s.wav", randomID(), filepath.Base(inputPath)))

	// Issue 5 & 6: Dùng speechnorm nhẹ nhàng thay vì loudnorm 2-pass nặng; hạ afftdn xuống nr=6 để bảo toàn phụ âm /s/, /t/, /f/
	audioFilter := "highpass=f=80,lowpass=f=8000,afftdn=nr=6:nf=-30,speechnorm=e=4:r=0.0001:l=1"
	if customFilter := os.Getenv("WHISPER_AUDIO_FILTER"); customFilter != "" {
		audioFilter = customFilter
	}

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

	// Fallback sang bộ lọc cơ bản 16kHz mono nếu bộ lọc âm phức tạp lỗi
	cmdFallback := exec.Command("ffmpeg", "-y", "-i", inputPath,
		"-vn", "-sn",
		"-ar", "16000",
		"-ac", "1",
		"-c:a", "pcm_s16le",
		tempWav,
	)
	if errFallback := cmdFallback.Run(); errFallback == nil {
		if fi, statErr := os.Stat(tempWav); statErr == nil && fi.Size() > 100 {
			return tempWav, true, nil
		}
	} else {
		// Issue 4: Thu dọn file rác tempWav nếu cả 2 lần đều lỗi
		_ = os.Remove(tempWav)
		// Issue 3: Trả về lỗi chi tiết từ FFmpeg thay vì nuốt lỗi
		return inputPath, false, fmt.Errorf("ffmpeg preprocessing thất bại: %w", errFallback)
	}

	_ = os.Remove(tempWav)
	return inputPath, false, fmt.Errorf("ffmpeg preprocessing không tạo được dữ liệu âm thanh hợp lệ")
}

// FindWhisperModel locates the whisper.cpp GGML model file
func FindWhisperModel() string {
	modelEnv := os.Getenv("WHISPER_MODEL_PATH")
	if modelEnv != "" && fileExists(modelEnv) {
		return modelEnv
	}

	candidates := []string{
		"/app/models/whisper/ggml-small.bin",
		"/app/models/whisper/ggml-base.bin",
		"models/whisper/ggml-small.bin",
		"models/whisper/ggml-base.bin",
		"/tmp/models/ggml-small.bin",
		"/tmp/models/ggml-base.bin",
	}

	for _, c := range candidates {
		if fileExists(c) {
			return c
		}
	}

	return "/app/models/whisper/ggml-small.bin"
}

func fileExists(p string) bool {
	fi, err := os.Stat(p)
	return err == nil && !fi.IsDir() && fi.Size() > 0
}

// MaxTranscribeDurationSeconds giới hạn thời lượng tối đa cho phép là 10 phút (600 giây)
const MaxTranscribeDurationSeconds = 600.0

// TranscribeMedia transcribes audio/video using whisper.cpp native engine in Go
func TranscribeMedia(inputPath, language, format, task, downloadDir string) (*TranscribeResult, error) {
	if _, err := os.Stat(inputPath); err != nil {
		return nil, fmt.Errorf("không tìm thấy file: %s", inputPath)
	}

	// Issue 12: Đảm bảo thư mục downloadDir tồn tại trước khi xử lý
	if err := os.MkdirAll(downloadDir, 0755); err != nil {
		return nil, fmt.Errorf("không thể khởi tạo thư mục lưu kết quả (%s): %w", downloadDir, err)
	}

	// Issue 13: Giới hạn số lượng job AI whisper chạy song song tránh oversubscription
	sem := getTranscribeSemaphore()
	sem <- struct{}{}
	defer func() { <-sem }()

	// Kiểm tra thời lượng file trước khi xử lý AI
	realAudioDur := getMediaDuration(inputPath)
	if realAudioDur > MaxTranscribeDurationSeconds {
		mins := int(realAudioDur / 60.0)
		secs := int(math.Mod(realAudioDur, 60.0))
		var durStr string
		if mins > 0 {
			durStr = fmt.Sprintf("%d phút %02d giây", mins, secs)
		} else {
			durStr = fmt.Sprintf("%.0f giây", realAudioDur)
		}
		return nil, fmt.Errorf("Thời lượng file (%s) vượt quá giới hạn tối đa cho phép là 10 phút. Vui lòng chọn file ngắn hơn.", durStr)
	}

	startTime := time.Now()

	// Issue 3: Bắt lỗi tiền xử lý âm thanh rõ ràng thay vì bỏ qua '_'
	audioToProcess, isTemp, prepErr := PreprocessAudio(inputPath)
	if prepErr != nil {
		log.Printf("⚠️ [WHISPER PREPROCESS] Tiền xử lý thất bại (%v), tiếp tục dùng file đầu vào gốc...", prepErr)
	}
	if isTemp {
		defer os.Remove(audioToProcess)
	}

	// Tìm binary whisper-cli và model
	whisperBin := os.Getenv("WHISPER_BIN")
	if whisperBin == "" {
		whisperBin = "/usr/local/bin/whisper-cli"
		if !fileExists(whisperBin) {
			whisperBin = "whisper-cli"
		}
	}

	modelPath := FindWhisperModel()
	log.Printf("🎙️ [WHISPER TRANSCRIBE] Processing %s (%.2fs) using model: %s", inputPath, realAudioDur, modelPath)

	baseName := strings.TrimSuffix(filepath.Base(inputPath), filepath.Ext(inputPath))
	outFormat := strings.ToLower(strings.TrimPrefix(format, "."))
	if outFormat == "" {
		outFormat = "txt"
	}

	// Issue 11: Thêm random ID để tránh Race Condition / Filename Collision khi nhiều user tải lên file cùng tên
	uniqueTaskID := randomID()
	outPrefix := filepath.Join(downloadDir, fmt.Sprintf("%s_%s_transcript", uniqueTaskID, baseName))

	// Issue 2: Linh hoạt số luồng CPU qua WHISPER_THREADS, mặc định mở rộng lên tới 12 threads
	threads := runtime.NumCPU()
	if envT := os.Getenv("WHISPER_THREADS"); envT != "" {
		if t, err := strconv.Atoi(envT); err == nil && t > 0 {
			threads = t
		}
	} else if threads > 12 {
		threads = 12
	} else if threads < 2 {
		threads = 2
	}

	// Chuẩn bị tham số gọi whisper.cpp tối ưu
	args := []string{
		"-m", modelPath,
		"-f", audioToProcess,
		"-t", strconv.Itoa(threads),
		"--beam-size", "2",
		"--temperature", "0.0",
		"--no-fallback",
		"--max-len", "60",
		"--output-file", outPrefix,
		"--output-txt",
		"--output-srt",
		"--output-vtt",
		"--output-json",
	}

	// Issue 1: Chỉ thêm --flash-attn nếu whisper.cpp thực sự hỗ trợ
	if supportsFlashAttn(whisperBin) {
		args = append(args, "--flash-attn")
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

	// Chạy whisper-cli
	cmd := exec.Command(whisperBin, args...)
	outputBytes, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("whisper-cli thất bại (%v): %s", err, string(outputBytes))
	}

	processingDuration := time.Since(startTime).Seconds()

	// Đọc file kết quả JSON do whisper.cpp sinh ra
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
					Text       string  `json:"text"`
					AvgLogprob float64 `json:"avg_logprob"`
					Logprob    float64 `json:"logprob"`
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

						// Issue 8: Bóc tách AvgLogprob từ JSON transcription
						logprob := item.AvgLogprob
						if logprob == 0 && item.Logprob != 0 {
							logprob = item.Logprob
						}

						segments = append(segments, TranscribeSegment{
							ID:         idx + 1,
							Start:      mathRound(startSec, 3),
							End:        mathRound(endSec, 3),
							Text:       t,
							AvgLogprob: mathRound(logprob, 3),
						})
					}
				}
				fullText = strings.Join(textParts, " ")
			}
		}
	}

	if len(segments) == 0 && fileExists(srtFilePath) {
		segments = parseSRTFile(srtFilePath)
	}

	if fullText == "" {
		if len(segments) > 0 {
			var textParts []string
			for _, s := range segments {
				textParts = append(textParts, s.Text)
			}
			fullText = strings.Join(textParts, " ")
		} else if fileExists(txtFilePath) {
			rawTxt, _ := os.ReadFile(txtFilePath)
			fullText = strings.TrimSpace(string(rawTxt))
		}
	}

	// Target filename với uniqueTaskID chống race condition
	targetFilename := fmt.Sprintf("%s_%s_transcript.%s", uniqueTaskID, baseName, outFormat)
	targetFilePath := filepath.Join(downloadDir, targetFilename)

	// Đảm bảo file định dạng mong muốn tồn tại và xóa các file tạm thừa
	switch outFormat {
	case "srt":
		if fileExists(srtFilePath) && srtFilePath != targetFilePath {
			_ = os.Rename(srtFilePath, targetFilePath)
		}
		_ = os.Remove(txtFilePath)
		_ = os.Remove(vttFilePath)
		_ = os.Remove(jsonFilePath)
	case "vtt":
		if fileExists(vttFilePath) && vttFilePath != targetFilePath {
			_ = os.Rename(vttFilePath, targetFilePath)
		}
		_ = os.Remove(txtFilePath)
		_ = os.Remove(srtFilePath)
		_ = os.Remove(jsonFilePath)
	case "json":
		if fileExists(jsonFilePath) && jsonFilePath != targetFilePath {
			_ = os.Rename(jsonFilePath, targetFilePath)
		}
		_ = os.Remove(txtFilePath)
		_ = os.Remove(srtFilePath)
		_ = os.Remove(vttFilePath)
	default: // txt
		if fileExists(txtFilePath) && txtFilePath != targetFilePath {
			_ = os.Rename(txtFilePath, targetFilePath)
		}
		_ = os.Remove(srtFilePath)
		_ = os.Remove(vttFilePath)
		_ = os.Remove(jsonFilePath)
	}

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
		ModelUsed:           filepath.Base(modelPath),
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

// Issue 9: Dùng chuẩn math.Round thay vì int(val*p+0.5) để xử lý chính xác tuyệt đối số âm và edge cases
func mathRound(val float64, precision int) float64 {
	p := math.Pow(10, float64(precision))
	return math.Round(val*p) / p
}

// Issue 10: Giữ nguyên ký tự xuống dòng '\n' khi nối nhiều dòng trong cùng một segment SRT thay vì xóa thành dấu cách ' '
func parseSRTFile(srtPath string) []TranscribeSegment {
	content, err := os.ReadFile(srtPath)
	if err != nil {
		return nil
	}
	lines := strings.Split(string(content), "\n")
	var segments []TranscribeSegment
	var currentSeg *TranscribeSegment

	timeRegex := regexp.MustCompile(`(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})`)

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			if currentSeg != nil && currentSeg.Text != "" {
				segments = append(segments, *currentSeg)
				currentSeg = nil
			}
			continue
		}

		matches := timeRegex.FindStringSubmatch(line)
		if len(matches) == 9 {
			h1, _ := strconv.ParseFloat(matches[1], 64)
			m1, _ := strconv.ParseFloat(matches[2], 64)
			s1, _ := strconv.ParseFloat(matches[3], 64)
			ms1, _ := strconv.ParseFloat(matches[4], 64)
			start := h1*3600 + m1*60 + s1 + ms1/1000.0

			h2, _ := strconv.ParseFloat(matches[5], 64)
			m2, _ := strconv.ParseFloat(matches[6], 64)
			s2, _ := strconv.ParseFloat(matches[7], 64)
			ms2, _ := strconv.ParseFloat(matches[8], 64)
			end := h2*3600 + m2*60 + s2 + ms2/1000.0

			currentSeg = &TranscribeSegment{
				ID:    len(segments) + 1,
				Start: mathRound(start, 2),
				End:   mathRound(end, 2),
				Text:  "",
			}
			continue
		}

		if _, numErr := strconv.Atoi(line); numErr == nil && currentSeg == nil {
			continue
		}

		if currentSeg != nil {
			if currentSeg.Text == "" {
				currentSeg.Text = line
			} else {
				currentSeg.Text += "\n" + line
			}
		}
	}

	if currentSeg != nil && currentSeg.Text != "" {
		segments = append(segments, *currentSeg)
	}

	return segments
}
