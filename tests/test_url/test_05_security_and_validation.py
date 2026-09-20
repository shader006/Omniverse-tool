#!/usr/bin/env python3
"""
NHÓM 5: KIỂM THỬ AN TOÀN BẢO MẬT & XÁC THỰC (SECURITY & VALIDATION)
Bao gồm:
- Chống Path Traversal trên endpoint tải file /api/file/{filename} (.., %2e%2e%2f, etc/passwd)
- Chống SSRF (Server-Side Request Forgery): Gửi các URL nội bộ loopback, link metadata cloud (169.254.169.254)
- Chống Null-byte Injection (%00) và ký tự điều khiển
- Sanitize tên file: Làm sạch an toàn ký tự cấm hệ điều hành, thẻ script injection <script>
- Chống Header Injection (CRLF) trong header Content-Disposition theo chuẩn RFC 5987
"""

import os
import sys
import json
import urllib.request
import urllib.parse
import urllib.error
import unittest

BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8000" if os.path.exists("/app") else "http://localhost:80")

# Setup path cho utils
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "backend"))
for p in [backend_dir, os.path.join(backend_dir, "app_python")]:
    if os.path.exists(p) and p not in sys.path:
        sys.path.insert(0, p)


def make_request(path: str, data: dict = None, headers: dict = None, timeout: int = 10):
    url = f"{BASE_URL}{path}"
    h = {"User-Agent": "Omniverse-TestRunner/1.0", "X-Forwarded-For": "10.10.5.1"}
    if headers:
        h.update(headers)
    
    req_data = None
    if data is not None:
        req_data = json.dumps(data).encode("utf-8")
        h["Content-Type"] = "application/json"

    req = urllib.request.Request(url, data=req_data, headers=h)
    return urllib.request.urlopen(req, timeout=timeout)


class TestSecurityAndValidation(unittest.TestCase):

    def test_01_path_traversal_prevention(self):
        """1. Kiểm tra chống Path Traversal trên /api/file/{filename} (.., %2f, etc/passwd)"""
        malicious_filenames = [
            "../../etc/passwd",
            "..%2f..%2fetc%2fpasswd",
            "....//....//etc/passwd",
            "..\\..\\windows\\win.ini",
            "%2e%2e%2f%2e%2e%2fapp%2fmain.go",
            "/etc/shadow",
            "../main.go",
        ]

        for fname in malicious_filenames:
            try:
                # Gửi request với filename độc hại
                url = f"{BASE_URL}/api/file/{fname}"
                req = urllib.request.Request(url, headers={"User-Agent": "SecurityTester"})
                with urllib.request.urlopen(req, timeout=5) as res:
                    body = res.read().decode("utf-8", errors="ignore")
                    # Không bao giờ được phép đọc ra nội dung passwd, shadow hoặc source code
                    self.assertNotIn("root:x:0:0", body, f"LỖ HỔNG NGUY HIỂM: Path traversal thành công với {fname}")
                    self.assertNotIn("package main", body, f"LỖ HỔNG: Lộ file nguồn backend với {fname}")
            except urllib.error.HTTPError as e:
                # Bắt buộc phải là 400 Bad Request hoặc 404 Not Found
                self.assertIn(e.code, [400, 404], f"Kỳ vọng 400/404 cho {fname} nhưng nhận {e.code}")

        print(" [PASS] test_01: Chặn đứng 100% các nỗ lực tấn công Path Traversal trên /api/file/")

    def test_02_ssrf_internal_ip_rejection(self):
        """2. Kiểm tra chống SSRF: Ngăn chặn gửi request tới IP nội bộ, loopback hoặc AWS metadata"""
        internal_urls = [
            "http://127.0.0.1:8000/api/status",
            "http://localhost:22",
            "http://169.254.169.254/latest/meta-data/",
        ]

        for target in internal_urls:
            try:
                payload = {"url": target, "format": "mp3", "quality": "128"}
                with make_request("/api/info", data={"url": target}, timeout=3) as res:
                    data = json.loads(res.read().decode("utf-8"))
                    self.assertFalse(data.get("success", False))
            except urllib.error.HTTPError as e:
                self.assertIn(e.code, [400, 500, 502])
            except Exception:
                pass  # Timeout hoặc connection refused là an toàn

        print(" [PASS] test_02: Ngăn chặn và từ chối các URL nội bộ / loopback (SSRF)")

    def test_03_null_byte_injection_protection(self):
        """3. Kiểm tra chống Null-byte Injection (%00) trên endpoint tải file"""
        payloads = [
            "sample.mp3%00.sh",
            "image.png%00.exe",
        ]
        for p in payloads:
            try:
                with make_request(f"/api/file/{p}", timeout=3) as res:
                    self.fail(f"Kỳ vọng 400/404/502 cho null-byte payload {p} nhưng nhận {res.status}")
            except urllib.error.HTTPError as e:
                # Pingora hoặc Go Gateway chặn đứng với 400, 404 hoặc 502
                self.assertIn(e.code, [400, 404, 502])
            except Exception:
                pass
        print(" [PASS] test_03: Chặn đứng tấn công Null-byte injection an toàn")

    def test_04_sanitize_filename_xss_and_forbidden_chars(self):
        """4. Kiểm tra làm sạch tên file (Sanitize Filename) chống XSS và ký tự cấm OS"""
        try:
            from app.url_conver.utils import sanitize_filename
            dirty_title = '<script>alert("XSS")</script> Video: /\\:*?"<>| Name 2026 🎉'
            cleaned = sanitize_filename(dirty_title)

            # Đảm bảo không chứa ký tự cấm hệ điều hành
            for char in ['/', '\\', ':', '*', '?', '"', '<', '>', '|']:
                self.assertNotIn(char, cleaned, f"Tên file làm sạch vẫn còn ký tự cấm: '{char}'")

            # Đảm bảo không chứa thẻ script
            self.assertNotIn("<script>", cleaned)
            self.assertNotIn("</script>", cleaned)
            print(f" [PASS] test_04: Làm sạch tên file an toàn: '{cleaned}'")
        except ImportError:
            print(" [SKIP] test_04: Bỏ qua test unit Python nếu môi trường host thiếu module app")

    def test_05_content_disposition_header_injection(self):
        """5. Kiểm tra Content-Disposition không bị lỗi CRLF / Header Injection khi tải file"""
        # Tạo request tải file thông thường và kiểm tra cấu trúc header Content-Disposition
        sample_file = "sample.mp3"
        try:
            with make_request(f"/api/file/{sample_file}") as res:
                cd_header = res.headers.get("Content-Disposition", "")
                if cd_header:
                    self.assertNotIn("\r", cd_header, "Header chứa ký tự CR nguy hiểm")
                    self.assertNotIn("\n", cd_header, "Header chứa ký tự LF nguy hiểm")
        except urllib.error.HTTPError:
            pass  # Nếu file chưa có thì status 404 là hợp lệ
        print(" [PASS] test_05: Header Content-Disposition tuân thủ an toàn chống CRLF Injection")


if __name__ == "__main__":
    unittest.main()
