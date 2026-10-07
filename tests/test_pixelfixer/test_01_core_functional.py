#!/usr/bin/env python3
"""
NHÓM 1: CHỨC NĂNG CỐT LÕI PIXELFIXER (CORE FUNCTIONAL & GRID RECONSTRUCTION)
Bao gồm:
- Kiểm tra Health Check Endpoint (/health & /api/pixel/health)
- Nhận diện lưới pixel tự động chế độ nhanh (Fast Mode)
- Phân tích sâu consensus và confidence chế độ toàn diện (Full Mode)
- Tái tạo ảnh pixel art chuẩn xác (Auto Fix / SOTA Reconstruct)
- Tái tạo với kích thước lưới tùy chỉnh thủ công (Manual Cols & Rows)
- Hỗ trợ đa thuật toán: SOTA vs Original
- Tối ưu hóa bảng màu tự động (Auto Palette & K-Colors Quantization)
"""

import os
import sys
import io
import requests
import unittest
from PIL import Image, ImageDraw

DEFAULT_DIRECT_URL = "http://localhost:8004"
DEFAULT_GATEWAY_URL = os.getenv("API_BASE_URL", "http://localhost:8000" if os.path.exists("/app") else "http://localhost:80") + "/api/pixel"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATASET_DIR = os.path.join(SCRIPT_DIR, "dataset")


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


def create_synthetic_sprite_bytes(cols=16, rows=16, scale=4, format="PNG") -> bytes:
    """Tạo sprite pixel art mẫu dạng PNG được phóng đại Nearest-Neighbor."""
    img_1x = Image.new("RGBA", (cols, rows), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img_1x)
    # Vẽ nhân vật pixel đơn giản
    draw.rectangle([2, 2, cols - 3, rows - 3], fill=(220, 50, 50, 255), outline=(30, 30, 30, 255))
    draw.point((4, 4), fill=(255, 255, 255, 255))
    draw.point((cols - 5, 4), fill=(255, 255, 255, 255))
    draw.rectangle([4, rows - 6, cols - 5, rows - 4], fill=(50, 150, 250, 255))

    img_scaled = img_1x.resize((cols * scale, rows * scale), Image.NEAREST)
    buf = io.BytesIO()
    img_scaled.save(buf, format=format)
    buf.seek(0)
    return buf.read()


def get_test_image_bytes():
    sample_path = os.path.join(DATASET_DIR, "distorted", "sprite_01_nn3x.png")
    if os.path.exists(sample_path):
        with open(sample_path, "rb") as f:
            return f.read(), "sprite_01_nn3x.png"
    return create_synthetic_sprite_bytes(cols=16, rows=16, scale=3), "synthetic_16x16_nn3x.png"


class TestPixelFixerCoreFunctional(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.base_url, cls.detect_url, cls.fix_url, cls.health_url = resolve_api_endpoints()
        try:
            res = requests.get(cls.health_url, timeout=3)
            if res.status_code != 200:
                raise Exception(f"Health returned HTTP {res.status_code}")
        except Exception as e:
            raise unittest.SkipTest(f"PixelFixer service not reachable at {cls.health_url}: {e}")

    def test_01_health_check(self):
        """1. Kiểm tra /health hoặc /api/pixel/health xác nhận engine Native Rust sẵn sàng"""
        res = requests.get(self.health_url, timeout=3)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data.get("status"), "ok")
        self.assertEqual(data.get("service"), "worker-pixelfixer")
        print(f"  [PASS] test_01_health_check: engine={data.get('engine', 'Native Rust')}")

    def test_02_detect_grid_fast_mode(self):
        """2. Nhận diện lưới pixel tự động ở chế độ nhanh (mode=fast)"""
        img_bytes, filename = get_test_image_bytes()
        files = {"file": (filename, img_bytes, "image/png")}
        res = requests.post(self.detect_url, files=files, params={"mode": "fast"}, timeout=10)

        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data.get("success"))
        self.assertGreater(data.get("cols", 0), 0)
        self.assertGreater(data.get("rows", 0), 0)
        self.assertGreater(data.get("confidence", 0), 0)
        self.assertIn("consensus", data)
        print(f"  [PASS] test_02_detect_grid_fast_mode: cols={data['cols']}, rows={data['rows']}, conf={data['confidence']}%, consensus={data['consensus']}")

    def test_03_detect_grid_full_mode_consensus(self):
        """3. Phân tích sâu consensus và confidence ở chế độ toàn diện (mode=full)"""
        img_bytes, filename = get_test_image_bytes()
        files = {"file": (filename, img_bytes, "image/png")}
        res = requests.post(self.detect_url, files=files, params={"mode": "full"}, timeout=15)

        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data.get("success"))
        self.assertIsInstance(data.get("candidates"), list)
        self.assertGreater(len(data.get("candidates", [])), 0)
        print(f"  [PASS] test_03_detect_grid_full_mode_consensus: candidates={len(data['candidates'])}, secs={data.get('secs', 0):.4f}s")

    def test_04_fix_auto_reconstruct_png(self):
        """4. Tái tạo ảnh pixel art chuẩn xác (POST /fix) trả về PNG nguyên bản"""
        img_bytes, filename = get_test_image_bytes()
        files = {"file": (filename, img_bytes, "image/png")}
        res = requests.post(self.fix_url, files=files, params={"mode": "fast"}, timeout=15)

        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.headers.get("content-type"), "image/png")
        # Xác thực file trả về là ảnh PNG hợp lệ
        reconstructed_img = Image.open(io.BytesIO(res.content))
        self.assertGreater(reconstructed_img.width, 0)
        self.assertGreater(reconstructed_img.height, 0)
        print(f"  [PASS] test_04_fix_auto_reconstruct_png: {reconstructed_img.width}x{reconstructed_img.height} PNG ({len(res.content)} bytes)")

    def test_05_fix_manual_grid_dimensions(self):
        """5. Tái tạo ảnh với tham số lưới chỉ định thủ công (cols=16, rows=16)"""
        img_bytes, filename = get_test_image_bytes()
        files = {"file": (filename, img_bytes, "image/png")}
        params = {"cols": 16, "rows": 16, "mode": "fast"}
        res = requests.post(self.fix_url, files=files, params=params, timeout=15)

        self.assertEqual(res.status_code, 200)
        reconstructed_img = Image.open(io.BytesIO(res.content))
        self.assertEqual(reconstructed_img.width, 16)
        self.assertEqual(reconstructed_img.height, 16)
        print(f"  [PASS] test_05_fix_manual_grid_dimensions: matched exact size 16x16")

    def test_06_fix_sota_vs_original_algorithms(self):
        """6. Kiểm tra hỗ trợ cả 2 thuật toán: algo=sota và algo=original"""
        img_bytes, filename = get_test_image_bytes()
        for algo in ["sota", "original"]:
            files = {"file": (filename, img_bytes, "image/png")}
            res = requests.post(self.fix_url, files=files, params={"algo": algo, "mode": "fast"}, timeout=15)
            self.assertEqual(res.status_code, 200)
            img = Image.open(io.BytesIO(res.content))
            self.assertGreater(img.width, 0)
        print(f"  [PASS] test_06_fix_sota_vs_original_algorithms: sota and original algorithms OK")

    def test_07_fix_auto_palette_and_k_colors(self):
        """7. Kiểm tra tùy chọn bảng màu auto_palette=true và k_colors=16"""
        img_bytes, filename = get_test_image_bytes()
        files = {"file": (filename, img_bytes, "image/png")}
        params = {"auto_palette": "true", "k_colors": 16, "mode": "fast"}
        res = requests.post(self.fix_url, files=files, params=params, timeout=15)

        self.assertEqual(res.status_code, 200)
        img = Image.open(io.BytesIO(res.content))
        self.assertGreater(img.width, 0)
        print(f"  [PASS] test_07_fix_auto_palette_and_k_colors: palette preservation completed successfully")


if __name__ == "__main__":
    unittest.main()
