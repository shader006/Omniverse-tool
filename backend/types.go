package main

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
)

type Job struct {
	JobID       string  `json:"job_id"`
	URL         string  `json:"url"`
	Format      string  `json:"format"`
	Quality     string  `json:"quality"`
	Status      string  `json:"status"` // "queued", "downloading", "completed", "error"
	Percent     float64 `json:"percent"`
	Speed       string  `json:"speed"`
	ETA         string  `json:"eta"`
	Filename    string  `json:"filename,omitempty"`
	DownloadURL string  `json:"download_url,omitempty"`
	Error       string  `json:"error,omitempty"`
	CreatedAt   float64 `json:"created_at"`
}

type InfoRequest struct {
	URL string `json:"url"`
}

type DownloadRequest struct {
	URL     string `json:"url"`
	Format  string `json:"format"`
	Quality string `json:"quality"`
}

type Server struct {
	pogo             *PogocacheEngine
	mediaLimiter     chan struct{}
	downloadDir      string
	frontendDir      string
	gotenbergLB      *GotenbergLoadBalancer
	workerYtdlpURL   string
	workerWhisperURL string
	workerRmbgURL    string
	httpClient       *http.Client
}

func randomID() string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func formatBytes(b int64) string {
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
