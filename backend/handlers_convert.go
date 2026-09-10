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

	originalFilename := filepath.Base(filepath.Clean(header.Filename))
	if originalFilename == "" || originalFilename == "." || originalFilename == "/" {
		originalFilename = "document"
	}

	ext := strings.ToLower(filepath.Ext(originalFilename))
	baseNameWithoutExt := strings.TrimSuffix(originalFilename, filepath.Ext(originalFilename))
	if baseNameWithoutExt == "" {
		baseNameWithoutExt = "document"
	}

	// 1. Kiểm tra kích thước file
	if header.Size == 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"detail":  "File tải lên rỗng (0 bytes). Vui lòng chọn file có dữ liệu.",
		})
		return
	}

	// 2. Danh sách đuôi file được phép chuyển đổi (Whitelist: chỉ tài liệu văn phòng & PDF)
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

	// 3. Kiểm tra Magic Bytes / Chống Extension Spoofing & Polyglot
	headerBuf := make([]byte, 512)
	n, _ := io.ReadFull(file, headerBuf)
	headerBytes := headerBuf[:n]
	_, _ = file.Seek(0, io.SeekStart)

	if err := validateFileMagicBytes(ext, headerBytes); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"detail":  fmt.Sprintf("Xác thực nội dung file thất bại: %s", err.Error()),
		})
		return
	}

	landscape := r.FormValue("landscape") == "true"
	pdfa := r.FormValue("pdfa") // ví dụ: "PDF/A-1b", "PDF/A-2b", "PDF/A-3b"
	targetFormat := strings.ToLower(strings.TrimSpace(r.FormValue("target_format")))
	if targetFormat == "" {
		if ext == ".pdf" && pdfa == "" && !landscape {
			targetFormat = "docx"
		} else {
			targetFormat = "pdf"
		}
	}

	// Nếu file đầu vào là PDF và định dạng đích là Word DOCX
	if ext == ".pdf" && targetFormat == "docx" {
		s.handlePdfToDocx(w, r, file, originalFilename, baseNameWithoutExt)
		return
	}

	// Tất cả các tài liệu văn phòng hợp lệ được chuyển đổi an toàn qua LibreOffice Engine
	endpointSubpath := "/forms/libreoffice/convert"
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
	InjectTraceparent(r.Context(), req)

	client := &http.Client{Timeout: 120 * time.Second}
	startGotenberg := time.Now()
	resp, err := client.Do(req)
	gotenbergDurMs := float64(time.Since(startGotenberg).Microseconds()) / 1000.0
	finish(err)

	sendCustomChildOTLPTrace(
		r.Context(),
		"gotenberg",
		"📑 [Gotenberg] Chuyển đổi tài liệu (LibreOffice Engine)",
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
		respStr := string(respBytes)
		clientStatusCode := resp.StatusCode
		detailMsg := "Gotenberg chuyển đổi thất bại: " + respStr

		// Nếu lỗi do file tài liệu bị lỗi cấu trúc / không mở được
		if strings.Contains(respStr, "failed to convert the document") ||
			strings.Contains(respStr, "uno exception") ||
			strings.Contains(respStr, "syntax error") {
			clientStatusCode = http.StatusUnprocessableEntity
			detailMsg = "Tài liệu không hợp lệ hoặc cấu trúc file bị lỗi/hỏng, không thể chuyển đổi sang PDF."
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(clientStatusCode)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"detail":  detailMsg,
		})
		return
	}

	// Sanitize baseNameWithoutExt: loại bỏ mọi ký tự lạ, path traversal (.., /, \)
	safeBaseName := strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' || r == '-' || r == '.' {
			return r
		}
		return '_'
	}, baseNameWithoutExt)
	safeBaseName = strings.Trim(safeBaseName, "._- ")
	if safeBaseName == "" {
		safeBaseName = "document"
	}

	// Tạo tên file output và lưu vào downloadDir
	outFilename := fmt.Sprintf("%s_%s.pdf", randomID(), safeBaseName)
	outPath := filepath.Join(s.downloadDir, outFilename)

	// Đảm bảo tuyệt đối outPath nằm trong downloadDir
	relPath, relErr := filepath.Rel(s.downloadDir, outPath)
	if relErr != nil || strings.HasPrefix(relPath, "..") {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"detail":  "Tên file không hợp lệ (nghi ngờ path traversal).",
		})
		return
	}

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

func validateFileMagicBytes(ext string, headerBytes []byte) error {
	if len(headerBytes) == 0 {
		return fmt.Errorf("file không có dữ liệu (0 bytes)")
	}

	switch ext {
	case ".pdf":
		// PDF specification: %PDF- xuất hiện ở đầu file (hoặc trong 1024 bytes đầu)
		if !bytes.Contains(headerBytes, []byte("%PDF-")) {
			return fmt.Errorf("thiếu header %%PDF- chuẩn (nghi ngờ giả mạo đuôi file)")
		}
		// Chặn polyglot nguy hiểm bắt đầu bằng XML/SVG/Script/HTML nhưng chèn đuôi .pdf
		if bytes.HasPrefix(headerBytes, []byte("<svg")) ||
			bytes.HasPrefix(headerBytes, []byte("<?xml")) ||
			bytes.HasPrefix(headerBytes, []byte("<!DOCTYPE")) ||
			bytes.HasPrefix(headerBytes, []byte("<html")) ||
			bytes.HasPrefix(headerBytes, []byte("<script")) ||
			bytes.HasPrefix(headerBytes, []byte("#!/bin")) ||
			bytes.HasPrefix(headerBytes, []byte("\x7fELF")) ||
			bytes.HasPrefix(headerBytes, []byte("MZ")) {
			return fmt.Errorf("phát hiện định dạng polyglot nguy hiểm đội lốt file PDF")
		}
	case ".docx", ".xlsx", ".pptx", ".odt", ".ods", ".odp":
		// Các định dạng Office hiện đại là ZIP archive (bắt đầu bằng PK\x03\x04)
		if len(headerBytes) < 4 || !bytes.Equal(headerBytes[:4], []byte("PK\x03\x04")) {
			return fmt.Errorf("thiếu chữ ký ZIP container (PK) của tài liệu Office")
		}
	case ".doc", ".xls", ".ppt":
		// Định dạng Office nhị phân cũ (OLE2 compound file)
		oleMagic := []byte{0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1}
		if len(headerBytes) < 8 || !bytes.Equal(headerBytes[:8], oleMagic) {
			return fmt.Errorf("thiếu chữ ký OLE2 compound header của tài liệu Office cũ")
		}
	case ".rtf":
		// Định dạng Rich Text Format bắt đầu bằng {\rtf
		if !bytes.HasPrefix(headerBytes, []byte("{\\rtf")) {
			return fmt.Errorf("thiếu chữ ký chuẩn của tài liệu Rich Text Format (RTF)")
		}
	case ".txt", ".csv":
		// Chặn file thực thi binary (ELF, PE MZ) hoặc HTML/Script đội lốt .txt/.csv
		if bytes.HasPrefix(headerBytes, []byte("MZ")) ||
			bytes.HasPrefix(headerBytes, []byte("\x7fELF")) ||
			bytes.HasPrefix(headerBytes, []byte("<!DOCTYPE")) ||
			bytes.HasPrefix(headerBytes, []byte("<html")) ||
			bytes.HasPrefix(headerBytes, []byte("<script")) ||
			bytes.HasPrefix(headerBytes, []byte("<svg")) {
			return fmt.Errorf("phát hiện nội dung mã thực thi hoặc HTML/Script trong file văn bản")
		}
	}
	return nil
}

func (s *Server) handlePdfToDocx(w http.ResponseWriter, r *http.Request, file multipart.File, originalFilename, baseNameWithoutExt string) {
	workerEndpoint := fmt.Sprintf("%s/convert", strings.TrimRight(s.workerPdf2docxURL, "/"))

	bodyBuf := &bytes.Buffer{}
	bodyWriter := multipart.NewWriter(bodyBuf)

	targetFont := r.FormValue("target_font")
	if targetFont != "" {
		_ = bodyWriter.WriteField("target_font", targetFont)
	}

	part, err := bodyWriter.CreateFormFile("file", originalFilename)
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

	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, workerEndpoint, bodyBuf)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"detail":  "Lỗi kết nối tới PDF2DOCX worker: " + err.Error(),
		})
		return
	}
	req.Header.Set("Content-Type", bodyWriter.FormDataContentType())
	InjectTraceparent(r.Context(), req)

	resp, err := s.httpClient.Do(req)

	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"detail":  "Không thể kết nối tới dịch vụ chuyển đổi PDF sang Word (worker_pdf2docx).",
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
			"detail":  "Chuyển đổi PDF sang Word thất bại: " + string(respBytes),
		})
		return
	}

	safeBaseName := strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' || r == '-' || r == '.' {
			return r
		}
		return '_'
	}, baseNameWithoutExt)
	safeBaseName = strings.Trim(safeBaseName, "._- ")
	if safeBaseName == "" {
		safeBaseName = "document"
	}

	outFilename := fmt.Sprintf("%s_%s.docx", randomID(), safeBaseName)
	outPath := filepath.Join(s.downloadDir, outFilename)

	outFile, err := os.Create(outPath)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"detail":  "Không thể lưu file Word sau khi chuyển đổi: " + err.Error(),
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
			"detail":  "Lỗi ghi dữ liệu DOCX: " + err.Error(),
		})
		return
	}

	downloadURL := fmt.Sprintf("/api/file/%s", outFilename)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"success":           true,
		"filename":          outFilename,
		"original_filename": originalFilename,
		"output_filename":   baseNameWithoutExt + ".docx",
		"download_url":      downloadURL,
		"size":              writtenBytes,
		"size_str":          formatBytes(writtenBytes),
	})
}

