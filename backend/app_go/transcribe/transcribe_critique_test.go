package transcribe

import (
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// =============================================================================
// BỘ KIỂM THỬ XÁC MINH 13 NHẬN XÉT CỦA USER VỀ CODE transcribe.go
// =============================================================================

// 1. Kiểm tra cờ --flash-attn có bị hardcode không
func TestCritique01_FlashAttentionFlagHardcoded(t *testing.T) {
	// Đọc trực tiếp source code transcribe.go để kiểm tra cấu hình args
	code, err := os.ReadFile("transcribe.go")
	if err != nil {
		t.Fatalf("Không thể đọc transcribe.go: %v", err)
	}
	codeStr := string(code)

	hasFlashAttn := strings.Contains(codeStr, `"--flash-attn"`)
	hasCheck := strings.Contains(codeStr, "supportsFlashAttn") || strings.Contains(codeStr, "hasFlashAttn")

	if hasFlashAttn && !hasCheck {
		t.Logf("👉 [XÁC NHẬN ĐÚNG] Flag '--flash-attn' bị hardcode cố định mà không kiểm tra binary whisper-cli có hỗ trợ không.")
	} else {
		t.Errorf("Kỳ vọng cờ flash-attn có kiểm tra điều kiện nhưng không tìm thấy")
	}
}

// 2. Kiểm tra giới hạn threads <= 8 có bị hardcode không
func TestCritique02_ThreadCapping(t *testing.T) {
	code, err := os.ReadFile("transcribe.go")
	if err != nil {
		t.Fatalf("Không thể đọc transcribe.go: %v", err)
	}
	codeStr := string(code)

	hasHardcoded8 := strings.Contains(codeStr, "threads > 8") && strings.Contains(codeStr, "threads = 8")
	hasEnvOverride := strings.Contains(codeStr, "WHISPER_THREADS")

	if hasHardcoded8 && !hasEnvOverride {
		t.Logf("👉 [XÁC NHẬN ĐÚNG] Số luồng bị khóa cứng <= 8 (threads = 8), không cho phép cấu hình qua env WHISPER_THREADS.")
	} else {
		t.Errorf("Threads không bị khóa cứng ở 8")
	}
}

// 3. Kiểm tra PreprocessAudio nuốt lỗi
func TestCritique03_PreprocessErrorSwallowed(t *testing.T) {
	// Kiểm tra ở hàm gọi TranscribeMedia (dòng 141)
	code, err := os.ReadFile("transcribe.go")
	if err != nil {
		t.Fatalf("Không thể đọc transcribe.go: %v", err)
	}
	codeStr := string(code)

	hasDiscard := strings.Contains(codeStr, "audioToProcess, isTemp, _ := PreprocessAudio")
	
	// Thử gọi PreprocessAudio với file không phải audio (ví dụ file rác)
	dummyFile := filepath.Join(t.TempDir(), "corrupt.mp3")
	_ = os.WriteFile(dummyFile, []byte("NOT_A_REAL_AUDIO_FILE_DATA_12345"), 0644)

	outPath, isTemp, prepErr := PreprocessAudio(dummyFile)

	// Khi FFmpeg thất bại ở cả 2 lần, hàm trả về: return inputPath, false, nil (prepErr là nil!)
	if hasDiscard && prepErr == nil && !isTemp && outPath == dummyFile {
		t.Logf("👉 [XÁC NHẬN ĐÚNG] PreprocessAudio nuốt sạch lỗi FFmpeg: caller bỏ qua '_' và hàm trả về prepErr=nil khi FFmpeg thất bại.")
	} else {
		t.Errorf("PreprocessAudio có trả về lỗi hoặc caller có kiểm tra lỗi")
	}
}

// 4. Kiểm tra PreprocessAudio có thể để lại file tạm rác khi thất bại
func TestCritique04_OrphanedTempWavOnFailure(t *testing.T) {
	code, err := os.ReadFile("transcribe.go")
	if err != nil {
		t.Fatalf("Không thể đọc transcribe.go: %v", err)
	}
	codeStr := string(code)

	// tempWav được tạo bằng os.TempDir() nhưng không có defer os.Remove trong nhánh thất bại
	hasDeferCleanupInPrep := strings.Contains(codeStr, "defer os.Remove(tempWav)")

	if !hasDeferCleanupInPrep {
		t.Logf("👉 [XÁC NHẬN ĐÚNG] PreprocessAudio không có cơ chế dọn dẹp file tempWav nếu lệnh ffmpeg chạy dở hoặc lỗi giữa chừng.")
	} else {
		t.Errorf("PreprocessAudio có defer dọn dẹp tempWav")
	}
}

// 5 & 6. Kiểm tra filter loudnorm và afftdn=nr=10
func TestCritique05_06_AudioFilterComplexity(t *testing.T) {
	code, err := os.ReadFile("transcribe.go")
	if err != nil {
		t.Fatalf("Không thể đọc transcribe.go: %v", err)
	}
	codeStr := string(code)

	hasLoudnorm := strings.Contains(codeStr, "loudnorm=")
	hasAfftdn10 := strings.Contains(codeStr, "afftdn=nr=10")

	if hasLoudnorm && hasAfftdn10 {
		t.Logf("👉 [XÁC NHẬN ĐÚNG] Filter âm thanh đang dùng: loudnorm (nặng CPU) và afftdn=nr=10 (khử ồn mạnh 10dB có thể làm xén phụ âm cao).")
	} else {
		t.Errorf("Không tìm thấy loudnorm hoặc afftdn=nr=10")
	}
}

// 7. Kiểm tra getMediaDuration gọi FFprobe trước FFmpeg (2 lần spawn process)
func TestCritique07_DoubleProcessStartup(t *testing.T) {
	code, err := os.ReadFile("transcribe.go")
	if err != nil {
		t.Fatalf("Không thể đọc transcribe.go: %v", err)
	}
	codeStr := string(code)

	callsProbe := strings.Contains(codeStr, "realAudioDur := getMediaDuration(inputPath)")
	callsPrep := strings.Contains(codeStr, "PreprocessAudio(inputPath)")

	if callsProbe && callsPrep {
		t.Logf("👉 [XÁC NHẬN ĐÚNG] TranscribeMedia spawn ffprobe để lấy thời lượng, ngay sau đó lại spawn ffmpeg để preprocess -> tốn 2 lần fork process.")
	} else {
		t.Errorf("Không gọi getMediaDuration hoặc PreprocessAudio")
	}
}

// 8. Kiểm tra JSON parsing bỏ sót token-level / logprob
func TestCritique08_JSONTimestampTokenParsing(t *testing.T) {
	code, err := os.ReadFile("transcribe.go")
	if err != nil {
		t.Fatalf("Không thể đọc transcribe.go: %v", err)
	}
	codeStr := string(code)

	// struct TranscribeSegment có AvgLogprob
	hasAvgLogprobInStruct := strings.Contains(codeStr, "AvgLogprob float64")
	// Nhưng trong JSON unmarshal (dòng 233-244) không unmarshal avg_logprob hay tokens
	unmarshalsLogprob := strings.Contains(codeStr, "`json:\"avg_logprob\"`") || strings.Contains(codeStr, "AvgLogprob: ")

	if hasAvgLogprobInStruct && !unmarshalsLogprob {
		t.Logf("👉 [XÁC NHẬN ĐÚNG] Struct TranscribeSegment định nghĩa AvgLogprob nhưng parser JSON whisper không bóc tách trường này.")
	} else {
		t.Errorf("Parser JSON có unmarshal avg_logprob")
	}
}

// 9. Kiểm tra mathRound bị sai với số âm
func TestCritique09_MathRoundNegativeBug(t *testing.T) {
	// Thử các số âm với mathRound hiện tại
	testCases := []struct {
		val       float64
		precision int
		expected  float64
	}{
		{-1.6, 1, -1.6},
		{-1.2, 0, -1.0},
		{-2.55, 1, -2.6}, // hoặc -2.5
	}

	bugDetected := false
	for _, tc := range testCases {
		got := mathRound(tc.val, tc.precision)
		// math.Round chuẩn
		p := math.Pow(10, float64(tc.precision))
		correct := math.Round(tc.val*p) / p

		if got != correct {
			t.Logf("   [LỖI MATH.ROUND] mathRound(%.2f, %d) = %.2f (Kỳ vọng chuẩn math.Round: %.2f)", tc.val, tc.precision, got, correct)
			bugDetected = true
		}
	}

	if bugDetected {
		t.Logf("👉 [XÁC NHẬN ĐÚNG] Thuật toán int(val*p+0.5)/p bị sai nghiêm trọng với số âm do int() cắt cụt về 0 thay vì làm tròn xuống!")
	} else {
		t.Errorf("mathRound không phát hiện lỗi số âm")
	}
}

// 10. Kiểm tra parseSRTFile nối các dòng subtitle bằng dấu cách " " làm mất xuống dòng
func TestCritique10_ParseSRTNewlineFlattening(t *testing.T) {
	srtContent := `1
00:00:01,000 --> 00:00:03,000
- Bạn có khỏe không?
- Cảm ơn, tôi khỏe.
`
	tmpSRT := filepath.Join(t.TempDir(), "test.srt")
	_ = os.WriteFile(tmpSRT, []byte(srtContent), 0644)

	segs := parseSRTFile(tmpSRT)
	if len(segs) != 1 {
		t.Fatalf("Kỳ vọng 1 segment, nhận %d", len(segs))
	}

	if strings.Contains(segs[0].Text, "\n") {
		t.Errorf("Không bị mất xuống dòng")
	} else if segs[0].Text == "- Bạn có khỏe không? - Cảm ơn, tôi khỏe." {
		t.Logf("👉 [XÁC NHẬN ĐÚNG] parseSRTFile nối các dòng bằng dấu cách: '%s' -> Mất ký tự xuống dòng phân tách người nói.", segs[0].Text)
	}
}

// 11. Kiểm tra Race Condition / Filename Collision khi 2 request cùng basename
func TestCritique11_FilenameCollisionRaceCondition(t *testing.T) {
	code, err := os.ReadFile("transcribe.go")
	if err != nil {
		t.Fatalf("Không thể đọc transcribe.go: %v", err)
	}
	codeStr := string(code)

	// TranscribeMedia lấy baseName từ inputPath và lưu output file
	// baseName := strings.TrimSuffix(filepath.Base(inputPath), filepath.Ext(inputPath))
	// outPrefix := filepath.Join(downloadDir, fmt.Sprintf("%s_transcript", baseName))
	// targetFilename := fmt.Sprintf("%s_transcript.%s", baseName, outFormat)

	hasBaseNameOnly := strings.Contains(codeStr, `fmt.Sprintf("%s_transcript", baseName)`)
	hasRandomID := strings.Contains(codeStr, `fmt.Sprintf("%s_%s_transcript"`) || strings.Contains(codeStr, `randomID()`)

	if hasBaseNameOnly && !hasRandomID {
		t.Logf("👉 [XÁC NHẬN ĐÚNG] TranscribeMedia đặt tên output theo baseName: '%s_transcript.txt'. Nếu 2 user cùng upload video.mp4 sẽ ghi đè đè lẫn nhau!", "%s")
	} else {
		t.Errorf("TranscribeMedia có sinh id ngẫu nhiên cho output filename")
	}
}

// 12. Kiểm tra downloadDir không được đảm bảo tồn tại
func TestCritique12_DownloadDirNotGuaranteed(t *testing.T) {
	code, err := os.ReadFile("transcribe.go")
	if err != nil {
		t.Fatalf("Không thể đọc transcribe.go: %v", err)
	}
	codeStr := string(code)

	hasMkdirDownloadDir := strings.Contains(codeStr, "os.MkdirAll(downloadDir")

	if !hasMkdirDownloadDir {
		t.Logf("👉 [XÁC NHẬN ĐÚNG] TranscribeMedia không gọi os.MkdirAll(downloadDir, 0755), nếu thư mục chưa tồn tại whisper-cli hoặc os.Rename sẽ văng lỗi.")
	} else {
		t.Errorf("Có os.MkdirAll cho downloadDir trong transcribe.go")
	}
}

// 13. Kiểm tra Concurrency Oversubscription (không có giới hạn đồng thời bên trong package transcribe)
func TestCritique13_ConcurrencyOversubscription(t *testing.T) {
	code, err := os.ReadFile("transcribe.go")
	if err != nil {
		t.Fatalf("Không thể đọc transcribe.go: %v", err)
	}
	codeStr := string(code)

	hasSemaphore := strings.Contains(codeStr, "semaphore") || strings.Contains(codeStr, "chan struct{}") || strings.Contains(codeStr, "sync.WaitGroup")

	if !hasSemaphore {
		t.Logf("👉 [XÁC NHẬN ĐÚNG] Package transcribe hoàn toàn không có Semaphore/Queue giới hạn concurrency. Nếu 10 luồng gọi TranscribeMedia cùng lúc sẽ spawn 80 threads CPU!")
	} else {
		t.Errorf("Package transcribe có semaphore giới hạn concurrency")
	}
}
