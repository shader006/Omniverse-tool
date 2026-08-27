package main

import (
	"bytes"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"hash/fnv"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	DefaultCacheTTL = 300 * time.Second // 5 phút TTL
	NumShards       = 256               // 256 Shards phân vùng bộ nhớ
)

type MetadataItem struct {
	Data      map[string]interface{}
	ExpiresAt time.Time
}

// ── L2 Sharded Memory Cache (Pogocache Embedded Core) ──
type CacheShard struct {
	mu    sync.RWMutex
	items map[string]MetadataItem
}

type L2ShardedCache struct {
	shards []*CacheShard
}

func NewL2ShardedCache() *L2ShardedCache {
	shards := make([]*CacheShard, NumShards)
	for i := 0; i < NumShards; i++ {
		shards[i] = &CacheShard{
			items: make(map[string]MetadataItem),
		}
	}
	return &L2ShardedCache{shards: shards}
}

func (sc *L2ShardedCache) getShard(key string) *CacheShard {
	h := fnv.New32a()
	_, _ = h.Write([]byte(key))
	idx := h.Sum32() % NumShards
	return sc.shards[idx]
}

func (sc *L2ShardedCache) Get(key string) (map[string]interface{}, bool) {
	shard := sc.getShard(key)
	shard.mu.RLock()
	defer shard.mu.RUnlock()

	item, exists := shard.items[key]
	if !exists || time.Now().After(item.ExpiresAt) {
		return nil, false
	}
	return item.Data, true
}

func (sc *L2ShardedCache) Set(key string, data map[string]interface{}, ttl time.Duration) {
	shard := sc.getShard(key)
	shard.mu.Lock()
	defer shard.mu.Unlock()

	shard.items[key] = MetadataItem{
		Data:      data,
		ExpiresAt: time.Now().Add(ttl),
	}
}

// ── Hybrid L1 + L2 Cache Manager ──
type CacheManager struct {
	// L1: In-Process Ultra-Fast Local RAM (0.0001 ms)
	l1Mu    sync.RWMutex
	l1Cache map[string]MetadataItem

	// L2: Sharded Engine + Distributed Pogocache HTTP Endpoint
	l2Sharded    *L2ShardedCache
	pogocacheURL string
	httpClient   *http.Client
	downloadDir  string
}

func NewCacheManager(downloadDir string) *CacheManager {
	if downloadDir == "" {
		downloadDir = "/app/downloads"
	}
	_ = os.MkdirAll(downloadDir, 0755)

	pogoURL := os.Getenv("POGOCACHE_URL") // e.g., http://pogocache:8080

	cm := &CacheManager{
		l1Cache:      make(map[string]MetadataItem),
		l2Sharded:    NewL2ShardedCache(),
		pogocacheURL: pogoURL,
		httpClient: &http.Client{
			Timeout: 200 * time.Millisecond,
		},
		downloadDir: downloadDir,
	}

	log.Printf("🚀 [CACHE ENGINE] Khởi tạo thành công Hybrid L1 (Local RAM) + L2 (Sharded/Pogocache)")

	// Khởi động Goroutine dọn dẹp file định kỳ mỗi 60 giây
	go cm.startBackgroundCleanup(60 * time.Second)

	return cm
}

func GenerateCacheKey(url, mediaFormat, quality string) string {
	raw := fmt.Sprintf("%s_%s_%s", strings.TrimSpace(url), strings.ToLower(mediaFormat), quality)
	hasher := md5.New()
	hasher.Write([]byte(raw))
	return hex.EncodeToString(hasher.Sum(nil))[:10]
}

// GetMetadata: Tra cứu theo cấp độ L1 (Local RAM) -> L2 (Sharded/Pogocache) -> Backfill
func (cm *CacheManager) GetMetadata(key string) (map[string]interface{}, bool) {
	now := time.Now()

	// 1. Kiểm tra L1 Local RAM (Độ trễ: 0.0001 ms)
	cm.l1Mu.RLock()
	item, exists := cm.l1Cache[key]
	if exists && now.Before(item.ExpiresAt) {
		cm.l1Mu.RUnlock()
		return item.Data, true
	}
	cm.l1Mu.RUnlock()

	// 2. Nếu L1 Miss -> Kiểm tra L2 Sharded Core (Độ trễ: 0.001 ms)
	if val, ok := cm.l2Sharded.Get(key); ok {
		// Backfill nạp ngay vào L1
		cm.l1Mu.Lock()
		cm.l1Cache[key] = MetadataItem{Data: val, ExpiresAt: now.Add(DefaultCacheTTL)}
		cm.l1Mu.Unlock()
		return val, true
	}

	// 3. Nếu cấu hình Remote Pogocache Service -> Kiểm tra qua HTTP
	if cm.pogocacheURL != "" {
		reqURL := fmt.Sprintf("%s/get/%s", cm.pogocacheURL, key)
		res, err := cm.httpClient.Get(reqURL)
		if err == nil && res.StatusCode == http.StatusOK {
			defer res.Body.Close()
			var data map[string]interface{}
			if err := json.NewDecoder(res.Body).Decode(&data); err == nil {
				// Backfill vào cả L1 và L2 Sharded
				cm.l2Sharded.Set(key, data, DefaultCacheTTL)
				cm.l1Mu.Lock()
				cm.l1Cache[key] = MetadataItem{Data: data, ExpiresAt: now.Add(DefaultCacheTTL)}
				cm.l1Mu.Unlock()
				return data, true
			}
		}
	}

	return nil, false
}

// SetMetadata: Ghi đồng thời vào cả L1 và L2 (Write-Through)
func (cm *CacheManager) SetMetadata(key string, data map[string]interface{}, ttl time.Duration) {
	now := time.Now()

	// 1. Ghi vào L1 Local RAM
	cm.l1Mu.Lock()
	cm.l1Cache[key] = MetadataItem{
		Data:      data,
		ExpiresAt: now.Add(ttl),
	}
	cm.l1Mu.Unlock()

	// 2. Ghi vào L2 Sharded Core
	cm.l2Sharded.Set(key, data, ttl)

	// 3. Ghi vào Remote Pogocache Server nếu có
	if cm.pogocacheURL != "" {
		go func() {
			body, _ := json.Marshal(data)
			reqURL := fmt.Sprintf("%s/set/%s?ttl=%d", cm.pogocacheURL, key, int(ttl.Seconds()))
			req, err := http.NewRequest(http.MethodPut, reqURL, bytes.NewBuffer(body))
			if err == nil {
				req.Header.Set("Content-Type", "application/json")
				_, _ = cm.httpClient.Do(req)
			}
		}()
	}
}

func (cm *CacheManager) FindCachedFile(url, mediaFormat, quality string) (string, bool) {
	prefix := GenerateCacheKey(url, mediaFormat, quality)
	entries, err := os.ReadDir(cm.downloadDir)
	if err != nil {
		return "", false
	}

	now := time.Now()
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if strings.HasPrefix(name, prefix) {
			info, err := entry.Info()
			if err == nil {
				if now.Sub(info.ModTime()) < DefaultCacheTTL {
					return name, true
				}
			}
		}
	}
	return "", false
}

func (cm *CacheManager) CleanupExpiredFiles() (int, int64) {
	entries, err := os.ReadDir(cm.downloadDir)
	if err != nil {
		return 0, 0
	}

	deletedCount := 0
	var freedBytes int64 = 0
	now := time.Now()

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}

		if now.Sub(info.ModTime()) > DefaultCacheTTL {
			fullPath := filepath.Join(cm.downloadDir, entry.Name())
			freedBytes += info.Size()
			_ = os.Remove(fullPath)
			deletedCount++
		}
	}

	if deletedCount > 0 {
		log.Printf("🧹 [CACHE CLEANUP] Đã tự động xóa %d file hết hạn 5 phút (Giải phóng %.2f MB)", deletedCount, float64(freedBytes)/(1024*1024))
	}

	return deletedCount, freedBytes
}

func (cm *CacheManager) startBackgroundCleanup(interval time.Duration) {
	ticker := time.NewTicker(interval)
	for range ticker.C {
		cm.CleanupExpiredFiles()
	}
}
