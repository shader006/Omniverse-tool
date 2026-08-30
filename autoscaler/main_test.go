package main

import (
	"context"
	"net/http"
	"os"
	"testing"
	"time"
)

// 1. Kiểm tra Max CPU / Effective CPU (Tránh bẫy nghẽn 1 container đơn lẻ)
func TestEvaluateScalingMetrics_MaxVsAvg_PreventsBottleneck(t *testing.T) {
	cfg := ServiceScaleConfig{
		ServiceName:     "omniverse_app",
		MinReplicas:     1,
		MaxReplicas:     5,
		CPUScaleUp:      65.0,
		CPUScaleDown:    20.0,
		IntervalSec:     8,
		ScaleUpStreak:   2,
		ScaleDownStreak: 4,
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
		ServiceName:     "omniverse_app",
		MinReplicas:     1,
		MaxReplicas:     5,
		CPUScaleUp:      65.0,
		CPUScaleDown:    20.0,
		IntervalSec:     8,
		ScaleUpStreak:   2,
		ScaleDownStreak: 4,
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

// 3. Kiểm tra tính toán CPU: Monotonic delta check (Chấp nhận PreCPU.TotalUsage = 0 khi systemDelta hợp lệ)
func TestCalculateCPUPercent_MonotonicDelta(t *testing.T) {
	// Case 1: PreCPU.TotalUsage = 0 nhưng TotalUsage hiện tại = 500, systemDelta = 1000 ➔ Hợp lệ!
	statsJustStarted := &DockerCPUStats{}
	statsJustStarted.CPUStats.CPUUsage.TotalUsage = 500000
	statsJustStarted.PreCPUStats.CPUUsage.TotalUsage = 0
	statsJustStarted.CPUStats.SystemCPUUsage = 10000000
	statsJustStarted.PreCPUStats.SystemCPUUsage = 5000000
	statsJustStarted.CPUStats.OnlineCPUs = 1

	percent, valid := calculateCPUPercent(statsJustStarted)
	if !valid {
		t.Fatalf("calculateCPUPercent PHẢI hợp lệ khi PreCPU.TotalUsage = 0 nhưng delta dương!")
	}
	if percent < 9.9 || percent > 10.1 {
		t.Fatalf("Mong đợi ~10%% CPU, nhận được: %v", percent)
	}

	// Case 2: SystemDelta <= 0 (Không hợp lệ)
	statsZeroSys := &DockerCPUStats{}
	statsZeroSys.CPUStats.SystemCPUUsage = 1000
	statsZeroSys.PreCPUStats.SystemCPUUsage = 1000
	_, valid2 := calculateCPUPercent(statsZeroSys)
	if valid2 {
		t.Fatalf("calculateCPUPercent không được hợp lệ khi systemDelta <= 0")
	}

	// Case 3: cpuUsage giảm (bất thường)
	statsDecrease := &DockerCPUStats{}
	statsDecrease.CPUStats.CPUUsage.TotalUsage = 500
	statsDecrease.PreCPUStats.CPUUsage.TotalUsage = 1000
	statsDecrease.CPUStats.SystemCPUUsage = 2000
	statsDecrease.PreCPUStats.SystemCPUUsage = 1000
	_, valid3 := calculateCPUPercent(statsDecrease)
	if valid3 {
		t.Fatalf("calculateCPUPercent không được hợp lệ khi cpuUsage giảm")
	}
}

// 4. Kiểm tra So Khớp Tên Service An Toàn (Chống match nhầm crapp -> app)
func TestMatchesServiceName(t *testing.T) {
	testCases := []struct {
		actual   string
		target   string
		expected bool
	}{
		{"omniverse_app", "omniverse_app", true},       // Khớp chính xác
		{"mystack_omniverse_app", "omniverse_app", true}, // Khớp với prefix stack
		{"myomniverse_app", "omniverse_app", false},     // Không có gạch dưới ngăn cách -> KHÔNG khớp!
		{"crapp", "app", false},                         // Tránh bug suffix bừa bãi
		{"omniverse_worker-rmbg", "worker-rmbg", true},   // Khớp prefix stack
	}

	for _, tc := range testCases {
		res := matchesServiceName(tc.actual, tc.target)
		if res != tc.expected {
			t.Errorf("matchesServiceName(%q, %q) = %v; mong đợi %v", tc.actual, tc.target, res, tc.expected)
		}
	}
}

// 5. Kiểm tra Service Global Mode Không Bị Panic Nil Pointer
func TestScaleService_GlobalMode_NoPanic(t *testing.T) {
	globalService := &SwarmService{
		ID: "global_123",
		Spec: ServiceSpec{
			Name: "global_agent",
			Mode: ServiceMode{
				Replicated: nil, // Chế độ Global không có Replicated
			},
		},
	}

	// Không được panic
	scaleServiceWithRetry(context.Background(), http.DefaultClient, globalService, 3, 0)
}

// 6. Kiểm tra Deduplication cấu hình Services
func TestParseServicesConfig_Deduplication(t *testing.T) {
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

// 7. Kiểm tra Cooldown Non-blocking
func TestCooldownNonBlocking(t *testing.T) {
	lastScaleTime := time.Now()
	cooldown := 20 * time.Second

	timeInCooldown := lastScaleTime.Add(1 * time.Second)
	if timeInCooldown.Sub(lastScaleTime) >= cooldown {
		t.Fatalf("Phải trong trạng thái cooldown")
	}

	timeAfterCooldown := lastScaleTime.Add(25 * time.Second)
	if timeAfterCooldown.Sub(lastScaleTime) < cooldown {
		t.Fatalf("Phải hết trạng thái cooldown")
	}
}
