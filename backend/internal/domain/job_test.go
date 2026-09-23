package domain

import (
	"testing"
)

func TestNewJob(t *testing.T) {
	job := NewJob("job-123", "https://example.com/video.mp4", "mp4", "1080p")
	if job.JobID != "job-123" {
		t.Errorf("Kỳ vọng JobID là job-123, nhận được %s", job.JobID)
	}
	if job.Status != string(StatusQueued) {
		t.Errorf("Kỳ vọng status ban đầu là queued, nhận được %s", job.Status)
	}
	if job.Percent != 0 {
		t.Errorf("Kỳ vọng percent ban đầu là 0, nhận được %f", job.Percent)
	}
	if job.IsFinished() {
		t.Errorf("Job mới tạo không được đánh dấu là finished")
	}
	if !job.CanCancel() {
		t.Errorf("Job mới tạo phải có thể cancel được")
	}
}

func TestJobLifecycle(t *testing.T) {
	job := NewJob("job-456", "https://example.com/audio.mp3", "mp3", "best")

	// Update progress
	job.UpdateProgress(45.5, "1.2MB/s", "00:10")
	if job.Percent != 45.5 || job.Speed != "1.2MB/s" || job.ETA != "00:10" {
		t.Errorf("UpdateProgress không cập nhật đúng giá trị: %+v", job)
	}

	// Mark completed
	job.MarkCompleted("audio.mp3", "/api/file/audio.mp3")
	if !job.IsFinished() {
		t.Errorf("Job hoàn tất phải trả về IsFinished = true")
	}
	if job.CanCancel() {
		t.Errorf("Job đã hoàn tất không thể cancel được")
	}
	if job.Percent != 100 || job.Filename != "audio.mp3" {
		t.Errorf("MarkCompleted không cập nhật đúng kết quả: %+v", job)
	}
}

func TestJobCancelled(t *testing.T) {
	job := NewJob("job-789", "https://example.com/file.pdf", "pdf", "")
	job.MarkCancelled()
	if !job.IsFinished() {
		t.Errorf("Job huỷ phải là IsFinished = true")
	}
	if job.Status != string(StatusCancelled) {
		t.Errorf("Kỳ vọng Status là cancelled, nhận được %s", job.Status)
	}
}

func TestJobValidate(t *testing.T) {
	invalidJob := Job{}
	if err := invalidJob.Validate(); err == nil {
		t.Errorf("Kỳ vọng Validate trả về lỗi khi Job rỗng")
	}

	validJob := NewJob("valid-id", "https://youtube.com/watch?v=123", "mp4", "best")
	if err := validJob.Validate(); err != nil {
		t.Errorf("Kỳ vọng Validate hợp lệ, nhận lỗi: %v", err)
	}
}
