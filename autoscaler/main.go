package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

// ─────────────────────────────────────────────────────────────
// CẤU TRÚC DỮ LIỆU DOCKER SWARM & METRICS
// ─────────────────────────────────────────────────────────────

const (
	DockerAPIVersion = "v1.44"
	MaxResponseBytes = 5 * 1024 * 1024 // 5MB limit
	MaxConcurrentStatFetches = 8       // Giới hạn concurrency khi fetch stats
)

type ReplicatedMode struct {
	Replicas uint64 `json:"Replicas"`
}

type ServiceMode struct {
	Replicated *ReplicatedMode `json:"Replicated,omitempty"`
}

type ServiceSpec struct {
	Name         string                 `json:"Name"`
	Mode         ServiceMode            `json:"Mode"`
	TaskTemplate map[string]interface{} `json:"TaskTemplate"`
	Networks     []interface{}          `json:"Networks"`
	Endpoint     interface{}            `json:"Endpoint"`
}

type SwarmService struct {
	ID      string `json:"ID"`
	Version struct {
		Index uint64 `json:"Index"`
	} `json:"Version"`
	Spec ServiceSpec `json:"Spec"`
}

type SwarmTask struct {
	ID     string `json:"ID"`
	Status struct {
		State           string `json:"State"`
		ContainerStatus struct {
			ContainerID string `json:"ContainerID"`
		} `json:"ContainerStatus"`
	} `json:"Status"`
	DesiredState string `json:"DesiredState"`
}

type DockerCPUStats struct {
	CPUStats struct {
		CPUUsage struct {
			TotalUsage uint64 `json:"total_usage"`
		} `json:"cpu_usage"`
		SystemCPUUsage uint64 `json:"system_cpu_usage"`
		OnlineCPUs     uint64 `json:"online_cpus"`
	} `json:"cpu_stats"`
	PreCPUStats struct {
		CPUUsage struct {
			TotalUsage uint64 `json:"total_usage"`
		} `json:"cpu_usage"`
		SystemCPUUsage uint64 `json:"system_cpu_usage"`
	} `json:"precpu_stats"`
}

type ServiceScaleConfig struct {
	ServiceName    string
	MinReplicas    uint64
	MaxReplicas    uint64
	CPUScaleUp     float64
	CPUScaleDown   float64
	IntervalSec    int
	ScaleUpStreak  int
	ScaleDownStreak int
}

type ScalingDecision int

const (
	DecisionNone ScalingDecision = iota
	DecisionScaleUp
	DecisionScaleDown
)

type CPUMetrics struct {
	AvgCPU              float64
	MaxCPU              float64
	CPUDistributionP95  float64
	EffectiveCPU        float64 // Metric tổng hợp bảo vệ điểm nghẽn (bottleneck protection)
	ValidSamples        int
}

// ─────────────────────────────────────────────────────────────
// TIỆN ÍCH MÔI TRƯỜNG VÀ HTTP CLIENT
// ─────────────────────────────────────────────────────────────

func newDockerUnixClient() *http.Client {
	return &http.Client{
		Transport: &http.Transport{
			DialContext: func(_ context.Context, _, _ string) (net.Conn, error) {
				return net.Dial("unix", "/var/run/docker.sock")
			},
		},
		Timeout: 10 * time.Second,
	}
}

func getEnv(key, defaultVal string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultVal
}

func getEnvFloat(key string, defaultVal float64) float64 {
	if val := os.Getenv(key); val != "" {
		if f, err := strconv.ParseFloat(val, 64); err == nil {
			return f
		}
	}
	return defaultVal
}

func getEnvInt(key string, defaultVal int) int {
	if val := os.Getenv(key); val != "" {
		if i, err := strconv.Atoi(val); err == nil {
			return i
		}
	}
	return defaultVal
}

func getEnvBool(key string, defaultVal bool) bool {
	if val := os.Getenv(key); val != "" {
		low := strings.ToLower(strings.TrimSpace(val))
		return low == "true" || low == "1" || low == "yes"
	}
	return defaultVal
}

// ─────────────────────────────────────────────────────────────
// 1. TÍNH TOÁN CPU CHÍNH XÁC (MONOTONIC CHECK, KHÔNG BỎ SAMPLE HỢP LỆ)
// ─────────────────────────────────────────────────────────────

// calculateCPUPercent tính % CPU chuẩn xác từ stats của Docker
func calculateCPUPercent(stats *DockerCPUStats) (float64, bool) {
	if stats == nil {
		return 0.0, false
	}

	cpuDelta := float64(stats.CPUStats.CPUUsage.TotalUsage) - float64(stats.PreCPUStats.CPUUsage.TotalUsage)
	systemDelta := float64(stats.CPUStats.SystemCPUUsage) - float64(stats.PreCPUStats.SystemCPUUsage)

	// systemDelta phải tăng và cpuUsage không được giảm
	if systemDelta <= 0 || cpuDelta < 0 {
		return 0.0, false
	}

	onlineCPUs := float64(stats.CPUStats.OnlineCPUs)
	if onlineCPUs == 0 {
		onlineCPUs = 1
	}

	percent := (cpuDelta / systemDelta) * onlineCPUs * 100.0
	if percent < 0 {
		percent = 0
	}

	return percent, true
}

// calculateCPUMetrics tính toán Avg, Max, P95 và Effective CPU
func calculateCPUMetrics(samples []float64) CPUMetrics {
	n := len(samples)
	if n == 0 {
		return CPUMetrics{}
	}

	var sum, maxVal float64
	sorted := make([]float64, n)
	copy(sorted, samples)
	sort.Float64s(sorted)

	for _, v := range sorted {
		sum += v
		if v > maxVal {
			maxVal = v
		}
	}

	avg := sum / float64(n)

	// Tính P95 phân phối giữa các containers
	p95Idx := int(math.Ceil(0.95*float64(n))) - 1
	if p95Idx < 0 {
		p95Idx = 0
	}
	if p95Idx >= n {
		p95Idx = n - 1
	}
	p95 := sorted[p95Idx]

	// Effective CPU: Kết hợp Avg và Max để bảo vệ khỏi điểm nghẽn 1 container đơn lẻ
	effective := math.Max(avg, maxVal*0.95)

	return CPUMetrics{
		AvgCPU:             avg,
		MaxCPU:             maxVal,
		CPUDistributionP95: p95,
		EffectiveCPU:       effective,
		ValidSamples:       n,
	}
}

// evaluateScalingDecision quyết định hành động Scale
func evaluateScalingDecision(metrics CPUMetrics, cfg ServiceScaleConfig, currentReplicas uint64) ScalingDecision {
	if metrics.ValidSamples == 0 {
		return DecisionNone
	}

	// 1. Điều kiện Scale Up: Nếu EffectiveCPU hoặc MaxCPU của bất kỳ container nào vượt ngưỡng
	if (metrics.EffectiveCPU >= cfg.CPUScaleUp || metrics.MaxCPU >= cfg.CPUScaleUp) && currentReplicas < cfg.MaxReplicas {
		return DecisionScaleUp
	}

	// 2. Điều kiện Scale Down: CHỈ Scale Down khi CẢ MaxCPU và AvgCPU đều dưới ngưỡng an toàn
	if metrics.MaxCPU <= cfg.CPUScaleDown && metrics.AvgCPU <= cfg.CPUScaleDown && currentReplicas > cfg.MinReplicas {
		return DecisionScaleDown
	}

	return DecisionNone
}

// ─────────────────────────────────────────────────────────────
// 2. SO KHỚP SERVICE AN TOÀN (EXACT MATCH HOẶC STACK PREFIX)
// ─────────────────────────────────────────────────────────────

func matchesServiceName(actualName, targetName string) bool {
	return actualName == targetName || strings.HasSuffix(actualName, "_"+targetName)
}

// ─────────────────────────────────────────────────────────────
// 3. PARSE CONFIG & DEDUPLICATION
// ─────────────────────────────────────────────────────────────

func parseServicesConfig() []ServiceScaleConfig {
	raw := getEnv("SERVICES_CONFIG", "")
	var configs []ServiceScaleConfig
	seenServices := make(map[string]bool)

	upStreak := getEnvInt("SCALE_UP_STREAK", 2)
	downStreak := getEnvInt("SCALE_DOWN_STREAK", 4)

	if raw != "" {
		items := strings.Split(raw, ",")
		for _, item := range items {
			item = strings.TrimSpace(item)
			if item == "" {
				continue
			}
			parts := strings.Split(item, ":")
			if len(parts) >= 1 {
				name := strings.TrimSpace(parts[0])
				if name == "" {
					continue
				}

				if seenServices[name] {
					log.Printf("⚠️ [AUTOSCALER CONFIG] Bỏ qua cấu hình trùng lặp cho Service '%s'", name)
					continue
				}

				minR := uint64(1)
				maxR := uint64(5)
				up := 65.0
				down := 20.0
				interval := 8

				if len(parts) >= 2 {
					if v, err := strconv.ParseUint(parts[1], 10, 64); err == nil {
						minR = v
					}
				}
				if len(parts) >= 3 {
					if v, err := strconv.ParseUint(parts[2], 10, 64); err == nil {
						maxR = v
					}
				}
				if len(parts) >= 4 {
					if v, err := strconv.ParseFloat(parts[3], 64); err == nil {
						up = v
					}
				}
				if len(parts) >= 5 {
					if v, err := strconv.ParseFloat(parts[4], 64); err == nil {
						down = v
					}
				}
				if len(parts) >= 6 {
					if v, err := strconv.Atoi(parts[5]); err == nil && v > 0 {
						interval = v
					}
				}

				seenServices[name] = true
				configs = append(configs, ServiceScaleConfig{
					ServiceName:     name,
					MinReplicas:     minR,
					MaxReplicas:     maxR,
					CPUScaleUp:      up,
					CPUScaleDown:    down,
					IntervalSec:     interval,
					ScaleUpStreak:   upStreak,
					ScaleDownStreak: downStreak,
				})
			}
		}
	}

	if len(configs) == 0 {
		swarmServices := getEnv("SWARM_SERVICES", "")
		if swarmServices != "" {
			for _, s := range strings.Split(swarmServices, ",") {
				name := strings.TrimSpace(s)
				if name == "" || seenServices[name] {
					continue
				}
				seenServices[name] = true
				configs = append(configs, ServiceScaleConfig{
					ServiceName:     name,
					MinReplicas:     uint64(getEnvInt("MIN_REPLICAS", 1)),
					MaxReplicas:     uint64(getEnvInt("MAX_REPLICAS", 5)),
					CPUScaleUp:      getEnvFloat("CPU_SCALE_UP", 65.0),
					CPUScaleDown:    getEnvFloat("CPU_SCALE_DOWN", 20.0),
					IntervalSec:     getEnvInt("CHECK_INTERVAL", 8),
					ScaleUpStreak:   upStreak,
					ScaleDownStreak: downStreak,
				})
			}
		}
	}

	if len(configs) == 0 {
		defaultName := getEnv("SWARM_SERVICE_NAME", "omniverse_app")
		configs = append(configs, ServiceScaleConfig{
			ServiceName:     defaultName,
			MinReplicas:     uint64(getEnvInt("MIN_REPLICAS", 1)),
			MaxReplicas:     uint64(getEnvInt("MAX_REPLICAS", 5)),
			CPUScaleUp:      getEnvFloat("CPU_SCALE_UP", 65.0),
			CPUScaleDown:    getEnvFloat("CPU_SCALE_DOWN", 20.0),
			IntervalSec:     getEnvInt("CHECK_INTERVAL", 8),
			ScaleUpStreak:   upStreak,
			ScaleDownStreak: downStreak,
		})
	}

	return configs
}

// ─────────────────────────────────────────────────────────────
// 4. MONITOR LOOP VỚI CONCURRENT STATS VÀ GRACEFUL SHUTDOWN
// ─────────────────────────────────────────────────────────────

func monitorAndScaleService(ctx context.Context, client *http.Client, cfg ServiceScaleConfig) {
	log.Printf("🚀 [AUTOSCALER] Bắt đầu theo dõi Service: '%s' | Min=%d | Max=%d | ScaleUp>%.1f%% | ScaleDown<%.1f%% | Chu kỳ=%ds",
		cfg.ServiceName, cfg.MinReplicas, cfg.MaxReplicas, cfg.CPUScaleUp, cfg.CPUScaleDown, cfg.IntervalSec)

	ticker := time.NewTicker(time.Duration(cfg.IntervalSec) * time.Second)
	defer ticker.Stop()

	highCPUStreak := 0
	lowCPUStreak := 0

	var lastScaleTime time.Time
	const scaleUpCooldown = 20 * time.Second
	const scaleDownCooldown = 40 * time.Second

	for {
		select {
		case <-ctx.Done():
			log.Printf("🛑 [AUTOSCALER] Dừng theo dõi Service '%s' (Shutdown)", cfg.ServiceName)
			return
		case <-ticker.C:
		}

		// 1. Lấy danh sách Services từ Docker
		servicesURL := fmt.Sprintf("http://localhost/%s/services", DockerAPIVersion)
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, servicesURL, nil)
		if err != nil {
			continue
		}

		resp, err := client.Do(req)
		if err != nil {
			log.Printf("⚠️ [%s] Lỗi truy vấn Docker Services: %v", cfg.ServiceName, err)
			continue
		}

		var services []SwarmService
		err = json.NewDecoder(io.LimitReader(resp.Body, MaxResponseBytes)).Decode(&services)
		resp.Body.Close()
		if err != nil {
			log.Printf("⚠️ [%s] Lỗi giải mã JSON Services: %v", cfg.ServiceName, err)
			continue
		}

		var target *SwarmService
		for i := range services {
			if matchesServiceName(services[i].Spec.Name, cfg.ServiceName) {
				target = &services[i]
				break
			}
		}

		if target == nil {
			continue
		}

		if target.Spec.Mode.Replicated == nil {
			// Service ở chế độ Global, không hỗ trợ điều chỉnh replicas
			continue
		}

		currentReplicas := target.Spec.Mode.Replicated.Replicas

		// 2. Lấy danh sách tasks đang chạy
		taskURL := fmt.Sprintf("http://localhost/%s/tasks?filters=%s",
			DockerAPIVersion,
			url.QueryEscape(fmt.Sprintf(`{"service":["%s"],"desired-state":["running"]}`, target.ID)))

		tReq, err := http.NewRequestWithContext(ctx, http.MethodGet, taskURL, nil)
		if err != nil {
			continue
		}

		resp, err = client.Do(tReq)
		if err != nil {
			log.Printf("⚠️ [%s] Lỗi truy vấn Docker Tasks: %v", cfg.ServiceName, err)
			continue
		}

		var tasks []SwarmTask
		err = json.NewDecoder(io.LimitReader(resp.Body, MaxResponseBytes)).Decode(&tasks)
		resp.Body.Close()
		if err != nil {
			log.Printf("⚠️ [%s] Lỗi parse tasks: %v", cfg.ServiceName, err)
			continue
		}

		// 3. Thu thập stats song song (Bounded Concurrency với Semaphore)
		var cpuSamples []float64
		var mu sync.Mutex
		var wg sync.WaitGroup
		sem := make(chan struct{}, MaxConcurrentStatFetches)

		for _, t := range tasks {
			cid := t.Status.ContainerStatus.ContainerID
			if cid == "" {
				continue
			}

			wg.Add(1)
			go func(containerID string) {
				defer wg.Done()
				sem <- struct{}{}
				defer func() { <-sem }()

				statURL := fmt.Sprintf("http://localhost/%s/containers/%s/stats?stream=false", DockerAPIVersion, containerID)
				sReq, err := http.NewRequestWithContext(ctx, http.MethodGet, statURL, nil)
				if err != nil {
					return
				}

				sResp, sErr := client.Do(sReq)
				if sErr != nil {
					return
				}

				var cStats DockerCPUStats
				decodeErr := json.NewDecoder(io.LimitReader(sResp.Body, MaxResponseBytes)).Decode(&cStats)
				sResp.Body.Close()

				if decodeErr == nil {
					if cpuP, valid := calculateCPUPercent(&cStats); valid {
						mu.Lock()
						cpuSamples = append(cpuSamples, cpuP)
						mu.Unlock()
					}
				}
			}(cid)
		}
		wg.Wait()

		metrics := calculateCPUMetrics(cpuSamples)
		log.Printf("📊 [%s] Replicas: %d/%d | Containers: %d | Avg: %.1f%% | Max: %.1f%% | P95: %.1f%% | Effective: %.1f%%",
			cfg.ServiceName, currentReplicas, cfg.MaxReplicas, metrics.ValidSamples, metrics.AvgCPU, metrics.MaxCPU, metrics.CPUDistributionP95, metrics.EffectiveCPU)

		decision := evaluateScalingDecision(metrics, cfg, currentReplicas)

		// 4. Ra quyết định Scale với Timestamp Cooldown (Non-blocking)
		now := time.Now()
		switch decision {
		case DecisionScaleUp:
			highCPUStreak++
			lowCPUStreak = 0

			if highCPUStreak >= cfg.ScaleUpStreak {
				if now.Sub(lastScaleTime) < scaleUpCooldown {
					log.Printf("⏳ [%s SCALE UP COOLDOWN] Đang trong thời gian cooldown sau lần scale trước (còn %v)",
						cfg.ServiceName, scaleUpCooldown-now.Sub(lastScaleTime))
					continue
				}

				newReplicas := currentReplicas + 1
				if newReplicas > cfg.MaxReplicas {
					newReplicas = cfg.MaxReplicas
				}

				log.Printf("🚀 [%s SCALE UP] CPU cao (Max=%.1f%%, Avg=%.1f%% >= %.1f%%) ➔ Tăng từ %d ➔ %d Replicas!",
					cfg.ServiceName, metrics.MaxCPU, metrics.AvgCPU, cfg.CPUScaleUp, currentReplicas, newReplicas)

				scaleServiceWithRetry(ctx, client, target, newReplicas, 2)
				lastScaleTime = time.Now()
				highCPUStreak = 0
			}

		case DecisionScaleDown:
			lowCPUStreak++
			highCPUStreak = 0

			if lowCPUStreak >= cfg.ScaleDownStreak {
				if now.Sub(lastScaleTime) < scaleDownCooldown {
					log.Printf("⏳ [%s SCALE DOWN COOLDOWN] Đang trong thời gian cooldown sau lần scale trước (còn %v)",
						cfg.ServiceName, scaleDownCooldown-now.Sub(lastScaleTime))
					continue
				}

				newReplicas := currentReplicas - 1
				if newReplicas < cfg.MinReplicas {
					newReplicas = cfg.MinReplicas
				}

				log.Printf("📉 [%s SCALE DOWN] CPU nhàn rỗi (Max=%.1f%% <= %.1f%%) ➔ Giảm từ %d ➔ %d Replicas.",
					cfg.ServiceName, metrics.MaxCPU, cfg.CPUScaleDown, currentReplicas, newReplicas)

				scaleServiceWithRetry(ctx, client, target, newReplicas, 2)
				lastScaleTime = time.Now()
				lowCPUStreak = 0
			}

		default:
			highCPUStreak = 0
			lowCPUStreak = 0
		}
	}
}

// scaleServiceWithRetry thực hiện cập nhật Replicas với cơ chế Retry khi gặp 409 Conflict
func scaleServiceWithRetry(ctx context.Context, client *http.Client, service *SwarmService, newReplicas uint64, maxRetries int) {
	if service == nil || service.Spec.Mode.Replicated == nil {
		return
	}

	for attempt := 0; attempt <= maxRetries; attempt++ {
		inspectURL := fmt.Sprintf("http://localhost/%s/services/%s", DockerAPIVersion, service.ID)
		iReq, err := http.NewRequestWithContext(ctx, http.MethodGet, inspectURL, nil)
		if err == nil {
			resp, rErr := client.Do(iReq)
			if rErr == nil && resp.StatusCode == http.StatusOK {
				var latestService SwarmService
				if json.NewDecoder(io.LimitReader(resp.Body, MaxResponseBytes)).Decode(&latestService) == nil {
					service.Version = latestService.Version
					service.Spec = latestService.Spec
				}
				resp.Body.Close()
			}
		}

		if service.Spec.Mode.Replicated == nil {
			return
		}
		service.Spec.Mode.Replicated.Replicas = newReplicas

		updatePayload, err := json.Marshal(service.Spec)
		if err != nil {
			log.Printf("❌ [%s] Lỗi mã hóa JSON Spec: %v", service.Spec.Name, err)
			return
		}

		updateURL := fmt.Sprintf("http://localhost/%s/services/%s/update?version=%d", DockerAPIVersion, service.ID, service.Version.Index)
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, updateURL, bytes.NewReader(updatePayload))
		if err != nil {
			return
		}
		req.Header.Set("Content-Type", "application/json")

		uResp, err := client.Do(req)
		if err != nil {
			log.Printf("❌ [%s] Lỗi gọi Swarm Update API: %v", service.Spec.Name, err)
			return
		}

		statusCode := uResp.StatusCode
		uResp.Body.Close()

		if statusCode == http.StatusOK || statusCode == http.StatusAccepted {
			log.Printf("✅ [%s] Scale thành công lên %d Replicas! (Version Index: %d)",
				service.Spec.Name, newReplicas, service.Version.Index)
			return
		}

		if statusCode == http.StatusConflict && attempt < maxRetries {
			log.Printf("⚠️ [%s] Gặp 409 Conflict (version mismatch), đang refresh và thử lại lần %d...", service.Spec.Name, attempt+1)
			time.Sleep(200 * time.Millisecond)
			continue
		}

		log.Printf("❌ [%s] Swarm Update API thất bại (Status %d)", service.Spec.Name, statusCode)
		return
	}
}

// ─────────────────────────────────────────────────────────────
// 5. DOCKER AUTO-PRUNE (GARBAGE COLLECTOR)
// ─────────────────────────────────────────────────────────────

func startDockerAutoPruner(ctx context.Context, client *http.Client, interval time.Duration) {
	log.Printf("🧹 [DOCKER GC] Khởi động chế độ tự động dọn dẹp (Chu kỳ: %v)...", interval)

	runPrune := func() {
		log.Println("🧹 [DOCKER GC] Bắt đầu quét và dọn dẹp tài nguyên Docker dư thừa...")
		var totalFreed int64

		// 1. Dọn dẹp Stopped Containers
		containerPruneURL := fmt.Sprintf("http://localhost/%s/containers/prune", DockerAPIVersion)
		if req, err := http.NewRequestWithContext(ctx, http.MethodPost, containerPruneURL, nil); err == nil {
			if resp, err := client.Do(req); err == nil {
				var cRes struct {
					ContainersDeleted []string `json:"ContainersDeleted"`
					SpaceReclaimed    int64    `json:"SpaceReclaimed"`
				}
				if json.NewDecoder(io.LimitReader(resp.Body, MaxResponseBytes)).Decode(&cRes) == nil && len(cRes.ContainersDeleted) > 0 {
					totalFreed += cRes.SpaceReclaimed
					log.Printf("  • Đã xóa %d stopped containers (Giải phóng %.2f MB)",
						len(cRes.ContainersDeleted), float64(cRes.SpaceReclaimed)/(1024*1024))
				}
				resp.Body.Close()
			}
		}

		// 2. Dọn dẹp Unused Images
		imagePruneURL := fmt.Sprintf("http://localhost/%s/images/prune?filters=%s",
			DockerAPIVersion, url.QueryEscape(`{"dangling":["false"]}`))
		if req, err := http.NewRequestWithContext(ctx, http.MethodPost, imagePruneURL, nil); err == nil {
			if resp, err := client.Do(req); err == nil {
				var iRes struct {
					ImagesDeleted  []interface{} `json:"ImagesDeleted"`
					SpaceReclaimed int64         `json:"SpaceReclaimed"`
				}
				if json.NewDecoder(io.LimitReader(resp.Body, MaxResponseBytes)).Decode(&iRes) == nil && len(iRes.ImagesDeleted) > 0 {
					totalFreed += iRes.SpaceReclaimed
					log.Printf("  • Đã xóa %d unused images (Giải phóng %.2f MB)",
						len(iRes.ImagesDeleted), float64(iRes.SpaceReclaimed)/(1024*1024))
				}
				resp.Body.Close()
			}
		}

		// 3. Dọn dẹp Build Cache
		if getEnvBool("PRUNE_BUILD_CACHE", false) {
			buildPruneURL := fmt.Sprintf("http://localhost/%s/build/prune?filters=%s&keep-storage=%d",
				DockerAPIVersion, url.QueryEscape(`{"until":["48h"]}`), int64(5*1024*1024*1024))

			if req, err := http.NewRequestWithContext(ctx, http.MethodPost, buildPruneURL, nil); err == nil {
				if resp, err := client.Do(req); err == nil {
					var bRes struct {
						CachesDeleted  []string `json:"CachesDeleted"`
						SpaceReclaimed int64    `json:"SpaceReclaimed"`
					}
					if json.NewDecoder(io.LimitReader(resp.Body, MaxResponseBytes)).Decode(&bRes) == nil && len(bRes.CachesDeleted) > 0 {
						totalFreed += bRes.SpaceReclaimed
						log.Printf("  • Đã xóa %d old build cache layers (Giải phóng %.2f MB)",
							len(bRes.CachesDeleted), float64(bRes.SpaceReclaimed)/(1024*1024))
					}
					resp.Body.Close()
				}
			}
		}

		log.Printf("✨ [DOCKER GC] Hoàn tất dọn dẹp! Tổng dung lượng giải phóng: %.2f MB", float64(totalFreed)/(1024*1024))
	}

	// Chạy prune ban đầu sau 10s khởi động
	select {
	case <-time.After(10 * time.Second):
		runPrune()
	case <-ctx.Done():
		return
	}

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			runPrune()
		}
	}
}

// ─────────────────────────────────────────────────────────────
// 6. MAIN & GRACEFUL SHUTDOWN
// ─────────────────────────────────────────────────────────────

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	configs := parseServicesConfig()
	client := newDockerUnixClient()

	log.Printf("⚡ [GOLANG MULTI-SERVICE AUTOSCALER] Khởi động với %d services được quản lý.", len(configs))

	pruneHours := getEnvInt("AUTO_PRUNE_INTERVAL_HOURS", 6)
	go startDockerAutoPruner(ctx, client, time.Duration(pruneHours)*time.Hour)

	var wg sync.WaitGroup
	for _, cfg := range configs {
		wg.Add(1)
		go func(c ServiceScaleConfig) {
			defer wg.Done()
			monitorAndScaleService(ctx, client, c)
		}(cfg)
	}

	<-ctx.Done()
	log.Println("📢 [AUTOSCALER] Nhận tín hiệu dừng, đang tắt các worker và thoát an toàn...")
	wg.Wait()
	log.Println("✅ [AUTOSCALER] Đã dừng hoàn tất.")
}
