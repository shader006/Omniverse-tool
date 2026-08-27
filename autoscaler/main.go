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

func main() {
	serviceName := getEnv("SWARM_SERVICE_NAME", "omniverse_app")
	minReplicas := uint64(getEnvInt("MIN_REPLICAS", 1))
	maxReplicas := uint64(getEnvInt("MAX_REPLICAS", 5))
	cpuScaleUp := getEnvFloat("CPU_SCALE_UP", 65.0)
	cpuScaleDown := getEnvFloat("CPU_SCALE_DOWN", 20.0)
	intervalSec := getEnvInt("CHECK_INTERVAL", 8)

	log.Printf("🚀 [GOLANG AUTOSCALER] Khởi động bộ tự động scale hiệu năng cao cho Swarm: %s", serviceName)
	log.Printf("⚙️ [CONFIG] Min=%d, Max=%d, ScaleUp > %.1f%%, ScaleDown < %.1f%%, Interval=%ds",
		minReplicas, maxReplicas, cpuScaleUp, cpuScaleDown, intervalSec)

	client := newDockerUnixClient()
	ticker := time.NewTicker(time.Duration(intervalSec) * time.Second)
	defer ticker.Stop()

	highCPUCount := 0
	lowCPUCount := 0

	for range ticker.C {
		// 1. Lấy danh sách Services
		resp, err := client.Get("http://localhost/v1.44/services")
		if err != nil {
			log.Printf("⚠️ Lỗi truy vấn Docker Services: %v", err)
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
			if services[i].Spec.Name == serviceName || (len(services[i].Spec.Name) >= len(serviceName) && services[i].Spec.Name[len(services[i].Spec.Name)-len(serviceName):] == serviceName) {
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

		log.Printf("📊 [METRICS] Replicas: %d/%d | Containers: %d | Avg CPU: %.1f%%",
			currentReplicas, maxReplicas, len(cpuPercentages), avgCPU)

		// 3. Ra quyết định Scale
		if avgCPU >= cpuScaleUp {
			highCPUCount++
			lowCPUCount = 0
			if highCPUCount >= 2 && currentReplicas < maxReplicas {
				newReplicas := currentReplicas + 1
				if newReplicas > maxReplicas {
					newReplicas = maxReplicas
				}
				log.Printf("🚀 [SCALE UP] CPU cao (%.1f%% >= %.1f%%) ➔ Tăng từ %d ➔ %d Replicas!",
					avgCPU, cpuScaleUp, currentReplicas, newReplicas)

				scaleService(client, target, newReplicas)
				highCPUCount = 0
				time.Sleep(15 * time.Second)
			}
		} else if avgCPU <= cpuScaleDown {
			lowCPUCount++
			highCPUCount = 0
			if lowCPUCount >= 4 && currentReplicas > minReplicas {
				newReplicas := currentReplicas - 1
				if newReplicas < minReplicas {
					newReplicas = minReplicas
				}
				log.Printf("📉 [SCALE DOWN] CPU nhàn rỗi (%.1f%% <= %.1f%%) ➔ Giảm từ %d ➔ %d Replicas.",
					avgCPU, cpuScaleDown, currentReplicas, newReplicas)

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

	resp, err := client.Do(req)
	if err != nil {
		log.Printf("❌ Lỗi khi scale service: %v", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		log.Printf("✅ Cập nhật Replicas thành công: %d", newReplicas)
	} else {
		body, _ := io.ReadAll(resp.Body)
		log.Printf("⚠️ Lỗi API scale (%d): %s", resp.StatusCode, string(body))
	}
}
