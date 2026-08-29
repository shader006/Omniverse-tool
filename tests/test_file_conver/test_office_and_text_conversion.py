#!/usr/bin/env python3
"""
OFFICE & TEXT TO PDF CONVERSION TESTS (GOTENBERG)
Kiểm tra khả năng chuyển đổi các định dạng Text (.txt, .rtf, .csv) và Office sang PDF.
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


class TestOfficeAndTextConversion(unittest.TestCase):

    def test_01_convert_plain_text_to_pdf(self):
        """Kiểm tra chuyển đổi file Text (.txt) sang PDF"""
        sample_text = "Hệ thống chuyển đổi file MediaFlow\nNgày kiểm thử: 2026-08-29\nNội dung: Văn bản mẫu Unicode Tiếng Việt."
        status, data = send_multipart_file(
            f"{BASE_URL}/api/convert/file",
            "file",
            "test_doc.txt",
            sample_text.encode("utf-8")
        )
        self.assertEqual(status, 200)
        self.assertTrue(data.get("success"))
        self.assertTrue(data.get("filename", "").endswith(".pdf"))
        self.assertGreater(data.get("size", 0), 1000)
        print(f" [PASS] test_01_convert_plain_text: Output PDF={data.get('filename')}, Size={data.get('size_str')}")

    def test_02_convert_csv_to_pdf(self):
        """Kiểm tra chuyển đổi bảng tính CSV (.csv) sang PDF qua LibreOffice Engine"""
        sample_csv = "STT,Tên Dịch Vụ,Trạng Thái,Ghi Chú\n1,Omniverse Core,Running,Golang\n2,Gotenberg v8,Running,PDF Engine\n3,Pingora Proxy,Running,Rust High-Perf"
        status, data = send_multipart_file(
            f"{BASE_URL}/api/convert/file",
            "file",
            "bang_luong.csv",
            sample_csv.encode("utf-8")
        )
        self.assertEqual(status, 200)
        self.assertTrue(data.get("success"))
        self.assertTrue(data.get("filename", "").endswith(".pdf"))
        self.assertGreater(data.get("size", 0), 1000)
        print(f" [PASS] test_02_convert_csv: Output PDF={data.get('filename')}, Size={data.get('size_str')}")

    def test_03_convert_rtf_to_pdf(self):
        """Kiểm tra chuyển đổi văn bản RTF (.rtf) sang PDF"""
        sample_rtf = r"{\rtf1\ansi\deff0 {\fonttbl {\f0 Courier;}}\f0\fs24 Hello RTF Document to PDF!}"
        status, data = send_multipart_file(
            f"{BASE_URL}/api/convert/file",
            "file",
            "document.rtf",
            sample_rtf.encode("utf-8")
        )
        self.assertEqual(status, 200)
        self.assertTrue(data.get("success"))
        self.assertTrue(data.get("filename", "").endswith(".pdf"))
        self.assertGreater(data.get("size", 0), 1000)
        print(f" [PASS] test_03_convert_rtf: Output PDF={data.get('filename')}, Size={data.get('size_str')}")


if __name__ == "__main__":
    unittest.main()
