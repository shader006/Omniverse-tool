package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

type contextKey string

const traceCtxKey contextKey = "traceInfo"

type TraceInfo struct {
	TraceID string
	SpanID  string
}

// GetTraceInfo lấy thông tin trace (TraceID, SpanID) từ Context
func GetTraceInfo(ctx context.Context) *TraceInfo {
	if ctx == nil {
		return nil
	}
	if ti, ok := ctx.Value(traceCtxKey).(*TraceInfo); ok {
		return ti
	}
	return nil
}

// InjectTraceparent tự động gắn header W3C traceparent vào request gửi sang worker
func InjectTraceparent(ctx context.Context, req *http.Request) {
	if req == nil {
		return
	}
	ti := GetTraceInfo(ctx)
	if ti == nil && req.Context() != nil {
		ti = GetTraceInfo(req.Context())
	}
	if ti != nil && ti.TraceID != "" && ti.SpanID != "" {
		req.Header.Set("traceparent", fmt.Sprintf("00-%s-%s-01", ti.TraceID, ti.SpanID))
	}
}

// DetachTraceContext tạo context nền độc lập không bị cancel khi HTTP request kết thúc,
// nhưng vẫn giữ nguyên thông tin TraceID và SpanID để gửi sang worker.
func DetachTraceContext(ctx context.Context) context.Context {
	bg := context.Background()
	if ti := GetTraceInfo(ctx); ti != nil {
		return context.WithValue(bg, traceCtxKey, ti)
	}
	return bg
}

type otlpSpanItem struct {
	TraceID         string
	SpanID          string
	Name            string
	Route           string
	Method          string
	StatusCode      int
	DurationMs      float64
	StartTime       time.Time
	ClientIP        string
	IsSecurityProbe bool
}

const (
	traceChanCapacity = 10000
	numTraceWorkers   = 4
)

var (
	traceChan       = make(chan *otlpSpanItem, traceChanCapacity)
	hiaiObserveURL  = func() string {
		if u := os.Getenv("HIAI_OBSERVE_URL"); u != "" {
			return u
		}
		return "http://172.17.0.1:8001"
	}()
	hiaiObserveKey  = os.Getenv("HIAI_OBSERVE_API_KEY")
	traceHTTPClient = &http.Client{Timeout: 3 * time.Second}
)

func initTracer() {
	for i := 0; i < numTraceWorkers; i++ {
		go func(workerID int) {
			for item := range traceChan {
				sendGatewayOTLPTrace(item)
			}
		}(i)
	}
}

func generateHexID(n int) string {
	return randomID() + randomID()
}

func getFriendlySpanName(method, path string, statusCode int, isSecurityProbe bool) string {
	if isSecurityProbe {
		return fmt.Sprintf("🛡️ [Security Probe] %s %s (HTTP %d)", method, path, statusCode)
	}
	switch {
	case path == "/api/convert/file":
		return "🌐 [Gateway] Chuyển đổi tài liệu (/api/convert/file)"
	case path == "/api/download":
		return "🌐 [Gateway] Tải Media (/api/download)"
	case path == "/api/info":
		return "🌐 [Gateway] Lấy thông tin Media (/api/info)"
	case path == "/api/remove-bg":
		return "🌐 [Gateway] Tách nền ảnh AI (/api/remove-bg)"
	case path == "/api/transcribe":
		return "🌐 [Gateway] Nhận diện giọng nói (/api/transcribe)"
	case path == "/api/pixel/detect":
		return "🌐 [Gateway] Nhận diện lưới pixel (/api/pixel/detect)"
	case path == "/api/pixel/fix":
		return "🌐 [Gateway] Tái tạo Pixel Art (/api/pixel/fix)"
	case path == "/api/pixel/health":
		return "🌐 [Gateway] Kiểm tra PixelFixer Health (/api/pixel/health)"
	case strings.HasPrefix(path, "/api/file/"):
		return fmt.Sprintf("🌐 [Gateway] Tải file kết quả (%s)", path)
	case strings.HasPrefix(path, "/api/status/"):
		return fmt.Sprintf("🌐 [Gateway] Kiểm tra tiến độ (%s)", path)
	case strings.HasPrefix(path, "/api/cancel/"):
		return fmt.Sprintf("🌐 [Gateway] Hủy tiến trình (%s)", path)
	case strings.HasPrefix(path, "/api/stream/"):
		return fmt.Sprintf("🌐 [Gateway] Stream tiến độ (%s)", path)
	default:
		if statusCode >= 400 {
			return fmt.Sprintf("🌐 [Gateway] Lỗi %d (%s %s)", statusCode, method, path)
		}
		return fmt.Sprintf("🌐 [Gateway] %s %s", method, path)
	}
}

func sendGatewayOTLPTrace(item *otlpSpanItem) {
	if hiaiObserveKey == "" {
		return
	}
	traceID := item.TraceID
	if traceID == "" {
		traceID = randomID() + randomID() + randomID() + randomID()
	}
	spanID := item.SpanID
	if spanID == "" {
		spanID = randomID() + randomID()
	}
	startNano := item.StartTime.UnixNano()
	endNano := item.StartTime.Add(time.Duration(item.DurationMs * float64(time.Millisecond))).UnixNano()

	attrs := []map[string]interface{}{
		{"key": "http.route", "value": map[string]interface{}{"stringValue": item.Route}},
		{"key": "http.method", "value": map[string]interface{}{"stringValue": item.Method}},
		{"key": "http.status_code", "value": map[string]interface{}{"intValue": strconv.Itoa(item.StatusCode)}},
		{"key": "net.peer.ip", "value": map[string]interface{}{"stringValue": item.ClientIP}},
	}
	if item.IsSecurityProbe {
		attrs = append(attrs,
			map[string]interface{}{"key": "security.probe", "value": map[string]interface{}{"stringValue": "true"}},
			map[string]interface{}{"key": "security.threat_level", "value": map[string]interface{}{"stringValue": "high"}},
		)
	}

	payload := map[string]interface{}{
		"resourceSpans": []map[string]interface{}{
			{
				"resource": map[string]interface{}{
					"attributes": []map[string]interface{}{
						{"key": "service.name", "value": map[string]interface{}{"stringValue": "omniverse-gateway"}},
						{"key": "deployment.environment", "value": map[string]interface{}{"stringValue": "production"}},
					},
				},
				"scopeSpans": []map[string]interface{}{
					{
						"scope": map[string]interface{}{"name": "gateway-tracer", "version": "1.0.0"},
						"spans": []map[string]interface{}{
							{
								"traceId":           traceID,
								"spanId":            spanID,
								"name":              item.Name,
								"kind":              1,
								"startTimeUnixNano": strconv.FormatInt(startNano, 10),
								"endTimeUnixNano":   strconv.FormatInt(endNano, 10),
								"attributes":        attrs,
								"status": map[string]interface{}{
									"code": func() int {
										if item.StatusCode >= 500 {
											return 2
										}
										return 1
									}(),
								},
							},
						},
					},
				},
			},
		},
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return
	}

	req, err := http.NewRequest("POST", hiaiObserveURL+"/v1/traces", bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Authorization", "Bearer "+hiaiObserveKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := traceHTTPClient.Do(req)
	if err == nil {
		_ = resp.Body.Close()
	}
}

func sendCustomOTLPTrace(serviceName, name string, durationMs float64, attributes map[string]string, isError bool) {
	if hiaiObserveKey == "" {
		return
	}
	go func() {
		traceID := randomID() + randomID() + randomID() + randomID()
		spanID := randomID() + randomID()
		now := time.Now()
		endNano := now.UnixNano()
		startNano := now.Add(-time.Duration(durationMs * float64(time.Millisecond))).UnixNano()

		attrsList := []map[string]interface{}{
			{"key": "service.name", "value": map[string]interface{}{"stringValue": serviceName}},
			{"key": "deployment.environment", "value": map[string]interface{}{"stringValue": "production"}},
		}
		for k, v := range attributes {
			attrsList = append(attrsList, map[string]interface{}{
				"key":   k,
				"value": map[string]interface{}{"stringValue": v},
			})
		}

		payload := map[string]interface{}{
			"resourceSpans": []map[string]interface{}{
				{
					"resource": map[string]interface{}{
						"attributes": attrsList[:2],
					},
					"scopeSpans": []map[string]interface{}{
						{
							"scope": map[string]interface{}{"name": serviceName + "-tracer", "version": "1.0.0"},
							"spans": []map[string]interface{}{
								{
									"traceId":           traceID,
									"spanId":            spanID,
									"name":              name,
									"kind":              1,
									"startTimeUnixNano": strconv.FormatInt(startNano, 10),
									"endTimeUnixNano":   strconv.FormatInt(endNano, 10),
									"attributes":        attrsList,
									"status": map[string]interface{}{
										"code": func() int {
											if isError {
												return 2
											}
											return 1
										}(),
									},
								},
							},
						},
					},
				},
			},
		}

		body, err := json.Marshal(payload)
		if err != nil {
			return
		}

		req, err := http.NewRequest("POST", hiaiObserveURL+"/v1/traces", bytes.NewReader(body))
		if err != nil {
			return
		}
		req.Header.Set("Authorization", "Bearer "+hiaiObserveKey)
		req.Header.Set("Content-Type", "application/json")

		resp, err := traceHTTPClient.Do(req)
		if err == nil {
			_ = resp.Body.Close()
		}
	}()
}

func sendCustomChildOTLPTrace(ctx context.Context, serviceName, name string, durationMs float64, attributes map[string]string, isError bool) {
	if hiaiObserveKey == "" {
		return
	}
	var traceID, parentSpanID string
	if ti := GetTraceInfo(ctx); ti != nil {
		traceID = ti.TraceID
		parentSpanID = ti.SpanID
	}
	if traceID == "" {
		traceID = randomID() + randomID() + randomID() + randomID()
	}
	spanID := randomID() + randomID()
	go func() {
		now := time.Now()
		endNano := now.UnixNano()
		startNano := now.Add(-time.Duration(durationMs * float64(time.Millisecond))).UnixNano()

		attrsList := []map[string]interface{}{
			{"key": "service.name", "value": map[string]interface{}{"stringValue": serviceName}},
			{"key": "deployment.environment", "value": map[string]interface{}{"stringValue": "production"}},
		}
		for k, v := range attributes {
			attrsList = append(attrsList, map[string]interface{}{
				"key":   k,
				"value": map[string]interface{}{"stringValue": v},
			})
		}

		spanObj := map[string]interface{}{
			"traceId":           traceID,
			"spanId":            spanID,
			"name":              name,
			"kind":              1,
			"startTimeUnixNano": strconv.FormatInt(startNano, 10),
			"endTimeUnixNano":   strconv.FormatInt(endNano, 10),
			"attributes":        attrsList,
			"status": map[string]interface{}{
				"code": func() int {
					if isError {
						return 2
					}
					return 1
				}(),
			},
		}
		if parentSpanID != "" {
			spanObj["parentSpanId"] = parentSpanID
		}

		payload := map[string]interface{}{
			"resourceSpans": []map[string]interface{}{
				{
					"resource": map[string]interface{}{
						"attributes": attrsList[:2],
					},
					"scopeSpans": []map[string]interface{}{
						{
							"scope": map[string]interface{}{"name": serviceName + "-tracer", "version": "1.0.0"},
							"spans": []map[string]interface{}{spanObj},
						},
					},
				},
			},
		}

		body, err := json.Marshal(payload)
		if err != nil {
			return
		}

		req, err := http.NewRequest("POST", hiaiObserveURL+"/v1/traces", bytes.NewReader(body))
		if err != nil {
			return
		}
		req.Header.Set("Authorization", "Bearer "+hiaiObserveKey)
		req.Header.Set("Content-Type", "application/json")

		resp, err := traceHTTPClient.Do(req)
		if err == nil {
			_ = resp.Body.Close()
		}
	}()
}

// TrackPogoCacheSpan gửi child span ghi nhận hoạt động đọc/ghi Pogocache
func TrackPogoCacheSpan(ctx context.Context, op, key string, durationMs float64, isHit bool, err error) {
	if ctx == nil || hiaiObserveKey == "" {
		return
	}
	hitStr := "miss"
	if isHit {
		hitStr = "hit"
	}
	statusStr := "ok"
	if err != nil {
		statusStr = "error"
	}
	name := fmt.Sprintf("🗄️ [Cache] Pogocache %s (%s)", op, hitStr)
	attrs := map[string]string{
		"db.system":           "pogocache",
		"db.operation":        op,
		"db.pogocache.key":    key,
		"db.pogocache.hit":    strconv.FormatBool(isHit),
		"db.pogocache.status": statusStr,
	}
	if err != nil {
		attrs["db.pogocache.error"] = err.Error()
	}
	sendCustomChildOTLPTrace(ctx, "omniverse-gateway", name, durationMs, attrs, err != nil)
}

type statusResponseWriter struct {
	http.ResponseWriter
	statusCode int
}

func (w *statusResponseWriter) WriteHeader(code int) {
	w.statusCode = code
	w.ResponseWriter.WriteHeader(code)
}

func tracingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		srw := &statusResponseWriter{ResponseWriter: w, statusCode: http.StatusOK}

		// Tạo hoặc kế thừa trace_id và span_id theo chuẩn W3C TraceContext
		var traceID string
		rawTP := r.Header.Get("traceparent")
		if strings.HasPrefix(rawTP, "00-") {
			parts := strings.Split(rawTP, "-")
			if len(parts) >= 3 && len(parts[1]) == 32 {
				traceID = parts[1]
			}
		}
		if traceID == "" {
			traceID = randomID() + randomID() + randomID() + randomID()
		}
		spanID := randomID() + randomID()

		// Lưu vào Context để các outbound HTTP call tới worker tự động kế thừa
		ctx := context.WithValue(r.Context(), traceCtxKey, &TraceInfo{
			TraceID: traceID,
			SpanID:  spanID,
		})

		// Gắn traceparent vào response header để client/browser có thể đọc nếu cần
		w.Header().Set("traceparent", fmt.Sprintf("00-%s-%s-01", traceID, spanID))

		next.ServeHTTP(srw, r.WithContext(ctx))

		// Phân loại request để xác định có cần trace hay không
		isRoutineHealth := (r.URL.Path == "/health" || r.URL.Path == "/api/health") && srw.statusCode < 500
		isApi := strings.HasPrefix(r.URL.Path, "/api/")
		isErrorOrProbe := srw.statusCode >= 400

		isSensitiveProbe := false
		lowerPath := strings.ToLower(r.URL.Path)
		for _, probePattern := range []string{".env", ".git", "wp-", "admin", "phpmyadmin", ".yaml", ".yml", ".json", "passwd", "config"} {
			if strings.Contains(lowerPath, probePattern) {
				isSensitiveProbe = true
				break
			}
		}

		shouldTrace := false
		isSecurityProbe := false

		if isRoutineHealth {
			// Bỏ qua healthcheck thành công thường kỳ (200 OK) để tránh nhiễu log
			shouldTrace = false
		} else if isApi {
			shouldTrace = true
			if isSensitiveProbe || (srw.statusCode == http.StatusNotFound && isSensitiveProbe) {
				isSecurityProbe = true
			}
		} else if isErrorOrProbe || isSensitiveProbe {
			// Bắt toàn bộ các request probe/attack ngoài prefix /api/ (ví dụ /.env, /.git/config, /admin)
			shouldTrace = true
			isSecurityProbe = true
		}

		if shouldTrace {
			durationMs := float64(time.Since(start).Microseconds()) / 1000.0
			clientIP := r.Header.Get("X-Forwarded-For")
			if clientIP == "" {
				clientIP = r.RemoteAddr
			}
			item := &otlpSpanItem{
				TraceID:         traceID,
				SpanID:          spanID,
				Name:            getFriendlySpanName(r.Method, r.URL.Path, srw.statusCode, isSecurityProbe),
				Route:           r.URL.Path,
				Method:          r.Method,
				StatusCode:      srw.statusCode,
				DurationMs:      durationMs,
				StartTime:       start,
				ClientIP:        clientIP,
				IsSecurityProbe: isSecurityProbe,
			}
			select {
			case traceChan <- item:
			default:
				if len(traceChan) >= traceChanCapacity {
					log.Printf("⚠️ [TRACER] Buffer traceChan đạt tối đa (%d), drop span %s", traceChanCapacity, item.Name)
				}
			}
		}
	})
}
