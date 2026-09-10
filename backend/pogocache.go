package main

import (
	"bufio"
	"context"
	"crypto/md5"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	DefaultCacheTTL = 3600 * time.Second // 1 giờ TTL cho File kết quả hoàn tất (tránh mất file khi Job State còn lưu 2 giờ)
	TempFileTTL     = 1800 * time.Second // 30 phút TTL cho file tạm dở dang
	JobTTLSeconds   = 7200               // 2 giờ TTL cho Job State
)

// RESP Protocol Helper: Gửi command RESP sang Pogocache (https://pogocache.com)
func encodeRESPCommand(args ...string) []byte {
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("*%d\r\n", len(args)))
	for _, arg := range args {
		sb.WriteString(fmt.Sprintf("$%d\r\n%s\r\n", len(arg), arg))
	}
	return []byte(sb.String())
}

// Đọc phản hồi RESP từ Pogocache
func readRESPResponse(reader *bufio.Reader) (interface{}, error) {
	line, err := reader.ReadString('\n')
	if err != nil {
		return nil, err
	}
	line = strings.TrimRight(line, "\r\n")
	if len(line) == 0 {
		return nil, fmt.Errorf("phản hồi rỗng")
	}

	prefix := line[0]
	content := line[1:]

	switch prefix {
	case '+': // Simple String (e.g. +OK)
		return content, nil
	case '-': // Error
		return nil, fmt.Errorf("pogocache error: %s", content)
	case ':': // Integer
		return strconv.ParseInt(content, 10, 64)
	case '$': // Bulk String
		length, err := strconv.Atoi(content)
		if err != nil {
			return nil, err
		}
		if length < 0 {
			return nil, nil // Null
		}
		buf := make([]byte, length+2)
		if _, err := io.ReadFull(reader, buf); err != nil {
			return nil, err
		}
		return string(buf[:length]), nil
	case '*': // Array
		count, err := strconv.Atoi(content)
		if err != nil {
			return nil, err
		}
		if count < 0 {
			return nil, nil
		}
		var arr []interface{}
		for i := 0; i < count; i++ {
			item, err := readRESPResponse(reader)
			if err != nil {
				return nil, err
			}
			arr = append(arr, item)
		}
		return arr, nil
	default:
		return nil, fmt.Errorf("không rõ tiền tố RESP: %c", prefix)
	}
}

// ─────────────────────────────────────────────────────────────
// POGOCACHE UNIFIED ENGINE (Job State + Metadata + File Cache)
// ─────────────────────────────────────────────────────────────
type PogocacheEngine struct {
	pogoAddr    string
	downloadDir string
	usePogo     bool

	// Fallback Local Memory Cache
	localJobs sync.Map
	localMeta sync.Map
	localSubs sync.Map
	subsMu    sync.Mutex
}

type localMetaItem struct {
	data      map[string]interface{}
	expiresAt time.Time
}

func NewPogocacheEngine(pogoAddr, downloadDir string) *PogocacheEngine {
	if downloadDir == "" {
		downloadDir = "/app/downloads"
	}
	_ = os.MkdirAll(downloadDir, 0755)

	engine := &PogocacheEngine{
		pogoAddr:    pogoAddr,
		downloadDir: downloadDir,
		usePogo:     false,
	}

	if pogoAddr != "" {
		conn, err := net.DialTimeout("tcp", pogoAddr, 2*time.Second)
		if err == nil {
			_ = conn.Close()
			engine.usePogo = true
			log.Printf("🚀 [POGOCACHE UNIFIED ENGINE] Kết nối thành công tới Pogocache tại %s", pogoAddr)
		} else {
			log.Printf("⚠️ [POGOCACHE UNIFIED ENGINE] Không kết nối được Pogocache (%s: %v), fallback sang Local Memory", pogoAddr, err)
		}
	} else {
		log.Printf("ℹ️ [POGOCACHE UNIFIED ENGINE] Chạy chế độ Local Memory (không cấu hình POGOCACHE_ADDR)")
	}

	// Tự động kích hoạt dọn dẹp ổ đĩa định kỳ 60 giây
	go engine.startBackgroundDiskCleanup(60 * time.Second)

	return engine
}

func (pe *PogocacheEngine) execPogoCommand(args ...string) (interface{}, error) {
	conn, err := net.DialTimeout("tcp", pe.pogoAddr, 2*time.Second)
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	_ = conn.SetDeadline(time.Now().Add(2 * time.Second))
	payload := encodeRESPCommand(args...)
	if _, err := conn.Write(payload); err != nil {
		return nil, err
	}

	reader := bufio.NewReader(conn)
	return readRESPResponse(reader)
}

// ── 1. QUẢN LÝ JOB STATE & SSE PROGRESS ──

func (pe *PogocacheEngine) SaveJob(job Job) {
	pe.localJobs.Store(job.JobID, job)

	if pe.usePogo {
		data, err := json.Marshal(job)
		if err == nil {
			_, _ = pe.execPogoCommand("SETEX", fmt.Sprintf("job:%s", job.JobID), strconv.Itoa(JobTTLSeconds), string(data))
		}
	}
}

func (pe *PogocacheEngine) GetJob(jobID string) (Job, bool) {
	if pe.usePogo {
		res, err := pe.execPogoCommand("GET", fmt.Sprintf("job:%s", jobID))
		if err == nil && res != nil {
			if strVal, ok := res.(string); ok && strVal != "" {
				var job Job
				if json.Unmarshal([]byte(strVal), &job) == nil {
					pe.localJobs.Store(jobID, job)
					return job, true
				}
			}
		}
	}

	if val, ok := pe.localJobs.Load(jobID); ok {
		return val.(Job), true
	}

	return Job{}, false
}

func (pe *PogocacheEngine) PublishJobUpdate(job Job) {
	pe.SaveJob(job)

	pe.subsMu.Lock()
	if subs, ok := pe.localSubs.Load(job.JobID); ok {
		channels := subs.([]chan Job)
		for _, ch := range channels {
			select {
			case ch <- job:
			default:
			}
		}
	}
	pe.subsMu.Unlock()
}

func (pe *PogocacheEngine) SubscribeJob(ctx context.Context, jobID string) (<-chan Job, func()) {
	outCh := make(chan Job, 20)

	pe.subsMu.Lock()
	var current []chan Job
	if val, ok := pe.localSubs.Load(jobID); ok {
		current = val.([]chan Job)
	}
	pe.localSubs.Store(jobID, append(current, outCh))
	pe.subsMu.Unlock()

	cleanup := func() {
		pe.subsMu.Lock()
		defer pe.subsMu.Unlock()
		if val, ok := pe.localSubs.Load(jobID); ok {
			channels := val.([]chan Job)
			var updated []chan Job
			for _, ch := range channels {
				if ch != outCh {
					updated = append(updated, ch)
				}
			}
			if len(updated) == 0 {
				pe.localSubs.Delete(jobID)
			} else {
				pe.localSubs.Store(jobID, updated)
			}
		}
	}

	return outCh, cleanup
}

// ── 2. QUẢN LÝ METADATA CACHE (/api/info) ──

func (pe *PogocacheEngine) GetMetadata(key string) (map[string]interface{}, bool) {
	// Kiểm tra Pogocache
	if pe.usePogo {
		res, err := pe.execPogoCommand("GET", fmt.Sprintf("meta:%s", key))
		if err == nil && res != nil {
			if strVal, ok := res.(string); ok && strVal != "" {
				var data map[string]interface{}
				if json.Unmarshal([]byte(strVal), &data) == nil {
					pe.localMeta.Store(key, localMetaItem{data: data, expiresAt: time.Now().Add(DefaultCacheTTL)})
					return data, true
				}
			}
		}
	}

	// Kiểm tra Local Memory Fallback
	if val, ok := pe.localMeta.Load(key); ok {
		item := val.(localMetaItem)
		if time.Now().Before(item.expiresAt) {
			return item.data, true
		}
	}

	return nil, false
}

func (pe *PogocacheEngine) SetMetadata(key string, data map[string]interface{}, ttl time.Duration) {
	pe.localMeta.Store(key, localMetaItem{data: data, expiresAt: time.Now().Add(ttl)})

	if pe.usePogo {
		bytesData, err := json.Marshal(data)
		if err == nil {
			_, _ = pe.execPogoCommand("SETEX", fmt.Sprintf("meta:%s", key), strconv.Itoa(int(ttl.Seconds())), string(bytesData))
		}
	}
}

// ── 3. QUẢN LÝ FILE CACHE & DỌN DẸP Ổ ĐĨA ──

// CleanURLKey chuẩn hóa URL YouTube (loại bỏ playlist, tracking params) để khớp chính xác với Python
func CleanURLKey(rawURL string) string {
	rawURL = strings.TrimSpace(rawURL)
	u, err := url.Parse(rawURL)
	if err != nil {
		return rawURL
	}
	if strings.Contains(u.Host, "youtube.com") || strings.Contains(u.Host, "youtu.be") {
		v := u.Query().Get("v")
		if v != "" {
			return "https://www.youtube.com/watch?v=" + v
		}
		if strings.Contains(u.Host, "youtu.be") {
			path := strings.TrimPrefix(u.Path, "/")
			if path != "" {
				return "https://www.youtube.com/watch?v=" + path
			}
		}
	}
	return rawURL
}

func GenerateCacheKey(rawURL, mediaFormat, quality string) string {
	cleaned := CleanURLKey(rawURL)
	raw := fmt.Sprintf("%s_%s_%s", cleaned, strings.ToLower(mediaFormat), quality)
	hasher := md5.New()
	hasher.Write([]byte(raw))
	return hex.EncodeToString(hasher.Sum(nil))[:10]
}

func (pe *PogocacheEngine) FindCachedFile(rawURL, mediaFormat, quality string) (string, bool) {
	prefixMD5 := GenerateCacheKey(rawURL, mediaFormat, quality)
	
	// Khóa SHA256 dự phòng để tương thích ngược
	rawSha := fmt.Sprintf("%s_%s_%s", strings.TrimSpace(rawURL), strings.ToLower(mediaFormat), quality)
	hSha := sha256.New()
	hSha.Write([]byte(rawSha))
	prefixSha := hex.EncodeToString(hSha.Sum(nil))[:12]

	entries, err := os.ReadDir(pe.downloadDir)
	if err != nil {
		return "", false
	}

	now := time.Now()
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if strings.HasPrefix(name, prefixMD5) || strings.HasPrefix(name, prefixSha) {
			// Bỏ qua file tạm hoặc không đúng định dạng
			lowerName := strings.ToLower(name)
			if strings.HasSuffix(lowerName, ".part") || strings.HasSuffix(lowerName, ".ytdl") {
				continue
			}
			targetExt := "." + strings.ToLower(mediaFormat)
			if !strings.HasSuffix(lowerName, targetExt) {
				continue
			}
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

func (pe *PogocacheEngine) CleanupExpiredFiles() (int, int64) {
	entries, err := os.ReadDir(pe.downloadDir)
	if err != nil {
		return 0, 0
	}

	deletedCount := 0
	var freedBytes int64 = 0
	now := time.Now()

	// Thu thập danh sách file đang được xử lý bởi các active Job
	activeFiles := make(map[string]bool)
	pe.localJobs.Range(func(key, value interface{}) bool {
		if j, ok := value.(Job); ok {
			if j.Status == "downloading" || j.Status == "queued" {
				if j.Filename != "" {
					activeFiles[j.Filename] = true
				}
			}
		}
		return true
	})

	for _, entry := range entries {
		// Xử lý dọn dẹp thư mục tmp/ riêng biệt
		if entry.IsDir() {
			if entry.Name() == "tmp" {
				tmpDir := filepath.Join(pe.downloadDir, "tmp")
				if tmpEntries, err := os.ReadDir(tmpDir); err == nil {
					for _, te := range tmpEntries {
						if te.IsDir() {
							continue
						}
						if tInfo, err := te.Info(); err == nil {
							if now.Sub(tInfo.ModTime()) > TempFileTTL {
								fullTmpPath := filepath.Join(tmpDir, te.Name())
								freedBytes += tInfo.Size()
								_ = os.Remove(fullTmpPath)
								deletedCount++
							}
						}
					}
				}
			}
			continue
		}

		info, err := entry.Info()
		if err != nil {
			continue
		}

		// Không xóa file của các tác vụ đang tải dở hoặc đang được xử lý
		if activeFiles[entry.Name()] {
			continue
		}

		name := entry.Name()
		isPartial := strings.HasSuffix(name, ".part") || strings.HasSuffix(name, ".ytdl") || strings.HasSuffix(name, ".tmp")

		// File tải dở chỉ dọn sau TempFileTTL (30 phút) nếu bị bỏ rơi
		if isPartial {
			if now.Sub(info.ModTime()) > TempFileTTL {
				fullPath := filepath.Join(pe.downloadDir, name)
				freedBytes += info.Size()
				_ = os.Remove(fullPath)
				deletedCount++
			}
			continue
		}

		// File kết quả hoàn tất lưu trữ đủ DefaultCacheTTL (1 giờ)
		if now.Sub(info.ModTime()) > DefaultCacheTTL {
			fullPath := filepath.Join(pe.downloadDir, name)
			freedBytes += info.Size()
			_ = os.Remove(fullPath)
			deletedCount++
		}
	}

	if deletedCount > 0 {
		log.Printf("🧹 [DISK CLEANUP] Đã tự động dọn dẹp %d file hết hạn (Giải phóng %.2f MB)", deletedCount, float64(freedBytes)/(1024*1024))
	}

	return deletedCount, freedBytes
}

func (pe *PogocacheEngine) startBackgroundDiskCleanup(interval time.Duration) {
	ticker := time.NewTicker(interval)
	for range ticker.C {
		pe.CleanupExpiredFiles()
	}
}
