"""
Unit tests for the RMBG Python Core Engine (remover.py & cli.py).
"""

import io
import os
import sys
import unittest
import json
import subprocess
import threading

# Add backend directory to sys.path
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "backend"))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.rmbg.remover import (
    remove_background,
    hex_to_rgb,
    get_optimal_cpu_threads,
    get_rembg_session,
    maybe_trim_memory,
    _fallback_remove_bg,
)
from PIL import Image, ImageDraw


def create_sample_image(width=400, height=400, bg_color=(255, 255, 255), fg_color=(255, 0, 0)) -> bytes:
    """Tạo ảnh test mẫu gồm hình tròn màu ở giữa trên nền phẳng"""
    img = Image.new("RGB", (width, height), bg_color)
    draw = ImageDraw.Draw(img)
    margin = 50
    draw.ellipse([margin, margin, width - margin, height - margin], fill=fg_color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return buf.read()


class TestRMBGRemover(unittest.TestCase):

    def test_01_optimal_threads(self):
        """Kiểm tra hàm tính toán luồng CPU tối ưu"""
        threads = get_optimal_cpu_threads()
        self.assertIsInstance(threads, int)
        self.assertGreaterEqual(threads, 1)

    def test_02_hex_to_rgb(self):
        """Kiểm tra hàm chuyển đổi mã màu Hex sang RGB (bao gồm cả fallback an toàn)"""
        self.assertEqual(hex_to_rgb("#ffffff"), (255, 255, 255))
        self.assertEqual(hex_to_rgb("#000000"), (0, 0, 0))
        self.assertEqual(hex_to_rgb("#ff0000"), (255, 0, 0))
        self.assertEqual(hex_to_rgb("00ff00"), (0, 255, 0))
        self.assertEqual(hex_to_rgb("#fff"), (255, 255, 255))
        # Bắt lỗi invalid hex mà không crash:
        self.assertEqual(hex_to_rgb("#gggggg"), (255, 255, 255))
        self.assertEqual(hex_to_rgb("invalid_color"), (255, 255, 255))
        self.assertEqual(hex_to_rgb(None), (255, 255, 255))

    def test_03_thread_safe_session_cache(self):
        """Kiểm tra cơ chế Thread-Safe Lock khi nhiều luồng cùng gọi get_rembg_session"""
        sessions = []
        errors = []

        def worker():
            try:
                s = get_rembg_session("bria-rmbg")
                sessions.append(s)
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=worker) for _ in range(5)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        self.assertEqual(len(errors), 0, f"Gặp lỗi khi tạo session đồng thời: {errors}")
        self.assertEqual(len(sessions), 5)
        # Tất cả các luồng phải nhận cùng một đối tượng session từ cache
        first = sessions[0]
        for s in sessions:
            self.assertIs(s, first)

    def test_04_remove_background_transparent(self):
        """Kiểm tra tách nền xuất ra ảnh PNG có kênh Alpha trong suốt"""
        img_bytes = create_sample_image(width=200, height=200)
        out_img, metadata = remove_background(
            image_input=img_bytes,
            model_name="bria-rmbg",
            bg_color=None,
        )

        self.assertIsInstance(out_img, Image.Image)
        self.assertEqual(out_img.mode, "RGBA")
        self.assertEqual(out_img.size, (200, 200))
        self.assertIn("timing_ms", metadata)
        self.assertIn("total", metadata["timing_ms"])
        self.assertIn("inference", metadata["timing_ms"])

    def test_05_remove_background_solid_color(self):
        """Kiểm tra thay thế nền bằng màu tùy chọn (#000000)"""
        img_bytes = create_sample_image(width=150, height=150)
        out_img, metadata = remove_background(
            image_input=img_bytes,
            model_name="bria-rmbg",
            bg_color="#000000",
        )

        self.assertEqual(out_img.mode, "RGBA")
        self.assertEqual(metadata["bg_color"], "#000000")

    def test_06_large_image_downscaling(self):
        """Kiểm tra ảnh siêu lớn (>4096px) tự động được thu nhỏ an toàn chống OOM"""
        huge_img = Image.new("RGB", (5000, 3000), (255, 255, 255))
        out_img, meta = remove_background(huge_img)
        self.assertLessEqual(out_img.width, 4096)
        self.assertLessEqual(out_img.height, 4096)

    def test_07_fast_fallback_algorithm(self):
        """Kiểm tra thuật toán fallback vector hóa bằng numpy/pillow"""
        img = Image.new("RGB", (100, 100), (255, 255, 255))
        draw = ImageDraw.Draw(img)
        draw.rectangle([20, 20, 80, 80], fill=(255, 0, 0))
        res = _fallback_remove_bg(img)
        self.assertEqual(res.mode, "RGBA")
        # Điểm góc (0,0) phải có alpha = 0 (trong suốt)
        self.assertEqual(res.getpixel((0, 0))[3], 0)
        # Điểm giữa (50,50) phải có alpha = 255 (giữ lại)
        self.assertEqual(res.getpixel((50, 50))[3], 255)

    def test_08_cli_execution(self):
        """Kiểm tra chạy module CLI app.rmbg.cli process qua dòng lệnh"""
        temp_input = "/tmp/test_rmbg_cli_in.png"
        temp_output = "/tmp/test_rmbg_cli_out.png"

        img_bytes = create_sample_image(width=100, height=100)
        with open(temp_input, "wb") as f:
            f.write(img_bytes)

        cmd = [
            sys.executable, "-m", "app.rmbg.cli", "process",
            "--input", temp_input,
            "--output", temp_output,
            "--model", "bria-rmbg",
        ]

        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, cwd=backend_dir)
        self.assertEqual(res.returncode, 0, f"CLI error: {res.stderr}")

        data = json.loads(res.stdout)
        self.assertTrue(data.get("success", False))
        self.assertTrue(os.path.exists(temp_output))

        if os.path.exists(temp_input):
            os.remove(temp_input)
        if os.path.exists(temp_output):
            os.remove(temp_output)


if __name__ == "__main__":
    unittest.main()
