#!/usr/bin/env python3
"""
NHÓM 5: AN TOÀN BẢO MẬT & XÁC THỰC DỮ LIỆU PIXELFIXER (SECURITY & VALIDATION)
Bao gồm:
- Chặn đứng các tệp thực thi nguy hiểm (.exe, .sh, .py, .bin)
- Chống tấn công Path Traversal trên tên file upload (../../etc/passwd.png)
- Phát hiện và từ chối MIME Spoofing (file text/HTML giả mạo header image/png)
- Cưỡng chế giới hạn kích thước tối đa (Max Body Limit)
- Ngăn chặn rò rỉ Stacktrace / đường dẫn tuyệt đối nhạy cảm của hệ điều hành
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


class TestPixelFixerSecurityAndValidation(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.base_url, cls.detect_url, cls.fix_url, cls.health_url = resolve_api_endpoints()
        try:
            res = requests.get(cls.health_url, timeout=3)
            if res.status_code != 200:
                raise Exception(f"Health returned HTTP {res.status_code}")
        except Exception as e:
            raise unittest.SkipTest(f"PixelFixer service not reachable at {cls.health_url}: {e}")

    def test_01_block_executable_files(self):
        """1. Chặn đứng các file thực thi nguy hiểm (.exe, .sh, .py, .bin)"""
        malicious_files = [
            ("evil.exe", b"MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xffExecutablePE", "application/x-msdownload"),
            ("exploit.sh", b"#!/bin/bash\nrm -rf / --no-preserve-root\n", "application/x-sh"),
            ("payload.bin", b"\x7fELF\x02\x01\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00LinuxELF", "application/octet-stream"),
            ("malware.py", b"import os; os.system('cat /etc/passwd')", "text/x-python"),
        ]

        for fname, content, mime in malicious_files:
            files = {"file": (fname, content, mime)}
            res = requests.post(self.detect_url, files=files, timeout=10)
            self.assertEqual(res.status_code, 400, f"File thực thi {fname} không bị chặn với mã 400")
            data = res.json()
            self.assertFalse(data.get("success", True))
        print("  [PASS] test_01_block_executable_files: Chặn 100% các file thực thi nguy hiểm")

    def test_02_path_traversal_filename_sanitization(self):
        """2. Chống tấn công Path Traversal trên tên file tải lên (../../etc/passwd.png)"""
        img = Image.new("RGBA", (16, 16), (255, 100, 0, 255))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        valid_png = buf.getvalue()

        traversal_names = [
            "../../etc/passwd.png",
            "..%2f..%2fetc%2fshadow.png",
            "/var/run/secrets.png",
            "....//....//config.json.png",
        ]

        for bad_name in traversal_names:
            files = {"file": (bad_name, valid_png, "image/png")}
            res = requests.post(self.fix_url, files=files, params={"mode": "fast"}, timeout=10)
            self.assertEqual(res.status_code, 200)

            # Kiểm tra tên file trong headers trả về không bao giờ được chứa dấu ../ hoặc đường dẫn tuyệt đối
            dl_url = res.headers.get("X-Download-Url", "")
            fname = res.headers.get("X-Filename", "")
            self.assertNotIn("..", dl_url)
            self.assertNotIn("..", fname)
            self.assertNotIn("/etc/", dl_url)
        print("  [PASS] test_02_path_traversal_filename_sanitization: Tên file độc hại được sanitize an toàn tuyệt đối")

    def test_03_mime_spoofing_rejection(self):
        """3. Phát hiện và từ chối tệp HTML/Text giả mạo MIME type image/png"""
        fake_images = [
            ("phishing.png", b"<!DOCTYPE html><html><body><script>alert('XSS')</script></body></html>", "image/png"),
            ("script.png", b"console.log('injected');", "image/png"),
        ]

        for fname, content, mime in fake_images:
            files = {"file": (fname, content, mime)}
            res = requests.post(self.detect_url, files=files, timeout=10)
            self.assertEqual(res.status_code, 400)
            data = res.json()
            self.assertFalse(data.get("success", True))
        print("  [PASS] test_03_mime_spoofing_rejection: Chặn đứng các tệp HTML/Text giả mạo image/png")

    def test_04_oversized_payload_rejection(self):
        """4. Cưỡng chế giới hạn kích thước tải lên an toàn (xử lý payload vượt mức)"""
        # Kiểm tra payload lớn giả lập không gây tràn bộ nhớ worker
        oversized_noise = b"PNG_FAKE_HEADER" + (b"\x00" * (1024 * 1024 * 5)) # 5MB garbage
        files = {"file": ("oversized.png", oversized_noise, "image/png")}
        res = requests.post(self.detect_url, files=files, timeout=10)
        self.assertIn(res.status_code, [400, 413, 422])
        print("  [PASS] test_04_oversized_payload_rejection: Từ chối payload dung lượng bất thường an toàn")

    def test_05_no_internal_stacktrace_or_path_leak(self):
        """5. Ngăn chặn rò rỉ Stacktrace / đường dẫn tuyệt đối nhạy cảm khi gặp lỗi"""
        files = {"file": ("error_probe.png", b"INVALID_BYTE_STREAM", "image/png")}
        res = requests.post(self.detect_url, files=files, timeout=10)
        self.assertEqual(res.status_code, 400)

        body_str = res.text.lower()
        forbidden_substrings = ["/home/", "/root/", "panic at", "traceback (most recent call last)"]
        for forbidden in forbidden_substrings:
            self.assertNotIn(forbidden, body_str, f"Phản hồi làm rò rỉ chuỗi nhạy cảm: {forbidden}")
        print("  [PASS] test_05_no_internal_stacktrace_or_path_leak: Phản hồi lỗi sạch sẽ, không rò rỉ hệ thống nội bộ")


if __name__ == "__main__":
    unittest.main()
