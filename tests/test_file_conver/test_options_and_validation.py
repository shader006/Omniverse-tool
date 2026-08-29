#!/usr/bin/env python3
"""
CONVERSION OPTIONS & VALIDATION TESTS
Kiểm tra các tùy chọn chuyển đổi (khổ ngang landscape, chuẩn PDF/A) và các trường hợp lỗi (validation).
"""

import os
import json
import uuid
import urllib.request
import urllib.error
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

    if field_name and file_name:
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
            return res.status, json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode("utf-8"))


class TestConversionOptionsAndValidation(unittest.TestCase):

    def test_01_landscape_option(self):
        """Kiểm tra tùy chọn khổ ngang (landscape=true)"""
        sample_text = "Tài liệu in khổ ngang Landscape kiểm thử."
        status, data = send_multipart_file(
            f"{BASE_URL}/api/convert/file",
            "file",
            "landscape_doc.txt",
            sample_text.encode("utf-8"),
            extra_fields={"landscape": "true"}
        )
        self.assertEqual(status, 200)
        self.assertTrue(data.get("success"))
        print(" [PASS] test_01_landscape_option: Tạo file PDF khổ ngang thành công")

    def test_02_pdfa_archive_standard(self):
        """Kiểm tra tùy chọn xuất chuẩn PDF/A-1b lưu trữ"""
        sample_text = "Tài liệu lưu trữ chuẩn quốc tế PDF/A-1b ISO 19005-1."
        status, data = send_multipart_file(
            f"{BASE_URL}/api/convert/file",
            "file",
            "archive_doc.txt",
            sample_text.encode("utf-8"),
            extra_fields={"pdfa": "PDF/A-1b"}
        )
        self.assertEqual(status, 200)
        self.assertTrue(data.get("success"))
        print(" [PASS] test_02_pdfa_archive_standard: Xuất PDF/A-1b thành công")

    def test_03_validation_missing_file(self):
        """Kiểm tra bắt lỗi khi không gửi file upload (Missing file)"""
        status, data = send_multipart_file(
            f"{BASE_URL}/api/convert/file",
            None,
            None,
            b"",
            extra_fields={"dummy": "value"}
        )
        self.assertEqual(status, 400)
        self.assertFalse(data.get("success"))
        print(f" [PASS] test_03_validation_missing_file: Bắt lỗi 400 đúng: {data.get('detail')}")


if __name__ == "__main__":
    unittest.main()
