package http

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"

	"omniverse_backend/internal/domain"
)

type ConvertHandler struct {
	convertService domain.ConvertUsecase
}

func NewConvertHandler(cs domain.ConvertUsecase) *ConvertHandler {
	return &ConvertHandler{convertService: cs}
}

func (h *ConvertHandler) HandleConvertFile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if err := r.ParseMultipartForm(100 << 20); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"detail":  "File upload vượt quá giới hạn hoặc định dạng multipart không hợp lệ.",
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

	originalFilename := filepath.Base(filepath.Clean(header.Filename))
	if originalFilename == "" || originalFilename == "." || originalFilename == "/" {
		originalFilename = "document"
	}

	ext := strings.ToLower(filepath.Ext(originalFilename))
	baseNameWithoutExt := strings.TrimSuffix(originalFilename, filepath.Ext(originalFilename))
	if baseNameWithoutExt == "" {
		baseNameWithoutExt = "document"
	}

	if header.Size == 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"detail":  "File tải lên rỗng (0 bytes). Vui lòng chọn file có dữ liệu.",
		})
		return
	}

	allowedConvertExts := map[string]bool{
		".docx": true, ".doc": true,
		".xlsx": true, ".xls": true,
		".pptx": true, ".ppt": true,
		".odt": true, ".ods": true, ".odp": true,
		".rtf": true, ".txt": true, ".csv": true,
		".pdf": true,
	}

	if !allowedConvertExts[ext] {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"detail":  fmt.Sprintf("Định dạng file '%s' không được hỗ trợ để chuyển đổi. Vui lòng chỉ tải lên tài liệu văn phòng hợp lệ (.pdf, .docx, .doc, .xlsx, .xls, .pptx, .ppt, .csv, .txt, .rtf, .odt...).", ext),
		})
		return
	}

	headerBuf := make([]byte, 512)
	n, _ := io.ReadFull(file, headerBuf)
	headerBytes := headerBuf[:n]
	_, _ = file.Seek(0, io.SeekStart)

	if err := h.convertService.ValidateFileMagicBytes(ext, headerBytes); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"detail":  fmt.Sprintf("Xác thực nội dung file thất bại: %s", err.Error()),
		})
		return
	}

	landscape := r.FormValue("landscape") == "true"
	pdfa := r.FormValue("pdfa")
	targetFormat := strings.ToLower(strings.TrimSpace(r.FormValue("target_format")))
	if targetFormat == "" {
		if ext == ".pdf" && pdfa == "" && !landscape {
			targetFormat = "docx"
		} else {
			targetFormat = "pdf"
		}
	}

	if ext == ".pdf" && targetFormat == "docx" {
		targetFont := r.FormValue("target_font")
		res, statusCode, err := h.convertService.ConvertPdfToDocx(r.Context(), file, originalFilename, baseNameWithoutExt, targetFont)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(statusCode)
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"success": false,
				"detail":  err.Error(),
			})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(res)
		return
	}

	res, statusCode, err := h.convertService.ConvertOfficeToPdf(r.Context(), file, header.Size, originalFilename, baseNameWithoutExt, landscape, pdfa)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(statusCode)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"detail":  err.Error(),
		})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(res)
}
