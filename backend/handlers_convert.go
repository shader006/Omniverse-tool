package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func (s *Server) handleConvertFile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Giới hạn upload tối đa 100MB
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

	originalFilename := header.Filename
	ext := strings.ToLower(filepath.Ext(originalFilename))
	baseNameWithoutExt := strings.TrimSuffix(originalFilename, filepath.Ext(originalFilename))
	if baseNameWithoutExt == "" {
		baseNameWithoutExt = "document"
	}

	landscape := r.FormValue("landscape") == "true"
	pdfa := r.FormValue("pdfa") // ví dụ: "PDF/A-1b", "PDF/A-2b", "PDF/A-3b"

	// Quyết định endpoint Gotenberg dựa trên đuôi file
	var endpointSubpath string
	switch ext {
	case ".html", ".htm":
		endpointSubpath = "/forms/chromium/convert/html"
	case ".md", ".markdown":
		endpointSubpath = "/forms/libreoffice/convert"
	default:
		// Office formats (.docx, .doc, .xlsx, .xls, .pptx, .ppt, .odt, .ods, .odp, .rtf, .txt, .pdf)
		endpointSubpath = "/forms/libreoffice/convert"
	}

	gotenbergEndpoint, finish := s.gotenbergLB.SelectEndpoint(endpointSubpath)

	// Chuẩn bị multipart body gửi sang Gotenberg
	bodyBuf := &bytes.Buffer{}
	bodyWriter := multipart.NewWriter(bodyBuf)

	// Thêm các option nếu có
	if landscape {
		_ = bodyWriter.WriteField("landscape", "true")
	}
	if pdfa != "" {
		_ = bodyWriter.WriteField("pdfa", pdfa)
	}

	// Thêm file vào form
	targetFileName := originalFilename
	if ext == ".html" || ext == ".htm" {
		targetFileName = "index.html"
	} else if ext == ".md" || ext == ".markdown" {
		targetFileName = baseNameWithoutExt + ".txt"
	}

	part, err := bodyWriter.CreateFormFile("files", targetFileName)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"detail":  "Lỗi xử lý file stream: " + err.Error(),
		})
		return
	}

	if _, err := io.Copy(part, file); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"detail":  "Lỗi sao chép file dữ liệu: " + err.Error(),
		})
		return
	}

	_ = bodyWriter.Close()

	// Gửi request tới Gotenberg
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, gotenbergEndpoint, bodyBuf)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"detail":  "Lỗi khởi tạo kết nối tới Gotenberg: " + err.Error(),
		})
		return
	}
	req.Header.Set("Content-Type", bodyWriter.FormDataContentType())

	client := &http.Client{Timeout: 120 * time.Second}
	startGotenberg := time.Now()
	resp, err := client.Do(req)
	gotenbergDurMs := float64(time.Since(startGotenberg).Microseconds()) / 1000.0
	finish(err)

	sendCustomOTLPTrace(
		"gotenberg",
		"POST "+endpointSubpath,
		gotenbergDurMs,
		map[string]string{
			"http.route":  endpointSubpath,
			"http.method": "POST",
			"file.name":   originalFilename,
			"file.ext":    ext,
		},
		err != nil || (resp != nil && resp.StatusCode != http.StatusOK),
	)

	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"detail":  "Không thể kết nối tới Gotenberg service. Vui lòng kiểm tra container Gotenberg.",
		})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBytes, _ := io.ReadAll(resp.Body)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(resp.StatusCode)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"detail":  "Gotenberg chuyển đổi thất bại: " + string(respBytes),
		})
		return
	}

	// Tạo tên file output và lưu vào downloadDir
	outFilename := fmt.Sprintf("%s_%s.pdf", randomID(), baseNameWithoutExt)
	outPath := filepath.Join(s.downloadDir, outFilename)

	outFile, err := os.Create(outPath)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"detail":  "Không thể lưu file PDF sau khi convert: " + err.Error(),
		})
		return
	}
	defer outFile.Close()

	writtenBytes, err := io.Copy(outFile, resp.Body)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"detail":  "Lỗi ghi dữ liệu PDF: " + err.Error(),
		})
		return
	}

	downloadURL := fmt.Sprintf("/api/file/%s", outFilename)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"success":           true,
		"filename":          outFilename,
		"original_filename": originalFilename,
		"output_filename":   baseNameWithoutExt + ".pdf",
		"download_url":      downloadURL,
		"size":              writtenBytes,
		"size_str":          formatBytes(writtenBytes),
	})
}
