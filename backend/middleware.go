package main

import (
	"encoding/json"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

var (
	allowedOrigins = func() []string {
		if raw := os.Getenv("ALLOWED_ORIGINS"); raw != "" {
			parts := strings.Split(raw, ",")
			var res []string
			for _, p := range parts {
				if trimmed := strings.TrimSpace(p); trimmed != "" {
					res = append(res, trimmed)
				}
			}
			return res
		}
		return nil
	}()

	rateLimitPerMin = func() int {
		if raw := os.Getenv("RATE_LIMIT_PER_MINUTE"); raw != "" {
			if v, err := strconv.Atoi(raw); err == nil && v > 0 {
				return v
			}
		}
		return 60 // Mặc định 60 requests/phút cho các API nặng
	}()

	ipRateMap = make(map[string]*clientRateLimiter)
	rateMu    sync.Mutex
)

type clientRateLimiter struct {
	tokens     int
	lastRefill time.Time
}

func getClientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		return strings.TrimSpace(parts[0])
	}
	if xri := r.Header.Get("X-Real-IP"); xri != "" {
		return strings.TrimSpace(xri)
	}
	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return ip
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		allowOrigin := "*"
		if len(allowedOrigins) > 0 {
			allowOrigin = ""
			for _, o := range allowedOrigins {
				if o == "*" || o == origin {
					allowOrigin = origin
					break
				}
			}
			if allowOrigin == "" && origin != "" {
				// Origin không nằm trong danh sách cho phép
				w.WriteHeader(http.StatusForbidden)
				return
			}
		}

		if allowOrigin != "" {
			w.Header().Set("Access-Control-Allow-Origin", allowOrigin)
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")
		w.Header().Set("Access-Control-Max-Age", "86400")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func rateLimitMiddleware(next http.Handler) http.Handler {
	// Cleanup định kỳ để tránh rò rỉ RAM
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		for range ticker.C {
			rateMu.Lock()
			now := time.Now()
			for ip, lim := range ipRateMap {
				if now.Sub(lim.lastRefill) > 10*time.Minute {
					delete(ipRateMap, ip)
				}
			}
			rateMu.Unlock()
		}
	}()

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Chỉ áp dụng rate limit cho các API POST tiêu tốn nhiều tài nguyên
		path := r.URL.Path
		isHeavyAPI := strings.HasPrefix(path, "/api/download") ||
			strings.HasPrefix(path, "/api/transcribe") ||
			strings.HasPrefix(path, "/api/remove-bg") ||
			strings.HasPrefix(path, "/api/convert")

		if isHeavyAPI && r.Method == http.MethodPost {
			clientIP := getClientIP(r)
			rateMu.Lock()
			now := time.Now()
			lim, exists := ipRateMap[clientIP]
			if !exists {
				lim = &clientRateLimiter{tokens: rateLimitPerMin - 1, lastRefill: now}
				ipRateMap[clientIP] = lim
			} else {
				// Phục hồi token theo thời gian trôi qua
				elapsed := now.Sub(lim.lastRefill)
				if elapsed >= time.Minute {
					lim.tokens = rateLimitPerMin
					lim.lastRefill = now
				}
				if lim.tokens <= 0 {
					rateMu.Unlock()
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusTooManyRequests)
					_ = json.NewEncoder(w).Encode(map[string]interface{}{
						"success": false,
						"detail":  "Bạn đã gửi quá nhiều yêu cầu trong thời gian ngắn. Vui lòng thử lại sau giây lát.",
					})
					return
				}
				lim.tokens--
			}
			rateMu.Unlock()
		}

		next.ServeHTTP(w, r)
	})
}
