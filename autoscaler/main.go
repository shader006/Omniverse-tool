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
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ─────────────────────────────────────────────────────────────
// CẤU TRÚC DỮ LIỆU DOCKER SWARM & METRICS
// ─────────────────────────────────────────────────────────────

type ServiceSpec struct {
	Name string `json:"Name"`
	Mode struct {
		Replicated struct {
			Replicas uint64 `json:"Replicas"`
		} `json:"Replicated"`
	} `json:"Mode"`
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
	ServiceName  string
	MinReplicas  uint64
	MaxReplicas  uint64
	CPUScaleUp   float64
	CPUScaleDown float64
	IntervalSec  int
}

type ScalingDecision int

const (
	DecisionNone ScalingDecision = iota
	DecisionScaleUp
	DecisionScaleDown
)

type CPUMetrics struct {
	AvgCPU       float64
	MaxCPU       float64
	P95CPU       float64
	EffectiveCPU float64 // Metric tổng hợp bảo vệ điểm nghẽn (bottleneck protection)
	ValidSamples int
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
// 1 & 2. TÍNH TOÁN CPU & XỬ LÝ EDGE CASE ZERO SAMPLE
// ─────────────────────────────────────────────────────────────

// calculateCPUPercent tính toán % CPU từ stats Docker và lọc bỏ sample không hợp lệ (first-sample zero)
func calculateCPUPercent(stats *DockerCPUStats) (float64, bool) {
	if stats == nil {
		return 0.0, false
	}

	// Kiểm tra tính hợp lệ của sample trước đó (tránh lỗi stats đầu tiên khi precpu = 0)
	if stats.PreCPUStats.SystemCPUUsage == 0 || stats.PreCPUStats.CPUUsage.TotalUsage == 0 {
		return 0.0, false
	}

	// Kiểm tra system delta phải tăng
	if stats.CPUStats.SystemCPUUsage <= stats.PreCPUStats.SystemCPUUsage {
		return 0.0, false
	}

	// Kiểm tra cpu usage không được giảm
	if stats.CPUStats.CPUUsage.TotalUsage < stats.PreCPUStats.CPUUsage.TotalUsage {
		return 0.0, false
	}

	cpuDelta := float64(stats.CPUStats.CPUUsage.TotalUsage - stats.PreCPUStats.CPUUsage.TotalUsage)
	systemDelta := float64(stats.CPUStats.SystemCPUUsage - stats.PreCPUStats.SystemCPUUsage)

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

	// Tính P95
	p95Idx := int(math.Ceil(0.95*float64(n))) - 1
	if p95Idx < 0 {
		p95Idx = 0
	}
	if p95Idx >= n {
		p95Idx = n - 1
	}
	p95 := sorted[p95Idx]

	// Effective CPU: Kết hợp Avg và Max để không bỏ sót tình huống 1 container bị nghẽn đơn lẻ
	// (Ví dụ: 1 container 90%, 2 container 10% ➔ Effective = max(36.7%, 90%*0.95) = 85.5% ➔ Kích hoạt Scale Up ngay!)
	effective := math.Max(avg, maxVal*0.95)

	return CPUMetrics{
		AvgCPU:       avg,
		MaxCPU:       maxVal,
		P95CPU:       p95,
		EffectiveCPU: effective,
		ValidSamples: n,
	}
}

// evaluateScalingDecision quyết định hành động Scale dựa trên metrics và ngưỡng cấu hình
func evaluateScalingDecision(metrics CPUMetrics, cfg ServiceScaleConfig, currentReplicas uint64) ScalingDecision {
	if metrics.ValidSamples == 0 {
		return DecisionNone
	}

	// 1. Điều kiện Scale Up:
	// Nếu EffectiveCPU (hoặc MaxCPU của bất kỳ container nào) vượt ngưỡng ScaleUp
	if (metrics.EffectiveCPU >= cfg.CPUScaleUp || metrics.MaxCPU >= cfg.CPUScaleUp) && currentReplicas < cfg.MaxReplicas {
		return DecisionScaleUp
	}

	// 2. Điều kiện Scale Down:
	// CHỈ Scale Down khi CẢ MaxCPU và AvgCPU đều nằm dưới ngưỡng an toàn (không có container nào còn bận)
	if metrics.MaxCPU <= cfg.CPUScaleDown && metrics.AvgCPU <= cfg.CPUScaleDown && currentReplicas > cfg.MinReplicas {
		return DecisionScaleDown
	}

	return DecisionNone
}

// ─────────────────────────────────────────────────────────────
// 4. DEDUPLICATION CẤU HÌNH SERVICES (CHỐNG RACE CONDITION)
// ─────────────────────────────────────────────────────────────

func parseServicesConfig() []ServiceScaleConfig {
	raw := getEnv("SERVICES_CONFIG", "")
	var configs []ServiceScaleConfig
	seenServices := make(map[string]bool)

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

				// Chống duplicate: Nếu service đã có controller thì bỏ qua
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
					ServiceName:  name,
					MinReplicas:  minR,
					MaxReplicas:  maxR,
					CPUScaleUp:   up,
					CPUScaleDown: down,
					IntervalSec:  interval,
				})
			}
		}
	}

	// Fallback nếu không truyền SERVICES_CONFIG
	if len(configs) == 0 {
		defaultName := getEnv("SWARM_SERVICE_NAME", "omniverse_app")
		configs = append(configs, ServiceScaleConfig{
			ServiceName:  defaultName,
			MinReplicas:  uint64(getEnvInt("MIN_REPLICAS", 1)),
			MaxReplicas:  uint64(getEnvInt("MAX_REPLICAS", 5)),
			CPUScaleUp:   getEnvFloat("CPU_SCALE_UP", 65.0),
			CPUScaleDown: getEnvFloat("CPU_SCALE_DOWN", 20.0),
			IntervalSec:  getEnvInt("CHECK_INTERVAL", 8),
		})
	}

	return configs
}

// ─────────────────────────────────────────────────────────────
// 3. MONITOR LOOP VỚI COOLDOWN TIMESTAMP (KHÔNG TIME.SLEEP GÂY BLOCK)
// ─────────────────────────────────────────────────────────────

func monitorAndScaleService(client *http.Client, cfg ServiceScaleConfig) {
	log.Printf("🚀 [AUTOSCALER] Bắt đầu theo dõi Service: '%s' | Min=%d | Max=%d | ScaleUp>%.1f%% | ScaleDown<%.1f%% | Chu kỳ=%ds",
		cfg.ServiceName, cfg.MinReplicas, cfg.MaxReplicas, cfg.CPUScaleUp, cfg.CPUScaleDown, cfg.IntervalSec)

	ticker := time.NewTicker(time.Duration(cfg.IntervalSec) * time.Second)
	defer ticker.Stop()

	highCPUStreak := 0
	lowCPUStreak := 0

	var lastScaleTime time.Time
	const scaleUpCooldown = 20 * time.Second
	const scaleDownCooldown = 40 * time.Second

	for range ticker.C {
		// 1. Lấy danh sách Services từ Docker
		resp, err := client.Get("http://localhost/v1.44/services")
		if err != nil {
			log.Printf("⚠️ [%s] Lỗi truy vấn Docker Services: %v", cfg.ServiceName, err)
			continue
		}

		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		var services []SwarmService
		if err := json.Unmarshal(body, &services); err != nil {
			continue
		}

		var target *SwarmService
		for i := range services {
			sName := services[i].Spec.Name
			if sName == cfg.ServiceName || (len(sName) >= len(cfg.ServiceName) && sName[len(sName)-len(cfg.ServiceName):] == cfg.ServiceName) {
				target = &services[i]
				break
			}
		}

		if target == nil {
			continue
		}

		currentReplicas := target.Spec.Mode.Replicated.Replicas

		// 2. Lấy danh sách task đang chạy của service
		taskURL := fmt.Sprintf("http://localhost/v1.44/tasks?filters=%s",
			url.QueryEscape(fmt.Sprintf(`{"service":["%s"],"desired-state":["running"]}`, target.ID)))

		resp, err = client.Get(taskURL)
		if err != nil {
			continue
		}
		taskBody, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		var tasks []SwarmTask
		_ = json.Unmarshal(taskBody, &tasks)

		var cpuSamples []float64
		for _, t := range tasks {
			cid := t.Status.ContainerStatus.ContainerID
			if cid == "" {
				continue
			}

			statURL := fmt.Sprintf("http://localhost/v1.44/containers/%s/stats?stream=false", cid)
			sResp, sErr := client.Get(statURL)
			if sErr != nil {
				continue
			}
			sBody, _ := io.ReadAll(sResp.Body)
			sResp.Body.Close()

			var cStats DockerCPUStats
			if json.Unmarshal(sBody, &cStats) == nil {
				if cpuP, valid := calculateCPUPercent(&cStats); valid {
					cpuSamples = append(cpuSamples, cpuP)
				}
			}
		}

		metrics := calculateCPUMetrics(cpuSamples)
		log.Printf("📊 [%s] Replicas: %d/%d | Containers: %d | Avg: %.1f%% | Max: %.1f%% | P95: %.1f%% | Effective: %.1f%%",
			cfg.ServiceName, currentReplicas, cfg.MaxReplicas, metrics.ValidSamples, metrics.AvgCPU, metrics.MaxCPU, metrics.P95CPU, metrics.EffectiveCPU)

		decision := evaluateScalingDecision(metrics, cfg, currentReplicas)

		// 3. Ra quyết định Scale với Timestamp Cooldown (Non-blocking)
		now := time.Now()
		switch decision {
		case DecisionScaleUp:
			highCPUStreak++
			lowCPUStreak = 0

			if highCPUStreak >= 2 {
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

				scaleService(client, target, newReplicas)
				lastScaleTime = time.Now()
				highCPUStreak = 0
			}

		case DecisionScaleDown:
			lowCPUStreak++
			highCPUStreak = 0

			if lowCPUStreak >= 4 {
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

				scaleService(client, target, newReplicas)
				lastScaleTime = time.Now()
				lowCPUStreak = 0
			}

		default:
			highCPUStreak = 0
			lowCPUStreak = 0
		}
	}
}

func scaleService(client *http.Client, service *SwarmService, newReplicas uint64) {
	inspectURL := fmt.Sprintf("http://localhost/v1.44/services/%s", service.ID)
	resp, err := client.Get(inspectURL)
	if err == nil && resp.StatusCode == 200 {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		var latestService SwarmService
		if json.Unmarshal(body, &latestService) == nil {
			service.Version = latestService.Version
			service.Spec = latestService.Spec
		}
	}

	service.Spec.Mode.Replicated.Replicas = newReplicas

	updatePayload, err := json.Marshal(service.Spec)
	if err != nil {
		return
	}

	updateURL := fmt.Sprintf("http://localhost/v1.44/services/%s/update?version=%d", service.ID, service.Version.Index)
	req, err := http.NewRequest(http.MethodPost, updateURL, bytes.NewReader(updatePayload))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")

	uResp, err := client.Do(req)
	if err != nil {
		log.Printf("❌ [%s] Lỗi khi scale service: %v", service.Spec.Name, err)
		return
	}
	defer uResp.Body.Close()

	if uResp.StatusCode >= 200 && uResp.StatusCode < 300 {
		log.Printf("✅ [%s] Cập nhật Replicas thành công: %d", service.Spec.Name, newReplicas)
	} else {
		body, _ := io.ReadAll(uResp.Body)
		log.Printf("⚠️ [%s] Lỗi API scale (%d): %s", service.Spec.Name, uResp.StatusCode, string(body))
	}
}

// ─────────────────────────────────────────────────────────────
// 5. DOCKER AUTO GARBAGE COLLECTOR (BẢO VỆ BUILD CACHE CI/CD)
// ─────────────────────────────────────────────────────────────

func startDockerAutoPruner(client *http.Client, interval time.Duration) {
	log.Printf("🧹 [DOCKER GC] Khởi động chế độ tự động dọn dẹp (Chu kỳ: %v)...", interval)

	runPrune := func() {
		log.Printf("🧹 [DOCKER GC] Bắt đầu quét và dọn dẹp tài nguyên Docker dư thừa...")
		var totalFreed int64 = 0

		// 1. Dọn dẹp Stopped Containers
		if resp, err := client.Post("http://localhost/v1.44/containers/prune", "application/json", nil); err == nil {
			body, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			var cRes struct {
				ContainersDeleted []string `json:"ContainersDeleted"`
				SpaceReclaimed    int64    `json:"SpaceReclaimed"`
			}
			if json.Unmarshal(body, &cRes) == nil && len(cRes.ContainersDeleted) > 0 {
				totalFreed += cRes.SpaceReclaimed
				log.Printf("  • Đã xóa %d stopped containers (Giải phóng %.2f MB)",
					len(cRes.ContainersDeleted), float64(cRes.SpaceReclaimed)/(1024*1024))
			}
		}

		// 2. Dọn dẹp Unused Images (dangling=false để xóa cả image cũ không còn tag/container dùng)
		imagePruneURL := fmt.Sprintf("http://localhost/v1.44/images/prune?filters=%s",
			url.QueryEscape(`{"dangling":["false"]}`))
		if resp, err := client.Post(imagePruneURL, "application/json", nil); err == nil {
			body, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			var iRes struct {
				ImagesDeleted  []interface{} `json:"ImagesDeleted"`
				SpaceReclaimed int64         `json:"SpaceReclaimed"`
			}
			if json.Unmarshal(body, &iRes) == nil && len(iRes.ImagesDeleted) > 0 {
				totalFreed += iRes.SpaceReclaimed
				log.Printf("  • Đã xóa %d unused images (Giải phóng %.2f MB)",
					len(iRes.ImagesDeleted), float64(iRes.SpaceReclaimed)/(1024*1024))
			}
		}

		// 3. Dọn dẹp Build Cache An Toàn (Chỉ xóa nếu được bật PRUNE_BUILD_CACHE=true để tránh làm chậm CI/CD)
		if getEnvBool("PRUNE_BUILD_CACHE", false) {
			// Chỉ xóa build cache cũ hơn 48h (until=48h) và giữ lại 5GB dung lượng đệm
			buildPruneURL := fmt.Sprintf("http://localhost/v1.44/build/prune?filters=%s&keep-storage=%d",
				url.QueryEscape(`{"until":["48h"]}`), int64(5*1024*1024*1024))

			if resp, err := client.Post(buildPruneURL, "application/json", nil); err == nil {
				body, _ := io.ReadAll(resp.Body)
				resp.Body.Close()
				var bRes struct {
					CachesDeleted  []string `json:"CachesDeleted"`
					SpaceReclaimed int64    `json:"SpaceReclaimed"`
				}
				if json.Unmarshal(body, &bRes) == nil && len(bRes.CachesDeleted) > 0 {
					totalFreed += bRes.SpaceReclaimed
					log.Printf("  • Đã xóa %d old build cache layers (Giải phóng %.2f MB)",
						len(bRes.CachesDeleted), float64(bRes.SpaceReclaimed)/(1024*1024))
				}
			}
		}

		log.Printf("✨ [DOCKER GC] Hoàn tất dọn dẹp! Tổng dung lượng giải phóng: %.2f MB", float64(totalFreed)/(1024*1024))
	}

	time.AfterFunc(10*time.Second, runPrune)

	ticker := time.NewTicker(interval)
	for range ticker.C {
		runPrune()
	}
}

func main() {
	configs := parseServicesConfig()
	client := newDockerUnixClient()

	log.Printf("⚡ [GOLANG MULTI-SERVICE AUTOSCALER] Khởi động với %d services được quản lý.", len(configs))

	pruneHours := getEnvInt("AUTO_PRUNE_INTERVAL_HOURS", 6)
	go startDockerAutoPruner(client, time.Duration(pruneHours)*time.Hour)

	var wg sync.WaitGroup
	for _, cfg := range configs {
		wg.Add(1)
		go func(c ServiceScaleConfig) {
			defer wg.Done()
			monitorAndScaleService(client, c)
		}(cfg)
	}

	wg.Wait()
}
