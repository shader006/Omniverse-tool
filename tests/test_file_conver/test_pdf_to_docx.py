#!/usr/bin/env python3
"""
PDF TO DOCX CONVERSION TESTS
Kiểm tra tính năng chuyển đổi PDF sang Word (.docx) qua pikepdf + pdf2docx + python-docx.
"""

import os
import json
import uuid
import urllib.request
import unittest
import zipfile
import io

BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8000")


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
    with urllib.request.urlopen(req, timeout=60) as res:
        status = res.status
        content = res.read().decode("utf-8")
        return status, json.loads(content)


class TestPdfToDocxConversion(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        # 1. Tạo 1 file PDF mẫu từ Gotenberg để dùng làm đầu vào test
        sample_doc = (
            "CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM\n"
            "Độc lập - Tự do - Hạnh phúc\n\n"
            "HỢP ĐỒNG DỊCH VỤ CÔNG NGHỆ\n"
            "Hôm nay, ngày 10 tháng 09 năm 2026.\n"
            "Chúng tôi gồm có:\n"
            "Bên A: Khách hàng sử dụng Omniverse Tool.\n"
            "Bên B: Nền tảng Omniverse Microservices.\n\n"
            "Điều 1: Dịch vụ chuyển đổi tài liệu hai chiều:\n"
            "- Chiều 1: Văn bản Office sang PDF (Gotenberg v8 Engine).\n"
            "- Chiều 2: PDF sang Word DOCX (pikepdf + pdf2docx + python-docx).\n\n"
            "Điều 2: Cam kết chất lượng:\n"
            "Hệ thống tối ưu hóa bảng biểu, khử đứt gãy đoạn văn và chuẩn hóa font chữ.\n"
        )
        status, data = send_multipart_file(
            f"{BASE_URL}/api/convert/file",
            "file",
            "contract_source.txt",
            sample_doc.encode("utf-8")
        )
        assert status == 200, "Không tạo được file PDF mẫu từ Gotenberg"
        pdf_download_url = f"{BASE_URL}{data['download_url']}"
        with urllib.request.urlopen(pdf_download_url) as resp:
            cls.sample_pdf_bytes = resp.read()
        assert len(cls.sample_pdf_bytes) > 500, "File PDF mẫu bị rỗng"

    def test_01_convert_pdf_to_docx_success(self):
        """Kiểm tra chuyển đổi file PDF sang Word (.docx)"""
        status, data = send_multipart_file(
            f"{BASE_URL}/api/convert/file",
            "file",
            "test_sample.pdf",
            self.sample_pdf_bytes,
            extra_fields={"target_format": "docx"}
        )
        self.assertEqual(status, 200)
        self.assertTrue(data.get("success"), "Convert không thành công")
        self.assertTrue(data.get("filename", "").endswith(".docx"), "Filename phải có đuôi .docx")
        self.assertTrue(data.get("output_filename", "").endswith(".docx"), "Output filename phải có đuôi .docx")
        self.assertGreater(data.get("size", 0), 1000, "Dung lượng file docx phải > 1000 bytes")

        # Tải file docx về và kiểm tra cấu trúc ZIP/OpenXML
        docx_url = f"{BASE_URL}{data['download_url']}"
        with urllib.request.urlopen(docx_url) as res:
            docx_bytes = res.read()

        self.assertEqual(docx_bytes[:4], b"PK\x03\x04", "File Word phải là chuẩn ZIP container (PK\\x03\\x04)")
        with zipfile.ZipFile(io.BytesIO(docx_bytes)) as zf:
            namelist = zf.namelist()
            self.assertIn("word/document.xml", namelist, "File docx phải chứa word/document.xml")
            self.assertIn("[Content_Types].xml", namelist, "File docx phải chứa [Content_Types].xml")

        print(f" [PASS] test_01_convert_pdf_to_docx: Output DOCX={data.get('filename')}, Size={data.get('size_str')}")

    def test_02_default_target_format_for_pdf(self):
        """Kiểm tra khi upload file .pdf mà không chỉ định target_format, hệ thống mặc định chuyển sang .docx"""
        status, data = send_multipart_file(
            f"{BASE_URL}/api/convert/file",
            "file",
            "auto_detect.pdf",
            self.sample_pdf_bytes
        )
        self.assertEqual(status, 200)
        self.assertTrue(data.get("filename", "").endswith(".docx"), "Mặc định với PDF phải chuyển sang .docx")
        print(f" [PASS] test_02_default_target_format_for_pdf: Auto-converted to DOCX={data.get('filename')}")


if __name__ == "__main__":
    unittest.main()
