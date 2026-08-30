"""
Integration tests for the /api/remove-bg Endpoint on Go Gateway.
"""

import os
import io
import sys
import unittest
import requests
try:
    from PIL import Image, ImageDraw
    HAS_PIL = True
except ImportError:
    HAS_PIL = False

BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8000")


def create_test_image_bytes(width=200, height=200) -> bytes:
    """Tạo byte buffer ảnh PNG test."""
    if HAS_PIL:
        img = Image.new("RGB", (width, height), (255, 255, 255))
        draw = ImageDraw.Draw(img)
        draw.rectangle([40, 40, width - 40, height - 40], fill=(0, 128, 255))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)
        return buf.read()
    else:
        return b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15c4\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"


class TestRMBGAPI(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        # Kiểm tra Server có đang chạy không
        try:
            res = requests.get(f"{BASE_URL}/health", timeout=3)
            if res.status_code != 200:
                raise Exception(f"Server trả về status {res.status_code}")
        except Exception as e:
            raise unittest.SkipTest(f"Không kết nối được server tại {BASE_URL}: {e}")

    def test_01_validation_missing_file(self):
        """Kiểm tra bắt lỗi 400 khi thiếu tham số file"""
        res = requests.post(f"{BASE_URL}/api/remove-bg", data={"model": "bria-rmbg"})
        self.assertEqual(res.status_code, 400)
        data = res.json()
        self.assertFalse(data.get("success", True))
        print("  [PASS] test_01_validation_missing_file: Bắt lỗi 400 đúng khi thiếu file")

    def test_02_validation_unsupported_file_type(self):
        """Kiểm tra bắt lỗi 400 khi upload file không phải định dạng ảnh"""
        files = {"file": ("malicious.exe", b"DummyBinaryPayload", "application/octet-stream")}
        res = requests.post(f"{BASE_URL}/api/remove-bg", files=files)
        self.assertEqual(res.status_code, 400)
        data = res.json()
        self.assertFalse(data.get("success", True))
        self.assertIn("không được hỗ trợ", data.get("detail", ""))
        print("  [PASS] test_02_validation_unsupported_file_type: Chặn file không đúng định dạng ảnh")

    def test_03_remove_bg_bria_model(self):
        """Kiểm tra gọi API /api/remove-bg với model BRIA RMBG-1.4"""
        img_bytes = create_test_image_bytes(200, 200)
        files = {"file": ("sample_avatar.png", img_bytes, "image/png")}
        data = {
            "model": "bria-rmbg",
            "bg_color": "transparent",
            "alpha_matting": "false"
        }

        res = requests.post(f"{BASE_URL}/api/remove-bg", files=files, data=data, timeout=60)
        self.assertEqual(res.status_code, 200)
        resp_data = res.json()

        self.assertTrue(resp_data.get("success", False))
        self.assertIn("download_url", resp_data)
        self.assertIn("preview_base64", resp_data)
        self.assertIn("processing_time_ms", resp_data)
        self.assertTrue(resp_data["filename"].endswith(".png"))

        # Kiểm tra tải file kết quả từ server
        dl_res = requests.get(f"{BASE_URL}{resp_data['download_url']}", timeout=10)
        self.assertEqual(dl_res.status_code, 200)
        self.assertGreater(len(dl_res.content), 0)

        print(f"  [PASS] test_03_remove_bg_bria_model: Thành công! Thời gian={resp_data['processing_time_ms']}ms, File={resp_data['filename']}")


if __name__ == "__main__":
    unittest.main()
