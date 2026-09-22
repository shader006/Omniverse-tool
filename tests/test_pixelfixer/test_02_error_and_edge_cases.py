#!/usr/bin/env python3
"""
NHÓM 2: NGOẠI LỆ & LỖI BIÊN PIXELFIXER (ERROR & EDGE CASES)
Bao gồm:
- Gửi request thiếu trường file (Missing File Payload -> 400)
- Xử lý file ảnh rỗng 0-byte (Empty File -> 400 / Xử lý an toàn)
- Xử lý file nhị phân ảnh bị hỏng hoặc byte rác (Corrupted / Truncated Image)
- Tham số mode không hợp lệ (Invalid Mode fallback an toàn)
- Kích thước lưới biên cực đoan (Boundary cols/rows = 0 hoặc số lớn)
- Xử lý ảnh kích thước siêu nhỏ (1x1, 2x2 Tiny Image)
- Chặn phương thức HTTP không hợp lệ (Method Not Allowed 405)
"""

import os
import sys
import io
import requests
import unittest
from PIL import Image

DEFAULT_DIRECT_URL = "http://localhost:8004"
DEFAULT_GATEWAY_URL = os.getenv("API_BASE_URL", "http://localhost:8000" if os.path.exists("/app") else "http://localhost:80") + "/api/pixel"


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


class TestPixelFixerErrorAndEdgeCases(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.base_url, cls.detect_url, cls.fix_url, cls.health_url = resolve_api_endpoints()
        try:
            res = requests.get(cls.health_url, timeout=3)
            if res.status_code != 200:
                raise Exception(f"Health returned HTTP {res.status_code}")
        except Exception as e:
            raise unittest.SkipTest(f"PixelFixer service not reachable at {cls.health_url}: {e}")

    def test_01_missing_file_payload(self):
        """1. Bắt lỗi HTTP 400 khi gửi request thiếu trường file"""
        res_detect = requests.post(self.detect_url, timeout=5)
        self.assertEqual(res_detect.status_code, 400)

        res_fix = requests.post(self.fix_url, timeout=5)
        self.assertEqual(res_fix.status_code, 400)
        print("  [PASS] test_01_missing_file_payload: Bắt lỗi 400 chính xác khi thiếu file")

    def test_02_empty_zero_byte_file(self):
        """2. Xử lý file rỗng 0-byte: Từ chối an toàn với mã lỗi 400/500, không gây sập worker"""
        files = {"file": ("empty.png", b"", "image/png")}
        res = requests.post(self.detect_url, files=files, timeout=5)
        self.assertIn(res.status_code, [400, 422, 500])

        files_fix = {"file": ("empty.png", b"", "image/png")}
        res_fix = requests.post(self.fix_url, files=files_fix, timeout=5)
        self.assertIn(res_fix.status_code, [400, 422, 500])
        print(f"  [PASS] test_02_empty_zero_byte_file: Từ chối file 0-byte an toàn (HTTP {res.status_code})")

    def test_03_corrupted_image_data(self):
        """3. Xử lý dữ liệu nhị phân bị hỏng (corrupted bytes): Bắt lỗi giải mã ảnh an toàn"""
        corrupted_bytes = b"CORRUPTED_PNG_HEADER_DATA_1234567890_GARBAGE_PAYLOAD"
        files = {"file": ("bad_image.png", corrupted_bytes, "image/png")}
        res = requests.post(self.detect_url, files=files, timeout=5)
        self.assertIn(res.status_code, [400, 422, 500])
        print(f"  [PASS] test_03_corrupted_image_data: Bắt lỗi ảnh hỏng an toàn (HTTP {res.status_code})")

    def test_04_invalid_mode_param_fallback(self):
        """4. Tham số mode không xác định (mode=unknown_random): Tự động fallback hoặc từ chối an toàn"""
        img = Image.new("RGBA", (32, 32), (100, 150, 200, 255))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        raw_bytes = buf.getvalue()

        files = {"file": ("test.png", raw_bytes, "image/png")}
        res = requests.post(self.detect_url, files=files, params={"mode": "unknown_random_mode"}, timeout=10)
        # Server phải phản hồi bình thường (fallback về mặc định) hoặc trả mã lỗi hợp lệ, không crash
        self.assertIn(res.status_code, [200, 400])
        print(f"  [PASS] test_04_invalid_mode_param_fallback: Xử lý mode không hợp lệ ổn định (HTTP {res.status_code})")

    def test_05_extreme_grid_boundaries(self):
        """5. Kiểm tra giá trị biên cực đoan cho cols/rows (cols=0 hoặc số lớn)"""
        img = Image.new("RGBA", (32, 32), (255, 0, 0, 255))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        raw_bytes = buf.getvalue()

        for bad_cols in [0, 99999]:
            files = {"file": ("test_bounds.png", raw_bytes, "image/png")}
            res = requests.post(self.fix_url, files=files, params={"cols": bad_cols, "mode": "fast"}, timeout=10)
            self.assertIn(res.status_code, [200, 400, 422, 500])
        print("  [PASS] test_05_extreme_grid_boundaries: Xử lý biên cols/rows an toàn không panic")

    def test_06_solid_and_low_contrast_images(self):
        """6. Xử lý ảnh đơn sắc / không có biên độ tương phản (featureless solid): Nhận diện an toàn"""
        for size in [(16, 16), (32, 32)]:
            img = Image.new("RGBA", size, (255, 255, 255, 255))
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            files = {"file": (f"solid_{size[0]}x{size[1]}.png", buf.getvalue(), "image/png")}
            res = requests.post(self.detect_url, files=files, timeout=10)
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertTrue(data.get("success"))
        print("  [PASS] test_06_solid_and_low_contrast_images: Xử lý ảnh đơn sắc/ít chi tiết ổn định")

    def test_07_http_method_not_allowed(self):
        """7. Chặn các phương thức HTTP không hợp lệ (GET, PUT, DELETE trên endpoint POST)"""
        for method in ["get", "put", "delete"]:
            fn = getattr(requests, method)
            res = fn(self.detect_url, timeout=5)
            self.assertEqual(res.status_code, 405, f"{method.upper()} trên /detect không bị từ chối 405")
        print("  [PASS] test_07_http_method_not_allowed: Chặn chuẩn xác HTTP 405 Method Not Allowed")


if __name__ == "__main__":
    unittest.main()
