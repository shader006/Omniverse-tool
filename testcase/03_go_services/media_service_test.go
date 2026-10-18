package service_test

import (
	"context"
	"testing"
	"time"

	"omniverse_backend/internal/domain"
	"omniverse_backend/internal/infrastructure/cache"
	"omniverse_backend/internal/service"
)

// Mock JobRepository cho MediaService
type mockJobRepo struct {
	metadata map[string]map[string]interface{}
	jobs     map[string]domain.Job
}

func newMockJobRepo() *mockJobRepo {
	return &mockJobRepo{
		metadata: make(map[string]map[string]interface{}),
		jobs:     make(map[string]domain.Job),
	}
}

func (m *mockJobRepo) SaveJob(job domain.Job) {
	m.jobs[job.ID] = job
}

func (m *mockJobRepo) GetJob(jobID string) (domain.Job, bool) {
	j, ok := m.jobs[jobID]
	return j, ok
}

func (m *mockJobRepo) PublishJobUpdate(job domain.Job) {}

func (m *mockJobRepo) SubscribeJob(ctx context.Context, jobID string) (<-chan domain.Job, func()) {
	ch := make(chan domain.Job)
	return ch, func() {}
}

func (m *mockJobRepo) GetMetadata(key string) (map[string]interface{}, bool) {
	data, ok := m.metadata[key]
	return data, ok
}

func (m *mockJobRepo) SetMetadata(key string, data map[string]interface{}, ttl time.Duration) {
	m.metadata[key] = data
}

func (m *mockJobRepo) FindCachedFile(rawURL, mediaFormat, quality string) (string, bool) {
	return "", false
}

func (m *mockJobRepo) CleanupExpiredFiles() (int, int64) {
	return 0, 0
}

// =============================================================================
// TEST CASES: MediaService & Cache Helpers
// =============================================================================

func TestGenerateCacheKey(t *testing.T) {
	t.Run("Tính nhất quán của Cache Key (Deterministic)", func(t *testing.T) {
		url := "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
		key1 := cache.GenerateCacheKey(url, "mp3", "320")
		key2 := cache.GenerateCacheKey(url, "mp3", "320")

		if key1 != key2 {
			t.Errorf("Cùng tham số phải tạo cùng key: %s != %s", key1, key2)
		}
		if len(key1) != 10 {
			t.Errorf("Độ dài cache key phải là 10 ký tự, nhận được: %d", len(key1))
		}
	})

	t.Run("Khác định dạng hoặc chất lượng phải sinh key khác nhau", func(t *testing.T) {
		url := "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
		keyMp3 := cache.GenerateCacheKey(url, "mp3", "320")
		keyMp4 := cache.GenerateCacheKey(url, "mp4", "1080")
		keyMp3Low := cache.GenerateCacheKey(url, "mp3", "128")

		if keyMp3 == keyMp4 || keyMp3 == keyMp3Low {
			t.Errorf("Các định dạng/chất lượng khác nhau không được trùng cache key")
		}
	})
}

func TestMediaService_CacheHit(t *testing.T) {
	repo := newMockJobRepo()
	targetURL := "https://www.youtube.com/watch?v=test12345"
	cacheKey := cache.GenerateCacheKey(targetURL, "info", "info")

	// Đưa sẵn dữ liệu metadata vào cache
	fakeData := map[string]interface{}{
		"title":    "Rick Astley - Never Gonna Give You Up",
		"duration": float64(212),
		"author":   "RickAstleyVEVO",
	}
	repo.SetMetadata(cacheKey, fakeData, cache.DefaultCacheTTL)

	limiter := make(chan struct{}, 5)
	svc := service.NewMediaService(repo, nil, limiter, "/tmp", "")

	data, cached, err := svc.GetMediaInfo(context.Background(), targetURL)
	if err != nil {
		t.Fatalf("Không nên có lỗi khi cache hit: %v", err)
	}

	if !cached {
		t.Errorf("Phải đánh dấu cached = true khi lấy từ cache repository")
	}

	if data["title"] != "Rick Astley - Never Gonna Give You Up" {
		t.Errorf("Dữ liệu trả về không đúng với dữ liệu trong cache: %v", data)
	}
}

func TestMediaService_ConcurrencyLimiter(t *testing.T) {
	limiter := make(chan struct{}, 2)

	// Kiểm tra channel limiter có thể nạp tối đa capacity
	limiter <- struct{}{}
	limiter <- struct{}{}

	select {
	case limiter <- struct{}{}:
		t.Errorf("Limiter đã đầy (cap=2) không được phép ghi thêm mà không block")
	default:
		// Đúng mong đợi: select vào default vì channel đã đầy
	}

	<-limiter
	<-limiter
}
