package domain

// JobStatus biểu diễn trạng thái của một tác vụ xử lý
type JobStatus string

const (
	StatusQueued      JobStatus = "queued"
	StatusDownloading JobStatus = "downloading"
	StatusProcessing  JobStatus = "processing"
	StatusCompleted   JobStatus = "completed"
	StatusError       JobStatus = "error"
)

// Job đại diện cho thực thể tác vụ chuyển đổi / xử lý đa phương tiện trong hệ thống
type Job struct {
	JobID       string    `json:"job_id"`
	URL         string    `json:"url"`
	Format      string    `json:"format"`
	Quality     string    `json:"quality"`
	Status      string    `json:"status"` // "queued", "downloading", "processing", "completed", "error"
	Percent     float64   `json:"percent"`
	Speed       string    `json:"speed"`
	ETA         string    `json:"eta"`
	Filename    string    `json:"filename,omitempty"`
	DownloadURL string    `json:"download_url,omitempty"`
	Error       string    `json:"error,omitempty"`
	CreatedAt   float64   `json:"created_at"`
}

// InfoRequest yêu cầu trích xuất metadata từ URL
type InfoRequest struct {
	URL string `json:"url"`
}

// DownloadRequest yêu cầu tải và chuyển đổi media từ URL
type DownloadRequest struct {
	URL     string `json:"url"`
	Format  string `json:"format"`
	Quality string `json:"quality"`
}
