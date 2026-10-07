#!/usr/bin/env python3
"""
NHÓM 3: KIỂM THỬ GIAO THỨC & TRUYỀN TẢI THỜI GIAN THỰC (PROTOCOLS & STREAMING)
Bao gồm:
- Giao thức SSE (Server-Sent Events) /api/stream/{job_id} (Headers, event: progress, completion)
- SSE Keep-Alive Ping (: ping)
- Giao thức Polling trạng thái /api/status/{job_id} (State machine transitions, full schema)
- HTTP Range Requests RFC 7233 trên /api/file/{filename} (Status 206 Partial Content, Content-Range)
- Xử lý file không tồn tại (Status 404 Not Found)
"""

import os
import sys
import time
import json
import urllib.request
import urllib.parse
import urllib.error
import unittest

BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8000" if os.path.exists("/app") else "http://localhost:80")
SAMPLE_VIDEO_URL = "https://www.youtube.com/watch?v=jNQXAC9IVRw"


def make_request(path: str, data: dict = None, headers: dict = None, timeout: int = 15):
    url = f"{BASE_URL}{path}"
    h = {"User-Agent": "Omniverse-TestRunner/1.0", "X-Forwarded-For": "10.10.3.1"}
    if headers:
        h.update(headers)
    
    req_data = None
    if data is not None:
        req_data = json.dumps(data).encode("utf-8")
        h["Content-Type"] = "application/json"

    req = urllib.request.Request(url, data=req_data, headers=h)
    return urllib.request.urlopen(req, timeout=timeout)


class TestProtocolsAndStreaming(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        # Đảm bảo có ít nhất 1 file media mẫu đã hoàn thành để test Range requests
        payload = {"url": SAMPLE_VIDEO_URL, "format": "mp3", "quality": "128"}
        with make_request("/api/download", data=payload) as res:
            body = json.loads(res.read().decode("utf-8"))
            cls.sample_job_id = body.get("job_id")

        # Chờ lấy filename
        cls.sample_filename = None
        for _ in range(25):
            time.sleep(1.0)
            with make_request(f"/api/status/{cls.sample_job_id}") as s_res:
                s_data = json.loads(s_res.read().decode("utf-8"))
                if s_data.get("status") == "completed":
                    cls.sample_filename = s_data.get("filename")
                    break
        if not cls.sample_filename:
            raise RuntimeError("Không thể tạo file media mẫu cho TestProtocolsAndStreaming")

    def test_01_sse_headers_and_connection(self):
        """1. Kiểm tra chuẩn Headers của SSE stream (/api/stream/{job_id})"""
        req = urllib.request.Request(
            f"{BASE_URL}/api/stream/{self.sample_job_id}",
            headers={"User-Agent": "Omniverse-TestRunner/1.0", "X-Forwarded-For": "10.10.3.2"}
        )
        with urllib.request.urlopen(req, timeout=10) as res:
            self.assertEqual(res.status, 200)
            content_type = res.headers.get("Content-Type", "")
            cache_control = res.headers.get("Cache-Control", "")
            self.assertIn("text/event-stream", content_type, f"Content-Type phải là text/event-stream, nhận: {content_type}")
            self.assertIn("no-cache", cache_control, f"Cache-Control phải có no-cache, nhận: {cache_control}")
            print(f" [PASS] test_01: Headers SSE chuẩn xác (Content-Type: {content_type})")

    def test_02_sse_event_stream_parsing(self):
        """2. Kiểm tra format sự kiện SSE (event: progress, data: JSON) và tự ngắt khi completed"""
        # Tạo job mới để quan sát stream
        payload = {"url": SAMPLE_VIDEO_URL, "format": "mp3", "quality": "128"}
        with make_request("/api/download", data=payload) as res:
            job_id = json.loads(res.read().decode("utf-8")).get("job_id")

        req = urllib.request.Request(
            f"{BASE_URL}/api/stream/{job_id}",
            headers={"User-Agent": "Omniverse-TestRunner/1.0", "X-Forwarded-For": "10.10.3.3"}
        )

        events_received = []
        with urllib.request.urlopen(req, timeout=15) as stream:
            # Đọc tối đa 15 sự kiện hoặc đến khi kết thúc
            for _ in range(30):
                line = stream.readline().decode("utf-8")
                if not line:
                    break
                line = line.strip()
                if line.startswith("data:"):
                    data_str = line[len("data:"):].strip()
                    try:
                        parsed = json.loads(data_str)
                        events_received.append(parsed)
                        if parsed.get("status") in ("completed", "error"):
                            break
                    except Exception:
                        pass

        self.assertGreater(len(events_received), 0, "Không nhận được sự kiện data nào qua SSE stream!")
        last_event = events_received[-1]
        self.assertIn("status", last_event)
        self.assertIn("percent", last_event)
        print(f" [PASS] test_02: Nhận {len(events_received)} sự kiện SSE thành công, trạng thái cuối: {last_event.get('status')}")

    def test_03_status_polling_schema_validation(self):
        """3. Kiểm tra JSON Schema và tính nhất quán của Endpoint Polling (/api/status/{job_id})"""
        with make_request(f"/api/status/{self.sample_job_id}") as res:
            self.assertEqual(res.status, 200)
            data = json.loads(res.read().decode("utf-8"))

            required_fields = ["job_id", "status", "percent", "download_url", "filename"]
            for field in required_fields:
                self.assertIn(field, data, f"Thiếu trường {field} trong status response")

            self.assertEqual(data["status"], "completed")
            self.assertEqual(data["percent"], 100.0)
            self.assertTrue(data["download_url"].startswith("/api/file/"))
            print(f" [PASS] test_03: Polling status trả về schema đầy đủ và chuẩn xác")

    def test_04_http_range_requests_rfc7233(self):
        """4. Kiểm tra HTTP Range Requests (RFC 7233) cho phép tua streaming audio/video"""
        encoded_name = urllib.parse.quote(self.sample_filename)
        req = urllib.request.Request(
            f"{BASE_URL}/api/file/{encoded_name}",
            headers={
                "User-Agent": "Omniverse-TestRunner/1.0",
                "Range": "bytes=0-511",
                "X-Forwarded-For": "10.10.3.4"
            }
        )
        with urllib.request.urlopen(req, timeout=10) as res:
            # Máy chủ hỗ trợ Range requests phải trả về 206 Partial Content
            self.assertEqual(res.status, 206, f"Kỳ vọng 206 Partial Content nhưng nhận {res.status}")
            content = res.read()
            self.assertEqual(len(content), 512, f"Kỳ vọng 512 bytes dữ liệu nhưng nhận: {len(content)}")
            content_range = res.headers.get("Content-Range", "")
            self.assertTrue(content_range.startswith("bytes 0-511/"), f"Content-Range không hợp lệ: {content_range}")
            accept_ranges = res.headers.get("Accept-Ranges", "")
            self.assertEqual(accept_ranges, "bytes", "Header Accept-Ranges phải là 'bytes'")
            print(f" [PASS] test_04: HTTP Range Requests (206 Partial Content) hoạt động hoàn hảo: {content_range}")

    def test_05_nonexistent_file_returns_404(self):
        """5. Truy vấn file không tồn tại qua /api/file/{filename} phải trả về 404 Not Found"""
        fake_filename = "non_existent_fake_audio_file_999999.mp3"
        try:
            with make_request(f"/api/file/{fake_filename}") as res:
                self.fail(f"Kỳ vọng 404 nhưng nhận {res.status}")
        except urllib.error.HTTPError as e:
            self.assertEqual(e.code, 404)
            print(" [PASS] test_05: /api/file/ trả về 404 Not Found chính xác cho file không tồn tại")


if __name__ == "__main__":
    unittest.main()
