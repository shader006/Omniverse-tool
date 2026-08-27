package main

import (
	"crypto/md5"
	"encoding/hex"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	DefaultCacheTTL = 300 * time.Second // 5 phút TTL
)

type MetadataItem struct {
	Data      map[string]interface{}
	ExpiresAt time.Time
}

type CacheManager struct {
	mu            sync.RWMutex
	metadataCache map[string]MetadataItem
	downloadDir   string
}

func NewCacheManager(downloadDir string) *CacheManager {
	if downloadDir == "" {
		downloadDir = "/app/downloads"
	}
	_ = os.MkdirAll(downloadDir, 0755)

	cm := &CacheManager{
		metadataCache: make(map[string]MetadataItem),
		downloadDir:   downloadDir,
	}

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

func (cm *CacheManager) GetMetadata(key string) (map[string]interface{}, bool) {
	cm.mu.RLock()
	defer cm.mu.RUnlock()

	item, exists := cm.metadataCache[key]
	if !exists {
		return nil, false
	}

	if time.Now().After(item.ExpiresAt) {
		return nil, false
	}

	return item.Data, true
}

func (cm *CacheManager) SetMetadata(key string, data map[string]interface{}, ttl time.Duration) {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	cm.metadataCache[key] = MetadataItem{
		Data:      data,
		ExpiresAt: time.Now().Add(ttl),
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
