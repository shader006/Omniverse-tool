package service

import (
	"context"
	"os"
	"path/filepath"
	"strings"

	"omniverse_backend/internal/domain"
)

type JobService struct {
	cache       domain.JobRepository
	downloadDir string
}

func NewJobService(c domain.JobRepository, downloadDir string) *JobService {
	return &JobService{
		cache:       c,
		downloadDir: downloadDir,
	}
}

func (s *JobService) GetJob(jobID string) (domain.Job, error) {
	job, found := s.cache.GetJob(jobID)
	if !found {
		return domain.Job{}, domain.ErrJobNotFound
	}
	return job, nil
}

func (s *JobService) CancelJob(jobID string) (domain.Job, error) {
	return s.cache.CancelJob(jobID)
}

func (s *JobService) SubscribeJob(ctx context.Context, jobID string) (<-chan domain.Job, func()) {
	return s.cache.SubscribeJob(ctx, jobID)
}

func (s *JobService) ResolveFilePath(filename string) (string, string, error) {
	cleanName := filepath.Base(filepath.Clean(filename))
	if cleanName == "" || cleanName == "." || cleanName == "/" {
		return "", "", domain.ErrInvalidInput
	}

	fullPath := filepath.Join(s.downloadDir, cleanName)
	info, err := os.Stat(fullPath)
	if err != nil || info.IsDir() {
		return "", "", domain.ErrFileNotFound
	}

	contentType := "application/octet-stream"
	ext := strings.ToLower(filepath.Ext(cleanName))
	switch ext {
	case ".mp4":
		contentType = "video/mp4"
	case ".mp3":
		contentType = "audio/mpeg"
	case ".m4a":
		contentType = "audio/mp4"
	case ".pdf":
		contentType = "application/pdf"
	case ".docx":
		contentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	case ".png":
		contentType = "image/png"
	case ".jpg", ".jpeg":
		contentType = "image/jpeg"
	case ".webp":
		contentType = "image/webp"
	case ".txt":
		contentType = "text/plain; charset=utf-8"
	case ".srt":
		contentType = "text/plain; charset=utf-8"
	case ".vtt":
		contentType = "text/vtt; charset=utf-8"
	case ".json":
		contentType = "application/json"
	}

	return fullPath, contentType, nil
}

func (s *JobService) CleanupExpiredFiles() (int, int64) {
	return s.cache.CleanupExpiredFiles()
}
