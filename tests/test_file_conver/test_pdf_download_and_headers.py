#!/usr/bin/env python3
"""
PDF DOWNLOAD & HEADERS VERIFICATION TESTS
Kiểm tra tính toàn vẹn của file PDF được tải về qua endpoint /api/file/{filename}.
"""

import os
import json
import uuid
import urllib.request
import unittest

BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8000" if os.path.exists("/app") else "http://localhost:80")


def create_test_pdf():
    boundary = f"----WebKitFormBoundary{uuid.uuid4().hex}"
    body = bytearray()
    body.extend(f"--{boundary}\r\n".encode("utf-8"))
    body.extend(b'Content-Disposition: form-data; name="file"; filename="download_test.txt"\r\n')
    body.extend(b"Content-Type: application/octet-stream\r\n\r\n")
    body.extend(b"Kiem tra header file download va magic bytes PDF.")
    body.extend(b"\r\n")
    body.extend(f"--{boundary}--\r\n".encode("utf-8"))

    req = urllib.request.Request(
        f"{BASE_URL}/api/convert/file",
        data=bytes(body),
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"}
    )
    with urllib.request.urlopen(req, timeout=30) as res:
        data = json.loads(res.read().decode("utf-8"))
        return data.get("filename")


class TestPDFDownloadAndHeaders(unittest.TestCase):

    def test_01_download_pdf_magic_bytes_and_headers(self):
        """Kiểm tra tải file PDF, header Content-Disposition và Magic Bytes (%PDF-)"""
        filename = create_test_pdf()
        self.assertIsNotNone(filename)

        download_url = f"{BASE_URL}/api/file/{filename}"
        req = urllib.request.Request(download_url)
        with urllib.request.urlopen(req, timeout=10) as res:
            self.assertEqual(res.status, 200)
            headers = dict(res.headers)
            
            # Kiểm tra Content-Disposition
            content_disp = headers.get("Content-Disposition", "")
            self.assertIn("attachment", content_disp)
            self.assertIn("filename=", content_disp)

            # Đọc nội dung file
            pdf_bytes = res.read()
            self.assertGreater(len(pdf_bytes), 1000)

            # Kiểm tra PDF Magic Header Bytes (%PDF-)
            self.assertTrue(pdf_bytes.startswith(b"%PDF-"), "Dữ liệu trả về không phải định dạng file PDF hợp lệ!")
            print(f" [PASS] test_01_download_pdf: Header Content-Disposition='{content_disp}', File size={len(pdf_bytes)} bytes, Magic bytes=%PDF- OK")


if __name__ == "__main__":
    unittest.main()
