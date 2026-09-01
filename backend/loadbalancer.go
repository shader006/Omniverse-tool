package main

import (
	"fmt"
	"log"
	mathRand "math/rand"
	"net"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type NodeStats struct {
	activeConns         int64
	ewmaLatencyMs       float64
	consecutiveFailures int
	circuitOpenUntil    time.Time
	mu                  sync.Mutex
}

type GotenbergLoadBalancer struct {
	rawTarget string
	scheme    string
	host      string
	port      string
	statsMap  sync.Map // map[string]*NodeStats
	alpha     float64
}

func NewGotenbergLoadBalancer(rawURL string) *GotenbergLoadBalancer {
	scheme := "http"
	host := "gotenberg"
	port := "3000"

	u, err := url.Parse(rawURL)
	if err == nil && u.Host != "" {
		if u.Scheme != "" {
			scheme = u.Scheme
		}
		h, p, splitErr := net.SplitHostPort(u.Host)
		if splitErr == nil {
			host = h
			port = p
		} else {
			host = u.Host
		}
	} else {
		trimmed := strings.TrimPrefix(strings.TrimPrefix(rawURL, "http://"), "https://")
		parts := strings.Split(trimmed, ":")
		if len(parts) == 2 {
			host = parts[0]
			port = parts[1]
		} else if len(parts) == 1 && parts[0] != "" {
			host = parts[0]
		}
	}

	return &GotenbergLoadBalancer{
		rawTarget: strings.TrimRight(rawURL, "/"),
		scheme:    scheme,
		host:      host,
		port:      port,
		alpha:     0.2,
	}
}

func (lb *GotenbergLoadBalancer) getOrCreateStats(addr string) *NodeStats {
	val, loaded := lb.statsMap.Load(addr)
	if loaded {
		return val.(*NodeStats)
	}
	newStats := &NodeStats{
		activeConns:   0,
		ewmaLatencyMs: 15.0,
	}
	actual, _ := lb.statsMap.LoadOrStore(addr, newStats)
	return actual.(*NodeStats)
}

func (lb *GotenbergLoadBalancer) SelectEndpoint(subPath string) (string, func(err error)) {
	// 1. Dynamic DNS Discovery: Phân giải danh sách IP thực tế của các replicas trong Swarm
	var allAddrs []string
	ips, err := net.LookupIP(lb.host)
	if err == nil && len(ips) > 0 {
		for _, ip := range ips {
			allAddrs = append(allAddrs, net.JoinHostPort(ip.String(), lb.port))
		}
	}

	now := time.Now()
	var eligibleAddrs []string

	// 2. Lọc qua Circuit Breaker & Concurrency Threshold (Max 4 active jobs)
	for _, addr := range allAddrs {
		s := lb.getOrCreateStats(addr)
		s.mu.Lock()
		isCircuitOpen := now.Before(s.circuitOpenUntil)
		conns := atomic.LoadInt64(&s.activeConns)
		s.mu.Unlock()

		if !isCircuitOpen && conns < 4 {
			eligibleAddrs = append(eligibleAddrs, addr)
		}
	}

	// Nếu tất cả node đều bận/khóa, fallback chọn các node không bị circuit breaker
	if len(eligibleAddrs) == 0 {
		for _, addr := range allAddrs {
			s := lb.getOrCreateStats(addr)
			s.mu.Lock()
			isCircuitOpen := now.Before(s.circuitOpenUntil)
			s.mu.Unlock()
			if !isCircuitOpen {
				eligibleAddrs = append(eligibleAddrs, addr)
			}
		}
	}

	// Fallback cuối cùng nếu mọi node đều bị circuit breaker
	if len(eligibleAddrs) == 0 {
		eligibleAddrs = allAddrs
	}

	var selectedAddr string
	if len(eligibleAddrs) >= 2 {
		// 3. Thuật toán P2C: Bốc ngẫu nhiên 2 node ứng viên từ tập eligible
		idx1 := mathRand.Intn(len(eligibleAddrs))
		idx2 := mathRand.Intn(len(eligibleAddrs))
		for idx2 == idx1 {
			idx2 = mathRand.Intn(len(eligibleAddrs))
		}

		a1 := eligibleAddrs[idx1]
		a2 := eligibleAddrs[idx2]

		s1 := lb.getOrCreateStats(a1)
		s2 := lb.getOrCreateStats(a2)

		s1.mu.Lock()
		ewma1 := s1.ewmaLatencyMs
		s1.mu.Unlock()

		s2.mu.Lock()
		ewma2 := s2.ewmaLatencyMs
		s2.mu.Unlock()

		conns1 := float64(atomic.LoadInt64(&s1.activeConns))
		conns2 := float64(atomic.LoadInt64(&s2.activeConns))

		// Peak-EWMA Load Score = (ActiveConns + 1) * EWMA_Latency
		score1 := (conns1 + 1.0) * ewma1
		score2 := (conns2 + 1.0) * ewma2

		if score1 <= score2 {
			selectedAddr = a1
		} else {
			selectedAddr = a2
		}
	} else if len(eligibleAddrs) == 1 {
		selectedAddr = eligibleAddrs[0]
	} else {
		selectedAddr = net.JoinHostPort(lb.host, lb.port)
	}

	stats := lb.getOrCreateStats(selectedAddr)
	atomic.AddInt64(&stats.activeConns, 1)
	startTime := time.Now()

	finishFunc := func(reqErr error) {
		elapsedMs := float64(time.Since(startTime).Microseconds()) / 1000.0
		atomic.AddInt64(&stats.activeConns, -1)

		stats.mu.Lock()
		defer stats.mu.Unlock()
		if reqErr != nil {
			// Penalty cho node phản hồi lỗi/timeout
			stats.ewmaLatencyMs = lb.alpha*(elapsedMs+500.0) + (1.0-lb.alpha)*stats.ewmaLatencyMs
			stats.consecutiveFailures++
			// Nếu lỗi liên tiếp >= 3 lần ➔ Khóa node 15s (Circuit Breaker Tripped)
			if stats.consecutiveFailures >= 3 {
				stats.circuitOpenUntil = time.Now().Add(15 * time.Second)
				log.Printf("⚠️ [CIRCUIT BREAKER] Node Gotenberg '%s' lỗi %d lần ➔ Tạm ngắt trong 15s!", selectedAddr, stats.consecutiveFailures)
			}
		} else {
			stats.ewmaLatencyMs = lb.alpha*elapsedMs + (1.0-lb.alpha)*stats.ewmaLatencyMs
			stats.consecutiveFailures = 0
		}
	}

	fullURL := fmt.Sprintf("%s://%s%s", lb.scheme, selectedAddr, subPath)
	return fullURL, finishFunc
}
