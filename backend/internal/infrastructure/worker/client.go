package worker

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"strings"

	"omniverse_backend/internal/infrastructure/telemetry"
)

// HTTPClient interface để dễ dàng mock trong unit test
type HTTPClient interface {
	Do(req *http.Request) (*http.Response, error)
}

// Client quản lý giao tiếp HTTP với các worker microservices
type Client struct {
	httpClient     HTTPClient
	httpLongClient HTTPClient
}

func NewClient(httpClient HTTPClient, httpLongClient HTTPClient) *Client {
	return &Client{
		httpClient:     httpClient,
		httpLongClient: httpLongClient,
	}
}

func (c *Client) CallWorkerJSON(ctx context.Context, workerBaseURL string, path string, payload interface{}) ([]byte, int, error) {
	jsonBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, http.StatusBadRequest, err
	}
	targetURL := strings.TrimRight(workerBaseURL, "/") + path
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, targetURL, bytes.NewReader(jsonBytes))
	if err != nil {
		return nil, http.StatusInternalServerError, err
	}
	req.Header.Set("Content-Type", "application/json")
	telemetry.InjectTraceparent(ctx, req)
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, http.StatusBadGateway, err
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	return respBody, resp.StatusCode, err
}

func (c *Client) ForwardMultipartToWorker(ctx context.Context, workerBaseURL string, path string, fileBytes []byte, filename string, fieldName string, formValues map[string]string) ([]byte, int, error) {
	bodyBuf := bytes.NewBuffer(make([]byte, 0, len(fileBytes)+2048))
	writer := multipart.NewWriter(bodyBuf)
	part, err := writer.CreateFormFile(fieldName, filename)
	if err != nil {
		return nil, http.StatusInternalServerError, err
	}
	if _, err := part.Write(fileBytes); err != nil {
		return nil, http.StatusInternalServerError, err
	}
	for k, v := range formValues {
		_ = writer.WriteField(k, v)
	}
	if err := writer.Close(); err != nil {
		return nil, http.StatusInternalServerError, err
	}

	targetURL := strings.TrimRight(workerBaseURL, "/") + path
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, targetURL, bodyBuf)
	if err != nil {
		return nil, http.StatusInternalServerError, err
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	telemetry.InjectTraceparent(ctx, req)
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, http.StatusBadGateway, err
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	return respBody, resp.StatusCode, err
}

func (c *Client) ForwardMultipartToWorkerLong(ctx context.Context, workerBaseURL string, path string, fileBytes []byte, filename string, fieldName string, formValues map[string]string) ([]byte, int, error) {
	bodyBuf := bytes.NewBuffer(make([]byte, 0, len(fileBytes)+2048))
	writer := multipart.NewWriter(bodyBuf)
	part, err := writer.CreateFormFile(fieldName, filename)
	if err != nil {
		return nil, http.StatusInternalServerError, err
	}
	if _, err := part.Write(fileBytes); err != nil {
		return nil, http.StatusInternalServerError, err
	}
	for k, v := range formValues {
		_ = writer.WriteField(k, v)
	}
	if err := writer.Close(); err != nil {
		return nil, http.StatusInternalServerError, err
	}

	targetURL := strings.TrimRight(workerBaseURL, "/") + path
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, targetURL, bodyBuf)
	if err != nil {
		return nil, http.StatusInternalServerError, err
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	telemetry.InjectTraceparent(ctx, req)
	resp, err := c.httpLongClient.Do(req)
	if err != nil {
		return nil, http.StatusBadGateway, err
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	return respBody, resp.StatusCode, err
}
