#!/usr/bin/env python3
"""
WEB & MARKDOWN TO PDF CONVERSION TESTS (GOTENBERG)
Kiểm tra khả năng chuyển đổi HTML (Chromium engine) và Markdown (.md) sang PDF.
"""

import os
import json
import uuid
import urllib.request
import unittest

BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8000" if os.path.exists("/app") else "http://localhost:80")


def send_multipart_file(url, field_name, file_name, file_bytes, extra_fields=None):
    boundary = f"----WebKitFormBoundary{uuid.uuid4().hex}"
    body = bytearray()

    if extra_fields:
        for k, v in extra_fields.items():
            body.extend(f"--{boundary}\r\n".encode("utf-8"))
            body.extend(f'Content-Disposition: form-data; name="{k}"\r\n\r\n'.encode("utf-8"))
            body.extend(f"{v}\r\n".encode("utf-8"))

    body.extend(f"--{boundary}\r\n".encode("utf-8"))
    body.extend(f'Content-Disposition: form-data; name="{field_name}"; filename="{file_name}"\r\n'.encode("utf-8"))
    body.extend(b"Content-Type: application/octet-stream\r\n\r\n")
    body.extend(file_bytes)
    body.extend(b"\r\n")
    body.extend(f"--{boundary}--\r\n".encode("utf-8"))

    req = urllib.request.Request(
        url,
        data=bytes(body),
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"}
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            status = res.status
            content = res.read().decode("utf-8")
            return status, json.loads(content)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode("utf-8"))


class TestWebMarkdownConversion(unittest.TestCase):

    def test_01_html_rejected_for_security(self):
        """Kiểm tra hệ thống chặn file HTML (.html) vì lý do an toàn bảo mật SSRF/LFI"""
        sample_html = """<!DOCTYPE html>
<html><body><h1>Blocked HTML</h1></body></html>"""
        status, data = send_multipart_file(
            f"{BASE_URL}/api/convert/file",
            "file",
            "report.html",
            sample_html.encode("utf-8")
        )
        self.assertEqual(status, 400)
        self.assertFalse(data.get("success"))
        self.assertIn("không được hỗ trợ", data.get("detail", ""))
        print(f" [PASS] test_01_html_rejected_for_security: Chặn thành công file HTML: {data.get('detail')}")

    def test_02_markdown_rejected(self):
        """Kiểm tra file Markdown (.md) bị từ chối vì hệ thống chỉ cho phép tài liệu văn phòng"""
        sample_md = """# MediaFlow Architecture
## Core Components
- **Golang Native API Gateway**
"""
        status, data = send_multipart_file(
            f"{BASE_URL}/api/convert/file",
            "file",
            "README.md",
            sample_md.encode("utf-8")
        )
        self.assertEqual(status, 400)
        self.assertFalse(data.get("success"))
        print(f" [PASS] test_02_markdown_rejected: Chặn thành công file .md: {data.get('detail')}")


if __name__ == "__main__":
    unittest.main()
