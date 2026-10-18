package service_test

import (
	"strings"
	"testing"

	"omniverse_backend/internal/service"
)

// =============================================================================
// KIỂM THỬ: FormatBytes Helper
// =============================================================================

func TestFormatBytes(t *testing.T) {
	tests := []struct {
		input    int64
		expected string
	}{
		{0, "0 B"},
		{512, "512 B"},
		{1024, "1.0 KB"},
		{1536, "1.5 KB"},
		{1048576, "1.0 MB"},
		{1073741824, "1.0 GB"},
	}

	for _, tc := range tests {
		result := service.FormatBytes(tc.input)
		if result != tc.expected {
			t.Errorf("FormatBytes(%d) = %s; mong đợi %s", tc.input, result, tc.expected)
		}
	}
}

// =============================================================================
// KIỂM THỬ: ValidateFileMagicBytes (B-33 -> B-44, B-90 -> B-94)
// =============================================================================

func TestValidateFileMagicBytes(t *testing.T) {
	svc := service.NewConvertService(nil, "", "", nil)

	t.Run("TC B-33: File rỗng 0 bytes", func(t *testing.T) {
		err := svc.ValidateFileMagicBytes(".pdf", []byte{})
		if err == nil || !strings.Contains(err.Error(), "0 bytes") {
			t.Fatalf("Mong đợi lỗi '0 bytes', nhận được: %v", err)
		}
	})

	t.Run("TC B-34: PDF hợp lệ với chữ ký %PDF-", func(t *testing.T) {
		validPdfHeader := []byte("%PDF-1.7\n%...")
		err := svc.ValidateFileMagicBytes(".pdf", validPdfHeader)
		if err != nil {
			t.Fatalf("File PDF chuẩn không nên báo lỗi: %v", err)
		}
	})

	t.Run("TC B-35: Giả mạo PDF - Đổi đuôi file văn bản thành .pdf", func(t *testing.T) {
		fakePdfHeader := []byte("Day la mot file van ban lua dao...")
		err := svc.ValidateFileMagicBytes(".pdf", fakePdfHeader)
		if err == nil || !strings.Contains(err.Error(), "thiếu header %PDF-") {
			t.Fatalf("Phải phát hiện và chặn file PDF giả mạo: %v", err)
		}
	})

	t.Run("TC B-36: Chặn tấn công Polyglot PDF (lồng ghép script/HTML)", func(t *testing.T) {
		maliciousHeaders := [][]byte{
			[]byte("<script>%PDF-1.4 evil code</script>"),
			[]byte("<html>%PDF-1.4 <body>evil</body></html>"),
			[]byte("<?xml version='1.0'?>%PDF-1.4"),
			[]byte("<svg>%PDF-1.4</svg>"),
			[]byte("MZ%PDF-1.4 fake exe"),
			[]byte("\x7fELF%PDF-1.4 fake linux binary"),
			[]byte("#!/bin/bash\n%PDF-1.4"),
		}

		for _, header := range maliciousHeaders {
			err := svc.ValidateFileMagicBytes(".pdf", header)
			if err == nil || !strings.Contains(err.Error(), "polyglot nguy hiểm") {
				t.Errorf("Phải chặn file polyglot header: %s, kết quả: %v", string(header), err)
			}
		}
	})

	t.Run("TC B-37: Tài liệu Office hiện đại (DOCX, XLSX, PPTX) với chữ ký ZIP (PK)", func(t *testing.T) {
		validZipHeader := []byte{0x50, 0x4B, 0x03, 0x04, 0x14, 0x00}
		exts := []string{".docx", ".xlsx", ".pptx", ".odt", ".ods", ".odp"}

		for _, ext := range exts {
			err := svc.ValidateFileMagicBytes(ext, validZipHeader)
			if err != nil {
				t.Errorf("File %s hợp lệ nhưng bị báo lỗi: %v", ext, err)
			}
		}
	})

	t.Run("TC B-38: File Office hiện đại nhưng thiếu chữ ký ZIP PK", func(t *testing.T) {
		corruptedHeader := []byte("INVALID_OFFICE_HEADER")
		err := svc.ValidateFileMagicBytes(".docx", corruptedHeader)
		if err == nil || !strings.Contains(err.Error(), "thiếu chữ ký ZIP container") {
			t.Fatalf("Phải chặn file DOCX không có chữ ký PK: %v", err)
		}
	})

	t.Run("TC B-39: Tài liệu Office cổ điển (DOC, XLS, PPT) với chữ ký OLE2", func(t *testing.T) {
		oleMagic := []byte{0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1}
		exts := []string{".doc", ".xls", ".ppt"}

		for _, ext := range exts {
			err := svc.ValidateFileMagicBytes(ext, oleMagic)
			if err != nil {
				t.Errorf("File %s hợp lệ nhưng bị báo lỗi: %v", ext, err)
			}
		}
	})

	t.Run("TC B-40: Tài liệu Office cổ điển sai chữ ký OLE2", func(t *testing.T) {
		badOle := []byte{0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00}
		err := svc.ValidateFileMagicBytes(".doc", badOle)
		if err == nil || !strings.Contains(err.Error(), "thiếu chữ ký OLE2") {
			t.Fatalf("Phải chặn file DOC sai header OLE2: %v", err)
		}
	})

	t.Run("TC B-41: Tài liệu RTF hợp lệ và không hợp lệ", func(t *testing.T) {
		validRtf := []byte("{\\rtf1\\ansi\\deff0...")
		invalidRtf := []byte("This is not RTF")

		if err := svc.ValidateFileMagicBytes(".rtf", validRtf); err != nil {
			t.Errorf("RTF hợp lệ nhưng báo lỗi: %v", err)
		}

		if err := svc.ValidateFileMagicBytes(".rtf", invalidRtf); err == nil || !strings.Contains(err.Error(), "Rich Text Format") {
			t.Errorf("RTF không hợp lệ phải báo lỗi, kết quả: %v", err)
		}
	})

	t.Run("TC B-42: File Text/CSV chứa mã thực thi nguy hiểm hoặc HTML", func(t *testing.T) {
		safeText := []byte("Họ và tên, Mã sinh viên, Điểm\nNguyễn Văn A, 23010111, 10\n")
		if err := svc.ValidateFileMagicBytes(".csv", safeText); err != nil {
			t.Errorf("CSV bình thường không nên báo lỗi: %v", err)
		}

		maliciousText := []byte("<script>alert('XSS')</script>")
		if err := svc.ValidateFileMagicBytes(".txt", maliciousText); err == nil || !strings.Contains(err.Error(), "HTML/Script") {
			t.Errorf("Phải chặn file văn bản chứa mã script: %v", err)
		}

		exeInText := []byte("MZ this is an executable binary")
		if err := svc.ValidateFileMagicBytes(".txt", exeInText); err == nil || !strings.Contains(err.Error(), "mã thực thi") {
			t.Errorf("Phải chặn file text chứa MZ Windows binary header: %v", err)
		}
	})
}
