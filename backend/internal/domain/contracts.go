package domain

import (
	"context"
	"io"
	"time"
)

// JobRepository định nghĩa các thao tác lưu trữ, cache và pub/sub trạng thái Job
type JobRepository interface {
	SaveJob(job Job)
	GetJob(jobID string) (Job, bool)
	CancelJob(jobID string) (Job, error)
	PublishJobUpdate(job Job)
	SubscribeJob(ctx context.Context, jobID string) (<-chan Job, func())
	GetMetadata(key string) (map[string]interface{}, bool)
	SetMetadata(key string, data map[string]interface{}, ttl time.Duration)
	FindCachedFile(rawURL, mediaFormat, quality string) (string, bool)
	CleanupExpiredFiles() (int, int64)
}

// WorkerClient trừu tượng hóa giao tiếp HTTP với các Worker Microservices
type WorkerClient interface {
	CallWorkerJSON(ctx context.Context, workerBaseURL string, path string, payload interface{}) ([]byte, int, error)
	ForwardMultipartToWorker(ctx context.Context, workerBaseURL string, path string, fileBytes []byte, filename string, fieldName string, formValues map[string]string) ([]byte, int, error)
	ForwardMultipartToWorkerLong(ctx context.Context, workerBaseURL string, path string, fileBytes []byte, filename string, fieldName string, formValues map[string]string) ([]byte, int, error)
}

// EndpointSelector trừu tượng hóa cơ chế Load Balancing cho worker (Gotenberg)
type EndpointSelector interface {
	SelectEndpoint(subPath string) (string, func(err error))
}

// JobUsecase định nghĩa các nghiệp vụ truy vấn trạng thái và giải quyết file của tác vụ
type JobUsecase interface {
	GetJob(jobID string) (Job, error)
	CancelJob(jobID string) (Job, error)
	SubscribeJob(ctx context.Context, jobID string) (<-chan Job, func())
	ResolveFilePath(filename string) (string, string, error)
	CleanupExpiredFiles() (int, int64)
}

// MediaUsecase định nghĩa các nghiệp vụ tải và trích xuất thông tin media
type MediaUsecase interface {
	GetMediaInfo(ctx context.Context, rawURL string) (map[string]interface{}, bool, error)
	CreateDownloadJob(ctx context.Context, rawURL, mediaFormat, quality string) (string, bool, error)
	FailJob(jobID, errMsg string)
}

// ConvertUsecase định nghĩa các nghiệp vụ chuyển đổi tài liệu đa định dạng
type ConvertUsecase interface {
	ValidateFileMagicBytes(ext string, headerBytes []byte) error
	ConvertOfficeToPdf(
		ctx context.Context,
		file io.Reader,
		fileSize int64,
		originalFilename, baseNameWithoutExt string,
		landscape bool,
		pdfa string,
	) (map[string]interface{}, int, error)
	ConvertPdfToDocx(
		ctx context.Context,
		file io.Reader,
		originalFilename, baseNameWithoutExt, targetFont string,
	) (map[string]interface{}, int, error)
}

// AIUsecase định nghĩa các nghiệp vụ AI (nhận diện giọng nói, tách nền, phục chế ảnh)
type AIUsecase interface {
	TranscribeAudio(ctx context.Context, fileBytes []byte, filename, language, format, task string) ([]byte, int, error)
	RemoveBackground(ctx context.Context, fileBytes []byte, filename, model, threshold, returnMask string) ([]byte, int, error)
	ForwardToWorker(ctx context.Context, workerURL, path string, fileBytes []byte, filename string, fieldName string, formValues map[string]string) ([]byte, int, error)
	ForwardToWorkerLong(ctx context.Context, workerURL, path string, fileBytes []byte, filename string, fieldName string, formValues map[string]string) ([]byte, int, error)
	CheckWorkerHealth(ctx context.Context, workerURL, path string) ([]byte, int, error)
	GetPixelfixerURL() string
	GetUpscalerURL() string
}
