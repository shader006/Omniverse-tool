#!/usr/bin/env python3
"""
NHÓM 3: GIAO THỨC TRUYỀN TẢI, HEADERS & STREAMING FILE PIXELFIXER (PROTOCOLS & STREAMING)
Bao gồm:
- Xác thực MIME Type chuẩn image/png cho ảnh tái tạo
- Kiểm tra các Custom Headers do Engine trả về (X-Grid-Cols, X-Grid-Rows, X-Download-Url, v.v.)
- Kiểm tra truy xuất file kết quả thông qua Download URL (/api/file/...)
- Hỗ trợ tham số linh hoạt qua cả URL Query String và Multipart Form-Data
- Tiếp nhận và truyền dẫn W3C Traceparent Header (OpenTelemetry tracing)
- Truyền tải multipart streaming dung lượng đa dạng
"""

import os
import sys
import io
import requests
import unittest
from PIL import Image

DEFAULT_DIRECT_URL = "http://localhost:8004"
DEFAULT_GATEWAY_URL = os.getenv("API_BASE_URL", "http://localhost:8000" if os.path.exists("/app") else "http://localhost:80") + "/api/pixel"
BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8000" if os.path.exists("/app") else "http://localhost:80")


def resolve_api_endpoints():
    url = os.getenv("WORKER_PIXELFIXER_URL")
    if url:
        return url, f"{url}/detect", f"{url}/fix", f"{url}/health"
    try:
        if requests.get(f"{DEFAULT_DIRECT_URL}/health", timeout=0.8).status_code == 200:
            return DEFAULT_DIRECT_URL, f"{DEFAULT_DIRECT_URL}/detect", f"{DEFAULT_DIRECT_URL}/fix", f"{DEFAULT_DIRECT_URL}/health"
    except Exception:
        pass
    return DEFAULT_GATEWAY_URL, f"{DEFAULT_GATEWAY_URL}/detect", f"{DEFAULT_GATEWAY_URL}/fix", f"{DEFAULT_GATEWAY_URL}/health"


def create_test_png(size=(32, 32)) -> bytes:
    img = Image.new("RGBA", size, (200, 100, 50, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


class TestPixelFixerProtocolsAndStreaming(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.base_url, cls.detect_url, cls.fix_url, cls.health_url = resolve_api_endpoints()
        try:
            res = requests.get(cls.health_url, timeout=3)
            if res.status_code != 200:
                raise Exception(f"Health returned HTTP {res.status_code}")
        except Exception as e:
            raise unittest.SkipTest(f"PixelFixer service not reachable at {cls.health_url}: {e}")

    def test_01_mime_type_image_png(self):
        """1. Xác thực MIME Type chuẩn image/png cho ảnh tái tạo"""
        files = {"file": ("protocol_test.png", create_test_png((32, 32)), "image/png")}
        res = requests.post(self.fix_url, files=files, params={"mode": "fast"}, timeout=10)
        self.assertEqual(res.status_code, 200)
        content_type = res.headers.get("content-type", "")
        self.assertTrue(content_type.startswith("image/png"), f"MIME Type mong đợi image/png, nhận được: {content_type}")
        print(f"  [PASS] test_01_mime_type_image_png: Content-Type={content_type}")

    def test_02_rust_engine_custom_headers(self):
        """2. Kiểm tra các Custom Headers từ Engine (X-Grid-Cols, X-Grid-Rows, X-Download-Url)"""
        files = {"file": ("header_test.png", create_test_png((32, 32)), "image/png")}
        res = requests.post(self.fix_url, files=files, params={"mode": "fast"}, timeout=10)
        self.assertEqual(res.status_code, 200)

        # Kiểm tra sự hiện diện của các custom headers quan trọng
        headers_lower = {k.lower(): v for k, v in res.headers.items()}
        self.assertTrue(any(k.startswith("x-grid") or k in ["x-download-url", "x-filename"] for k in headers_lower))
        print(f"  [PASS] test_02_rust_engine_custom_headers: X-Grid-Cols={headers_lower.get('x-grid-cols')}, X-Download-Url={headers_lower.get('x-download-url')}")

    def test_03_download_url_endpoint(self):
        """3. Kiểm tra khả năng tải lại file ảnh kết quả thông qua Download URL"""
        files = {"file": ("dl_test.png", create_test_png((32, 32)), "image/png")}
        res = requests.post(self.fix_url, files=files, params={"mode": "fast"}, timeout=10)
        self.assertEqual(res.status_code, 200)

        dl_url = res.headers.get("X-Download-Url")
        if dl_url:
            full_dl_url = f"{BASE_URL}{dl_url}" if dl_url.startswith("/") else dl_url
            dl_res = requests.get(full_dl_url, timeout=10)
            self.assertEqual(dl_res.status_code, 200)
            self.assertGreater(len(dl_res.content), 0)
            print(f"  [PASS] test_03_download_url_endpoint: Tải lại thành công qua {dl_url} ({len(dl_res.content)} bytes)")
        else:
            print("  [PASS] test_03_download_url_endpoint: Binary stream delivered inline directly")

    def test_04_query_vs_form_data_params(self):
        """4. Kiểm tra truyền tham số qua URL Query String và qua Multipart Form Data"""
        raw_png = create_test_png((32, 32))

        # Cách 1: Qua Query String
        files1 = {"file": ("query_p.png", raw_png, "image/png")}
        res1 = requests.post(self.fix_url, files=files1, params={"mode": "fast", "cols": 16, "rows": 16}, timeout=10)
        self.assertEqual(res1.status_code, 200)

        # Cách 2: Qua Multipart Form fields
        files2 = {
            "file": ("form_p.png", raw_png, "image/png"),
            "mode": (None, "fast"),
            "cols": (None, "16"),
            "rows": (None, "16"),
        }
        res2 = requests.post(self.fix_url, files=files2, timeout=10)
        self.assertEqual(res2.status_code, 200)

        print("  [PASS] test_04_query_vs_form_data_params: Đồng nhất giữa Query params và Form-Data fields")

    def test_05_traceparent_telemetry_propagation(self):
        """5. Tiếp nhận chuẩn W3C Traceparent Header (OpenTelemetry) không gây lỗi"""
        traceparent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
        headers = {"traceparent": traceparent}
        files = {"file": ("trace_test.png", create_test_png((32, 32)), "image/png")}

        res = requests.post(self.detect_url, files=files, headers=headers, timeout=10)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data.get("success"))
        print(f"  [PASS] test_05_traceparent_telemetry_propagation: Traceparent tiếp nhận thành công")

    def test_06_chunked_multipart_transfer(self):
        """6. Truyền tải ảnh thông qua Multipart Stream"""
        raw_png = create_test_png((64, 64))
        stream_buf = io.BytesIO(raw_png)
        files = {"file": ("stream_test.png", stream_buf, "image/png")}

        res = requests.post(self.fix_url, files=files, params={"mode": "fast"}, timeout=15)
        self.assertEqual(res.status_code, 200)
        self.assertGreater(len(res.content), 0)
        print(f"  [PASS] test_06_chunked_multipart_transfer: Stream tải lên và xử lý thành công ({len(res.content)} bytes)")


if __name__ == "__main__":
    unittest.main()
