#!/usr/bin/env python3
"""
NHÓM 2: KIỂM THỬ XÁC THỰC DỮ LIỆU & BẢO MẬT AI UPSCALER (VALIDATION & SECURITY)
Bao gồm:
- Chặn các tệp thực thi hoặc không phải ảnh (.exe, .sh, .txt) với HTTP 400
- Bắt lỗi dữ liệu ảnh hỏng (Corrupted bytes) với HTTP 400
- Chống Path Traversal trên tên file tải lên (../../etc/passwd.png)
- Chặn các phương thức HTTP không hợp lệ (GET, PUT, DELETE trên /api/upscale -> 405)
"""

import os
import io
import unittest
import requests
from PIL import Image

BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8000" if os.path.exists("/app") else "http://localhost:80")


class TestUpscalerValidationAndSecurity(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        try:
            res = requests.get(f"{BASE_URL}/api/upscale/health", timeout=5)
            if res.status_code != 200:
                raise Exception(f"HTTP {res.status_code}")
        except Exception as e:
            raise unittest.SkipTest(f"Upscaler service không khả dụng tại {BASE_URL}: {e}")

    def test_01_block_unsupported_extensions(self):
        """1. Chặn tải lên các định dạng không phải ảnh (.exe, .sh, .txt)"""
        bad_files = [
            ("malware.exe", b"MZ\x90\x00ExecutablePayload", "application/octet-stream"),
            ("script.sh", b"#!/bin/sh\necho pwn", "application/x-sh"),
            ("notes.txt", b"Plain text content", "text/plain"),
        ]
        for fname, content, mime in bad_files:
            files = {"file": (fname, content, mime)}
            res = requests.post(f"{BASE_URL}/api/upscale", files=files, data={"scale": "2"}, timeout=10)
            self.assertEqual(res.status_code, 400, f"File {fname} phải bị từ chối với 400")
            body = res.json()
            self.assertFalse(body.get("success", True))
        print("  [PASS] test_01_block_unsupported_extensions: Chặn đứng .exe, .sh, .txt với HTTP 400")

    def test_02_corrupted_image_bytes(self):
        """2. Bắt lỗi HTTP 400 khi gửi dữ liệu ảnh bị hỏng (Corrupted Image)"""
        files = {"file": ("corrupt.png", b"NOT_A_VALID_PNG_IMAGE_PAYLOAD", "image/png")}
        res = requests.post(f"{BASE_URL}/api/upscale", files=files, data={"scale": "2"}, timeout=10)
        self.assertEqual(res.status_code, 400)
        body = res.json()
        self.assertFalse(body.get("success", True))
        print("  [PASS] test_02_corrupted_image_bytes: Từ chối ảnh lỗi an toàn với HTTP 400")

    def test_03_path_traversal_filename_sanitization(self):
        """3. Làm sạch tên file chứa Path Traversal (../../etc/passwd.png)"""
        img = Image.new("RGB", (16, 16), (100, 200, 100))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        files = {"file": ("../../etc/passwd.png", buf.getvalue(), "image/png")}

        res = requests.post(f"{BASE_URL}/api/upscale", files=files, data={"scale": "2"}, timeout=60)
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertNotIn("..", body.get("filename", ""))
        self.assertNotIn("/", body.get("filename", ""))
        print(f"  [PASS] test_03_path_traversal_filename_sanitization: Tên file xuất an toàn: {body.get('filename')}")

    def test_04_method_not_allowed(self):
        """4. Chặn phương thức GET/PUT/DELETE trên /api/upscale với HTTP 405"""
        for method in ["get", "put", "delete"]:
            fn = getattr(requests, method)
            res = fn(f"{BASE_URL}/api/upscale", timeout=5)
            self.assertEqual(res.status_code, 405)
        print("  [PASS] test_04_method_not_allowed: Chặn GET/PUT/DELETE với HTTP 405")


if __name__ == "__main__":
    unittest.main()

