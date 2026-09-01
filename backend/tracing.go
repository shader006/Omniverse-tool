package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

type otlpSpanItem struct {
	Name       string
	Route      string
	Method     string
	StatusCode int
	DurationMs float64
	StartTime  time.Time
	ClientIP   string
}

var (
	traceChan       = make(chan *otlpSpanItem, 1000)
	hiaiObserveURL  = func() string {
		if u := os.Getenv("HIAI_OBSERVE_URL"); u != "" {
			return u
		}
		return "http://172.17.0.1:8001"
	}()
	hiaiObserveKey  = func() string {
		if k := os.Getenv("HIAI_OBSERVE_API_KEY"); k != "" {
			return k
		}
		return "ho_24c101b8a34b64f6af3f08be38a18fbb650a94af37236779"
	}()
	traceHTTPClient = &http.Client{Timeout: 2 * time.Second}
)

func initTracer() {
	go func() {
		for item := range traceChan {
			sendGatewayOTLPTrace(item)
		}
	}()
}

func generateHexID(n int) string {
	return randomID() + randomID()
}

func sendGatewayOTLPTrace(item *otlpSpanItem) {
	traceID := randomID() + randomID() + randomID() + randomID()
	spanID := randomID() + randomID()
	startNano := item.StartTime.UnixNano()
	endNano := item.StartTime.Add(time.Duration(item.DurationMs * float64(time.Millisecond))).UnixNano()

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
								"attributes": []map[string]interface{}{
									{"key": "http.route", "value": map[string]interface{}{"stringValue": item.Route}},
									{"key": "http.method", "value": map[string]interface{}{"stringValue": item.Method}},
									{"key": "http.status_code", "value": map[string]interface{}{"intValue": strconv.Itoa(item.StatusCode)}},
									{"key": "net.peer.ip", "value": map[string]interface{}{"stringValue": item.ClientIP}},
								},
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
		next.ServeHTTP(srw, r)

		if strings.HasPrefix(r.URL.Path, "/api/") && r.URL.Path != "/api/health" && r.URL.Path != "/health" {
			durationMs := float64(time.Since(start).Microseconds()) / 1000.0
			clientIP := r.Header.Get("X-Forwarded-For")
			if clientIP == "" {
				clientIP = r.RemoteAddr
			}
			item := &otlpSpanItem{
				Name:       fmt.Sprintf("%s %s", r.Method, r.URL.Path),
				Route:      r.URL.Path,
				Method:     r.Method,
				StatusCode: srw.statusCode,
				DurationMs: durationMs,
				StartTime:  start,
				ClientIP:   clientIP,
			}
			select {
			case traceChan <- item:
			default:
			}
		}
	})
}
