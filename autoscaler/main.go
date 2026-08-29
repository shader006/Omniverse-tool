package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Cấu trúc dữ liệu Docker API
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

// Client HTTP kết nối trực tiếp qua UNIX Socket của Docker
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

func calculateCPUPercent(stats *DockerCPUStats) float64 {
	cpuDelta := float64(stats.CPUStats.CPUUsage.TotalUsage) - float64(stats.PreCPUStats.CPUUsage.TotalUsage)
	systemDelta := float64(stats.CPUStats.SystemCPUUsage) - float64(stats.PreCPUStats.SystemCPUUsage)
	onlineCPUs := float64(stats.CPUStats.OnlineCPUs)
	if onlineCPUs == 0 {
		onlineCPUs = 1
	}

	if systemDelta > 0 && cpuDelta > 0 {
		return (cpuDelta / systemDelta) * onlineCPUs * 100.0
	}
	return 0.0
}

func parseServicesConfig() []ServiceScaleConfig {
	raw := getEnv("SERVICES_CONFIG", "")
	var configs []ServiceScaleConfig

	if raw != "" {
		// Format: "name:min:max:up:down:interval,name2:min:max:up:down:interval"
		items := strings.Split(raw, ",")
		for _, item := range items {
			item = strings.TrimSpace(item)
			if item == "" {
				continue
			}
			parts := strings.Split(item, ":")
			if len(parts) >= 1 {
				name := strings.TrimSpace(parts[0])
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
		configs = append(configs, ServiceScaleConfig{
			ServiceName:  getEnv("SWARM_SERVICE_NAME", "omniverse_app"),
			MinReplicas:  uint64(getEnvInt("MIN_REPLICAS", 1)),
			MaxReplicas:  uint64(getEnvInt("MAX_REPLICAS", 5)),
			CPUScaleUp:   getEnvFloat("CPU_SCALE_UP", 65.0),
			CPUScaleDown: getEnvFloat("CPU_SCALE_DOWN", 20.0),
			IntervalSec:  getEnvInt("CHECK_INTERVAL", 8),
		})
	}

	return configs
}

func monitorAndScaleService(client *http.Client, cfg ServiceScaleConfig) {
	log.Printf("🚀 [AUTOSCALER] Bắt đầu theo dõi Service: '%s' | Min=%d | Max=%d | ScaleUp>%.1f%% | ScaleDown<%.1f%% | Chu kỳ=%ds",
		cfg.ServiceName, cfg.MinReplicas, cfg.MaxReplicas, cfg.CPUScaleUp, cfg.CPUScaleDown, cfg.IntervalSec)

	ticker := time.NewTicker(time.Duration(cfg.IntervalSec) * time.Second)
	defer ticker.Stop()

	highCPUCount := 0
	lowCPUCount := 0

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

		// 2. Lấy danh sách task đang chạy của service này
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

		var cpuPercentages []float64
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
				cpuP := calculateCPUPercent(&cStats)
				cpuPercentages = append(cpuPercentages, cpuP)
			}
		}

		var avgCPU float64
		if len(cpuPercentages) > 0 {
			var total float64
			for _, v := range cpuPercentages {
				total += v
			}
			avgCPU = total / float64(len(cpuPercentages))
		}

		log.Printf("📊 [%s] Replicas: %d/%d | Containers: %d | Avg CPU: %.1f%%",
			cfg.ServiceName, currentReplicas, cfg.MaxReplicas, len(cpuPercentages), avgCPU)

		// 3. Ra quyết định Scale
		if avgCPU >= cfg.CPUScaleUp {
			highCPUCount++
			lowCPUCount = 0
			if highCPUCount >= 2 && currentReplicas < cfg.MaxReplicas {
				newReplicas := currentReplicas + 1
				if newReplicas > cfg.MaxReplicas {
					newReplicas = cfg.MaxReplicas
				}
				log.Printf("🚀 [%s SCALE UP] CPU cao (%.1f%% >= %.1f%%) ➔ Tăng từ %d ➔ %d Replicas!",
					cfg.ServiceName, avgCPU, cfg.CPUScaleUp, currentReplicas, newReplicas)

				scaleService(client, target, newReplicas)
				highCPUCount = 0
				time.Sleep(15 * time.Second)
			}
		} else if avgCPU <= cfg.CPUScaleDown {
			lowCPUCount++
			highCPUCount = 0
			if lowCPUCount >= 4 && currentReplicas > cfg.MinReplicas {
				newReplicas := currentReplicas - 1
				if newReplicas < cfg.MinReplicas {
					newReplicas = cfg.MinReplicas
				}
				log.Printf("📉 [%s SCALE DOWN] CPU nhàn rỗi (%.1f%% <= %.1f%%) ➔ Giảm từ %d ➔ %d Replicas.",
					cfg.ServiceName, avgCPU, cfg.CPUScaleDown, currentReplicas, newReplicas)

				scaleService(client, target, newReplicas)
				lowCPUCount = 0
				time.Sleep(10 * time.Second)
			}
		} else {
			highCPUCount = 0
			lowCPUCount = 0
		}
	}
}

func scaleService(client *http.Client, service *SwarmService, newReplicas uint64) {
	// Truy vấn lại service mới nhất để lấy Index Version chính xác
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
// DOCKER AUTO GARBAGE COLLECTOR (Dọn dẹp Container & Image cũ)
// ─────────────────────────────────────────────────────────────
func startDockerAutoPruner(client *http.Client, interval time.Duration) {
	log.Printf("🧹 [DOCKER GC] Khởi động chế độ tự động dọn dẹp (Chu kỳ: %v)...", interval)

	// Chạy chu kỳ dọn dẹp
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

		// 3. Dọn dẹp Build Cache
		if resp, err := client.Post("http://localhost/v1.44/build/prune", "application/json", nil); err == nil {
			body, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			var bRes struct {
				CachesDeleted  []string `json:"CachesDeleted"`
				SpaceReclaimed int64    `json:"SpaceReclaimed"`
			}
			if json.Unmarshal(body, &bRes) == nil && len(bRes.CachesDeleted) > 0 {
				totalFreed += bRes.SpaceReclaimed
				log.Printf("  • Đã xóa %d build cache layers (Giải phóng %.2f MB)",
					len(bRes.CachesDeleted), float64(bRes.SpaceReclaimed)/(1024*1024))
			}
		}

		log.Printf("✨ [DOCKER GC] Hoàn tất dọn dẹp! Tổng dung lượng giải phóng: %.2f MB", float64(totalFreed)/(1024*1024))
	}

	// Chạy lần đầu sau 10 giây khởi động
	time.AfterFunc(10*time.Second, runPrune)

	// Lặp lại theo interval
	ticker := time.NewTicker(interval)
	for range ticker.C {
		runPrune()
	}
}

func main() {
	configs := parseServicesConfig()
	client := newDockerUnixClient()

	log.Printf("⚡ [GOLANG MULTI-SERVICE AUTOSCALER] Khởi động với %d services được quản lý.", len(configs))

	// Chu kỳ Garbage Collection (Mặc định 6 giờ, có thể tùy chỉnh qua AUTO_PRUNE_INTERVAL_HOURS)
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
