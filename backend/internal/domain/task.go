package domain

import "context"

// MediaJob là interface cơ sở trừu tượng cho mọi loại tác vụ chuyển đổi/xử lý trong hệ thống
// Khớp với thiết kế hướng đối tượng <<abstract>> MediaJob trong README.md
type MediaJob interface {
	GetJobID() string
	GetStatus() JobStatus
	GetProgress() float64
	UpdateProgress(percent float64, speed string, eta string)
	Complete(resultURL string, filename string)
	Fail(err error)
	Execute(ctx context.Context) error
}

// TaskType phân loại các nhóm tác vụ trong hệ thống
type TaskType string

const (
	TaskTypeDownload   TaskType = "download"
	TaskTypeConvertDoc TaskType = "convert_doc"
	TaskTypeTranscribe TaskType = "transcribe"
	TaskTypeRemoveBg   TaskType = "remove_bg"
	TaskTypePixelFix   TaskType = "pixel_fix"
	TaskTypeUpscale    TaskType = "upscale"
)
