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
    with urllib.request.urlopen(req, timeout=30) as res:
        status = res.status
        content = res.read().decode("utf-8")
        return status, json.loads(content)


class TestWebMarkdownConversion(unittest.TestCase):

    def test_01_convert_html_to_pdf_chromium(self):
        """Kiểm tra chuyển đổi HTML sang PDF qua Gotenberg Chromium Engine"""
        sample_html = """<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body { font-family: sans-serif; padding: 40px; background: #fafafa; }
        h1 { color: #2563eb; }
        .box { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    </style>
</head>
<body>
    <div class="box">
        <h1>Báo Cáo Tự Động MediaFlow</h1>
        <p>Tài liệu HTML được render chuẩn xác bằng Chromium Engine bên trong Gotenberg.</p>
    </div>
</body>
</html>"""
        status, data = send_multipart_file(
            f"{BASE_URL}/api/convert/file",
            "file",
            "report.html",
            sample_html.encode("utf-8")
        )
        self.assertEqual(status, 200)
        self.assertTrue(data.get("success"))
        self.assertTrue(data.get("filename", "").endswith(".pdf"))
        self.assertGreater(data.get("size", 0), 1000)
        print(f" [PASS] test_01_convert_html_chromium: Output PDF={data.get('filename')}, Size={data.get('size_str')}")

    def test_02_convert_markdown_to_pdf(self):
        """Kiểm tra chuyển đổi Markdown (.md) sang PDF"""
        sample_md = """# MediaFlow Architecture

## Core Components
- **Golang Native API Gateway**: High concurrency, low latency.
- **Gotenberg v8 Microservice**: Document-to-PDF engine.
- **Pingora Reverse Proxy**: Cloudflare Rust engine for L4/L7 routing.

> Converted successfully via Gotenberg!
"""
        status, data = send_multipart_file(
            f"{BASE_URL}/api/convert/file",
            "file",
            "README.md",
            sample_md.encode("utf-8")
        )
        self.assertEqual(status, 200)
        self.assertTrue(data.get("success"))
        self.assertTrue(data.get("filename", "").endswith(".pdf"))
        self.assertGreater(data.get("size", 0), 1000)
        print(f" [PASS] test_02_convert_markdown: Output PDF={data.get('filename')}, Size={data.get('size_str')}")


if __name__ == "__main__":
    unittest.main()
