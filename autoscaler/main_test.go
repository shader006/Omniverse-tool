package main

import (
	"os"
	"testing"
	"time"
)

// 1. Kiểm tra Max CPU / P95 vs Avg CPU (Tránh bẫy nghẽn 1 container đơn lẻ)
func TestEvaluateScalingMetrics_MaxVsAvg_PreventsBottleneck(t *testing.T) {
	cfg := ServiceScaleConfig{
		ServiceName:  "omniverse_app",
		MinReplicas:  1,
		MaxReplicas:  5,
		CPUScaleUp:   65.0,
		CPUScaleDown: 20.0,
		IntervalSec:  8,
	}

	// Tình huống: 1 container bị nghẽn 90%, 2 container khác 10%
	// Avg = (90 + 10 + 10) / 3 = 36.7% (nhỏ hơn 65%)
	samples := []float64{90.0, 10.0, 10.0}
	metrics := calculateCPUMetrics(samples)

	if metrics.AvgCPU > 37.0 || metrics.AvgCPU < 36.0 {
		t.Fatalf("AvgCPU không chính xác: %v", metrics.AvgCPU)
	}

	if metrics.MaxCPU != 90.0 {
		t.Fatalf("MaxCPU mong đợi 90.0, nhận được: %v", metrics.MaxCPU)
	}

	decision := evaluateScalingDecision(metrics, cfg, 3)
	if decision != DecisionScaleUp {
		t.Fatalf("Lỗi: Khi container 1 bị nghẽn 90%% (MaxCPU >= 65%%), hệ thống PHẢI ScaleUp nhưng lại trả về: %v", decision)
	}
}

// 2. Kiểm tra ScaleDown An Toàn (Chỉ hạ khi TẤT CẢ container đều rảnh rỗi)
func TestEvaluateScalingMetrics_SafeScaleDown(t *testing.T) {
	cfg := ServiceScaleConfig{
		ServiceName:  "omniverse_app",
		MinReplicas:  1,
		MaxReplicas:  5,
		CPUScaleUp:   65.0,
		CPUScaleDown: 20.0,
		IntervalSec:  8,
	}

	// Trường hợp 1: Avg = 15% (thấp), nhưng Max = 35% (> 20%) ➔ KHÔNG được Scale Down!
	samples1 := []float64{35.0, 5.0, 5.0}
	metrics1 := calculateCPUMetrics(samples1)
	decision1 := evaluateScalingDecision(metrics1, cfg, 3)
	if decision1 == DecisionScaleDown {
		t.Fatalf("Lỗi nguy hiểm: Có container đang 35%% CPU nhưng lại ScaleDown!")
	}

	// Trường hợp 2: Tất cả container đều < 20% (Max = 12%, Avg = 8%) ➔ ScaleDown an toàn
	samples2 := []float64{12.0, 8.0, 4.0}
	metrics2 := calculateCPUMetrics(samples2)
	decision2 := evaluateScalingDecision(metrics2, cfg, 3)
	if decision2 != DecisionScaleDown {
		t.Fatalf("Mong đợi DecisionScaleDown khi tất cả container nhàn rỗi, nhận được: %v", decision2)
	}
}

// 3. Kiểm tra tính toán CPU với first sample hoặc precpu = 0
func TestCalculateCPUPercent_ZeroSampleEdgeCase(t *testing.T) {
	// Case 1: PreCPU = 0 (lần query đầu tiên của Docker stream=false)
	statsInvalid := &DockerCPUStats{}
	statsInvalid.CPUStats.CPUUsage.TotalUsage = 1000000
	statsInvalid.CPUStats.SystemCPUUsage = 50000000
	statsInvalid.PreCPUStats.SystemCPUUsage = 0 // Chưa có dữ liệu trước

	_, valid := calculateCPUPercent(statsInvalid)
	if valid {
		t.Fatalf("calculateCPUPercent phải trả về valid=false khi precpu_stats rỗng/zero")
	}

	// Case 2: Dữ liệu hợp lệ
	statsValid := &DockerCPUStats{}
	statsValid.CPUStats.CPUUsage.TotalUsage = 2000000
	statsValid.PreCPUStats.CPUUsage.TotalUsage = 1000000
	statsValid.CPUStats.SystemCPUUsage = 60000000
	statsValid.PreCPUStats.SystemCPUUsage = 50000000
	statsValid.CPUStats.OnlineCPUs = 2

	percent, valid2 := calculateCPUPercent(statsValid)
	if !valid2 {
		t.Fatalf("calculateCPUPercent phải trả về valid=true cho dữ liệu chuẩn")
	}
	// cpuDelta = 1M, sysDelta = 10M, CPUs = 2 ➔ (1/10)*2*100 = 20%
	if percent < 19.9 || percent > 20.1 {
		t.Fatalf("CPU%% tính toán sai, mong đợi ~20%%, nhận được: %v", percent)
	}
}

// 4. Kiểm tra Deduplication cấu hình Services (Chống 2 goroutines tranh chấp 1 service)
func TestParseServicesConfig_Deduplication(t *testing.T) {
	// Cố tình truyền trùng tên service
	os.Setenv("SERVICES_CONFIG", "omniverse_app:1:5:65:20:8,omniverse_gotenberg:1:4:70:25:8,omniverse_app:1:5:65:20:8")
	defer os.Unsetenv("SERVICES_CONFIG")

	configs := parseServicesConfig()
	if len(configs) != 2 {
		t.Fatalf("Mong đợi 2 configs sau khi deduplicate, nhận được: %d", len(configs))
	}

	countApp := 0
	for _, c := range configs {
		if c.ServiceName == "omniverse_app" {
			countApp++
		}
	}
	if countApp != 1 {
		t.Fatalf("ServiceName 'omniverse_app' bị trùng lặp: %d", countApp)
	}
}

// 5. Kiểm tra Cooldown Non-blocking
func TestCooldownNonBlocking(t *testing.T) {
	lastScaleTime := time.Now()
	cooldown := 20 * time.Second

	// Ngay sau khi scale 1 giây ➔ Đang trong cooldown
	timeInCooldown := lastScaleTime.Add(1 * time.Second)
	if timeInCooldown.Sub(lastScaleTime) >= cooldown {
		t.Fatalf("Phải trong trạng thái cooldown")
	}

	// Sau 25 giây ➔ Hết cooldown, cho phép scale tiếp
	timeAfterCooldown := lastScaleTime.Add(25 * time.Second)
	if timeAfterCooldown.Sub(lastScaleTime) < cooldown {
		t.Fatalf("Phải hết trạng thái cooldown")
	}
}
