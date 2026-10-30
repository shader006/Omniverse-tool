#!/usr/bin/env python3
"""
NHÓM 1: KIỂM THỬ CHỨC NĂNG CỐT LÕI AI IMAGE UPSCALER (REALPLKSR)
Bao gồm:
- Kiểm tra Health Check Endpoint (/api/upscale/health)
- Phóng đại ảnh siêu phân giải 2x (scale=2) và xác thực kích thước đầu ra (width*2, height*2)
- Phóng đại ảnh siêu phân giải 4x (scale=4) và xác thực kích thước đầu ra (width*4, height*4)
- Tải file ảnh kết quả qua /api/file/{filename} và kiểm tra định dạng PNG hợp lệ
"""

import os
import io
import unittest
import requests
from PIL import Image, ImageDraw

BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8000" if os.path.exists("/app") else "http://localhost:80")


def create_sample_image_bytes(width=32, height=32, fmt="PNG") -> bytes:
    img = Image.new("RGB", (width, height), (240, 240, 250))
    draw = ImageDraw.Draw(img)
    draw.rectangle([6, 6, width - 6, height - 6], fill=(40, 120, 220), outline=(20, 20, 20))
    buf = io.BytesIO()
    img.save(buf, format=fmt)
    buf.seek(0)
    return buf.read()


class TestUpscalerCoreFunctional(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        try:
            res = requests.get(f"{BASE_URL}/api/upscale/health", timeout=5)
            if res.status_code != 200:
                raise Exception(f"HTTP {res.status_code}")
        except Exception as e:
            raise unittest.SkipTest(f"Upscaler service không khả dụng tại {BASE_URL}: {e}")

    def test_01_upscale_health_check(self):
        """1. Kiểm tra /api/upscale/health trả về trạng thái hoạt động của worker-upscaler"""
        res = requests.get(f"{BASE_URL}/api/upscale/health", timeout=5)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data.get("status"), "ok")
        self.assertEqual(data.get("service"), "worker-upscaler")
        print(f"  [PASS] test_01_upscale_health_check: model={data.get('model')}")

    def test_02_upscale_2x_resolution(self):
        """2. Kiểm tra phóng đại ảnh 2x (scale=2) và xác thực độ phân giải ảnh đầu ra"""
        img_bytes = create_sample_image_bytes(24, 24, "PNG")
        files = {"file": ("avatar_24x24.png", img_bytes, "image/png")}
        data = {"scale": "2", "model": "realplksr"}

        res = requests.post(f"{BASE_URL}/api/upscale", files=files, data=data, timeout=60)
        self.assertEqual(res.status_code, 200)
        body = res.json()

        self.assertTrue(body.get("success"))
        self.assertEqual(body.get("scale"), 2)
        self.assertEqual(body.get("original_width"), 24)
        self.assertEqual(body.get("original_height"), 24)
        self.assertEqual(body.get("upscaled_width"), 48)
        self.assertEqual(body.get("upscaled_height"), 48)
        self.assertIn("download_url", body)

        dl_res = requests.get(f"{BASE_URL}{body['download_url']}", timeout=10)
        self.assertEqual(dl_res.status_code, 200)
        out_img = Image.open(io.BytesIO(dl_res.content))
        self.assertEqual(out_img.size, (48, 48))
        print(f"  [PASS] test_02_upscale_2x_resolution: 24x24 -> 48x48 ({body.get('processing_time_ms')}ms)")

    def test_03_upscale_4x_resolution(self):
        """3. Kiểm tra phóng đại ảnh 4x (scale=4) và xác thực độ phân giải ảnh đầu ra"""
        img_bytes = create_sample_image_bytes(16, 16, "JPEG")
        files = {"file": ("photo_16x16.jpg", img_bytes, "image/jpeg")}
        data = {"scale": "4", "model": "realplksr"}

        res = requests.post(f"{BASE_URL}/api/upscale", files=files, data=data, timeout=60)
        self.assertEqual(res.status_code, 200)
        body = res.json()

        self.assertTrue(body.get("success"))
        self.assertEqual(body.get("scale"), 4)
        self.assertEqual(body.get("upscaled_width"), 64)
        self.assertEqual(body.get("upscaled_height"), 64)
        self.assertTrue(body.get("filename", "").endswith(".png"))
        print(f"  [PASS] test_03_upscale_4x_resolution: 16x16 -> 64x64 ({body.get('processing_time_ms')}ms)")


if __name__ == "__main__":
    unittest.main()

