package domain

import (
	"fmt"
	"time"
)

// JobStatus biểu diễn trạng thái của một tác vụ xử lý
type JobStatus string

const (
	StatusQueued      JobStatus = "queued"
	StatusDownloading JobStatus = "downloading"
	StatusProcessing  JobStatus = "processing"
	StatusCompleted   JobStatus = "completed"
	StatusError       JobStatus = "error"
	StatusCancelled   JobStatus = "cancelled"
)

// Job đại diện cho thực thể tác vụ chuyển đổi / xử lý đa phương tiện trong hệ thống
type Job struct {
	JobID       string    `json:"job_id"`
	URL         string    `json:"url"`
	Format      string    `json:"format"`
	Quality     string    `json:"quality"`
	Status      string    `json:"status"` // "queued", "downloading", "processing", "completed", "error", "cancelled"
	Percent     float64   `json:"percent"`
	Speed       string    `json:"speed"`
	ETA         string    `json:"eta"`
	Filename    string    `json:"filename,omitempty"`
	DownloadURL string    `json:"download_url,omitempty"`
	Error       string    `json:"error,omitempty"`
	CreatedAt   float64   `json:"created_at"`
}

// NewJob khởi tạo thực thể Job mới ở trạng thái chờ (queued)
func NewJob(jobID, rawURL, format, quality string) Job {
	return Job{
		JobID:     jobID,
		URL:       rawURL,
		Format:    format,
		Quality:   quality,
		Status:    string(StatusQueued),
		Percent:   0,
		Speed:     "0 KiB/s",
		ETA:       "--:--",
		CreatedAt: float64(time.Now().Unix()),
	}
}

// IsFinished kiểm tra xem tác vụ đã kết thúc hay chưa (completed, error, hoặc cancelled)
func (j Job) IsFinished() bool {
	return j.Status == string(StatusCompleted) ||
		j.Status == string(StatusError) ||
		j.Status == string(StatusCancelled)
}

// CanCancel kiểm tra xem tác vụ có thể huỷ được không (khi chưa kết thúc)
func (j Job) CanCancel() bool {
	return !j.IsFinished()
}

// MarkCompleted đánh dấu tác vụ hoàn tất thành công
func (j *Job) MarkCompleted(filename, downloadURL string) {
	j.Status = string(StatusCompleted)
	j.Percent = 100
	j.Filename = filename
	j.DownloadURL = downloadURL
	j.Error = ""
}

// MarkError đánh dấu tác vụ thất bại kèm thông báo lỗi
func (j *Job) MarkError(errMsg string) {
	j.Status = string(StatusError)
	j.Error = errMsg
}

// MarkCancelled đánh dấu tác vụ đã bị huỷ bởi người dùng
func (j *Job) MarkCancelled() {
	j.Status = string(StatusCancelled)
	j.Error = "Tác vụ đã bị huỷ"
}

// UpdateProgress cập nhật tiến độ phần trăm, tốc độ xử lý và thời gian dự tính
func (j *Job) UpdateProgress(percent float64, speed, eta string) {
	j.Percent = percent
	if speed != "" {
		j.Speed = speed
	}
	if eta != "" {
		j.ETA = eta
	}
}

// Validate kiểm tra tính hợp lệ cơ bản của thực thể Job
func (j Job) Validate() error {
	if j.JobID == "" {
		return fmt.Errorf("job_id không được để trống")
	}
	if j.URL == "" {
		return fmt.Errorf("url không được để trống")
	}
	return nil
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
