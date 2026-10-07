package service

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"omniverse_backend/internal/domain"
	"omniverse_backend/internal/infrastructure/telemetry"
)

type ConvertService struct {
	gotenbergLB       domain.EndpointSelector
	workerPdf2docxURL string
	downloadDir       string
	httpClient        *http.Client
}

func NewConvertService(
	lb domain.EndpointSelector,
	pdf2docxURL string,
	downloadDir string,
	httpClient *http.Client,
) *ConvertService {
	return &ConvertService{
		gotenbergLB:       lb,
		workerPdf2docxURL: pdf2docxURL,
		downloadDir:       downloadDir,
		httpClient:        httpClient,
	}
}

func FormatBytes(b int64) string {
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%d B", b)
	}
	div, exp := int64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(b)/float64(div), "KMGTPE"[exp])
}

func (s *ConvertService) ValidateFileMagicBytes(ext string, headerBytes []byte) error {
	if len(headerBytes) == 0 {
		return fmt.Errorf("file không có dữ liệu (0 bytes)")
	}

	switch ext {
	case ".pdf":
		if !bytes.Contains(headerBytes, []byte("%PDF-")) {
			return fmt.Errorf("thiếu header %%PDF- chuẩn (nghi ngờ giả mạo đuôi file)")
		}
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
		if len(headerBytes) < 4 || !bytes.Equal(headerBytes[:4], []byte("PK\x03\x04")) {
			return fmt.Errorf("thiếu chữ ký ZIP container (PK) của tài liệu Office")
		}
	case ".doc", ".xls", ".ppt":
		oleMagic := []byte{0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1}
		if len(headerBytes) < 8 || !bytes.Equal(headerBytes[:8], oleMagic) {
			return fmt.Errorf("thiếu chữ ký OLE2 compound header của tài liệu Office cũ")
		}
	case ".rtf":
		if !bytes.HasPrefix(headerBytes, []byte("{\\rtf")) {
			return fmt.Errorf("thiếu chữ ký chuẩn của tài liệu Rich Text Format (RTF)")
		}
	case ".txt", ".csv":
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

func (s *ConvertService) ConvertOfficeToPdf(
	ctx context.Context,
	file io.Reader,
	fileSize int64,
	originalFilename, baseNameWithoutExt string,
	landscape bool,
	pdfa string,
) (map[string]interface{}, int, error) {
	endpointSubpath := "/forms/libreoffice/convert"
	gotenbergEndpoint, finish := s.gotenbergLB.SelectEndpoint(endpointSubpath)

	bodyBuf := bytes.NewBuffer(make([]byte, 0, fileSize+2048))
	bodyWriter := multipart.NewWriter(bodyBuf)

	if landscape {
		_ = bodyWriter.WriteField("landscape", "true")
	}
	if pdfa != "" {
		_ = bodyWriter.WriteField("pdfa", pdfa)
	}

	part, err := bodyWriter.CreateFormFile("files", originalFilename)
	if err != nil {
		return nil, http.StatusInternalServerError, fmt.Errorf("Lỗi xử lý file stream: %w", err)
	}

	if _, err := io.Copy(part, file); err != nil {
		return nil, http.StatusInternalServerError, fmt.Errorf("Lỗi sao chép file dữ liệu: %w", err)
	}
	_ = bodyWriter.Close()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, gotenbergEndpoint, bodyBuf)
	if err != nil {
		return nil, http.StatusInternalServerError, fmt.Errorf("Lỗi khởi tạo kết nối tới Gotenberg: %w", err)
	}
	req.Header.Set("Content-Type", bodyWriter.FormDataContentType())
	telemetry.InjectTraceparent(ctx, req)

	resp, err := s.httpClient.Do(req)
	finish(err)

	if err != nil {
		return nil, http.StatusServiceUnavailable, fmt.Errorf("Không thể kết nối tới Gotenberg service. Vui lòng kiểm tra container Gotenberg.")
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBytes, _ := io.ReadAll(resp.Body)
		respStr := string(respBytes)
		clientStatusCode := resp.StatusCode
		detailMsg := "Gotenberg chuyển đổi thất bại: " + respStr

		if strings.Contains(respStr, "failed to convert the document") ||
			strings.Contains(respStr, "uno exception") ||
			strings.Contains(respStr, "syntax error") {
			clientStatusCode = http.StatusUnprocessableEntity
			detailMsg = "Tài liệu không hợp lệ hoặc cấu trúc file bị lỗi/hỏng, không thể chuyển đổi sang PDF."
		}
		return nil, clientStatusCode, fmt.Errorf("%s", detailMsg)
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

	outFilename := fmt.Sprintf("%s_%s.pdf", randomID(), safeBaseName)
	outPath := filepath.Join(s.downloadDir, outFilename)

	relPath, relErr := filepath.Rel(s.downloadDir, outPath)
	if relErr != nil || strings.HasPrefix(relPath, "..") {
		return nil, http.StatusBadRequest, fmt.Errorf("Tên file không hợp lệ (nghi ngờ path traversal).")
	}

	outFile, err := os.Create(outPath)
	if err != nil {
		return nil, http.StatusInternalServerError, fmt.Errorf("Không thể lưu file PDF sau khi convert: %w", err)
	}
	defer outFile.Close()

	writtenBytes, err := io.Copy(outFile, resp.Body)
	if err != nil {
		return nil, http.StatusInternalServerError, fmt.Errorf("Lỗi ghi dữ liệu PDF: %w", err)
	}

	downloadURL := fmt.Sprintf("/api/file/%s", outFilename)
	return map[string]interface{}{
		"success":           true,
		"filename":          outFilename,
		"original_filename": originalFilename,
		"output_filename":   baseNameWithoutExt + ".pdf",
		"download_url":      downloadURL,
		"size":              writtenBytes,
		"size_str":          FormatBytes(writtenBytes),
	}, http.StatusOK, nil
}

func (s *ConvertService) ConvertPdfToDocx(
	ctx context.Context,
	file io.Reader,
	originalFilename, baseNameWithoutExt, targetFont string,
) (map[string]interface{}, int, error) {
	workerEndpoint := fmt.Sprintf("%s/convert", strings.TrimRight(s.workerPdf2docxURL, "/"))

	bodyBuf := &bytes.Buffer{}
	bodyWriter := multipart.NewWriter(bodyBuf)

	if targetFont != "" {
		_ = bodyWriter.WriteField("target_font", targetFont)
	}

	part, err := bodyWriter.CreateFormFile("file", originalFilename)
	if err != nil {
		return nil, http.StatusInternalServerError, fmt.Errorf("Lỗi xử lý file stream: %w", err)
	}

	if _, err := io.Copy(part, file); err != nil {
		return nil, http.StatusInternalServerError, fmt.Errorf("Lỗi sao chép file dữ liệu: %w", err)
	}
	_ = bodyWriter.Close()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, workerEndpoint, bodyBuf)
	if err != nil {
		return nil, http.StatusInternalServerError, fmt.Errorf("Lỗi kết nối tới PDF2DOCX worker: %w", err)
	}
	req.Header.Set("Content-Type", bodyWriter.FormDataContentType())
	telemetry.InjectTraceparent(ctx, req)

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, http.StatusServiceUnavailable, fmt.Errorf("Không thể kết nối tới dịch vụ chuyển đổi PDF sang Word (worker_pdf2docx).")
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBytes, _ := io.ReadAll(resp.Body)
		return nil, resp.StatusCode, fmt.Errorf("Chuyển đổi PDF sang Word thất bại: %s", string(respBytes))
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
		return nil, http.StatusInternalServerError, fmt.Errorf("Không thể lưu file Word sau khi chuyển đổi: %w", err)
	}
	defer outFile.Close()

	writtenBytes, err := io.Copy(outFile, resp.Body)
	if err != nil {
		return nil, http.StatusInternalServerError, fmt.Errorf("Lỗi ghi dữ liệu DOCX: %w", err)
	}

	downloadURL := fmt.Sprintf("/api/file/%s", outFilename)
	return map[string]interface{}{
		"success":           true,
		"filename":          outFilename,
		"original_filename": originalFilename,
		"output_filename":   baseNameWithoutExt + ".docx",
		"download_url":      downloadURL,
		"size":              writtenBytes,
		"size_str":          FormatBytes(writtenBytes),
	}, http.StatusOK, nil
}
