"""
Unit tests for the RMBG Python Core Engine (remover.py & cli.py).
"""

import io
import os
import sys
import unittest
import json
import subprocess

# Add backend directory to sys.path
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "backend"))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.rmbg.remover import (
    remove_background,
    hex_to_rgb,
    get_optimal_cpu_threads,
    Image,
)

try:
    from PIL import ImageDraw
    HAS_PIL = True
except ImportError:
    HAS_PIL = False


def create_sample_image(width=400, height=400, bg_color=(255, 255, 255), fg_color=(255, 0, 0)) -> bytes:
    """Tạo ảnh test mẫu gồm hình tròn màu ở giữa trên nền phẳng"""
    if HAS_PIL:
        img = Image.new("RGB", (width, height), bg_color)
        draw = ImageDraw.Draw(img)
        margin = 50
        draw.ellipse([margin, margin, width - margin, height - margin], fill=fg_color)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)
        return buf.read()
    else:
        return b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15c4\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"


class TestRMBGRemover(unittest.TestCase):

    def test_01_optimal_threads(self):
        """Kiểm tra hàm tính toán luồng CPU tối ưu"""
        threads = get_optimal_cpu_threads()
        self.assertIsInstance(threads, int)
        self.assertGreaterEqual(threads, 1)
        print(f"  [PASS] test_01_optimal_threads: Detected optimal threads = {threads}")

    def test_02_hex_to_rgb(self):
        """Kiểm tra hàm chuyển đổi mã màu Hex sang RGB"""
        self.assertEqual(hex_to_rgb("#ffffff"), (255, 255, 255))
        self.assertEqual(hex_to_rgb("#000000"), (0, 0, 0))
        self.assertEqual(hex_to_rgb("#ff0000"), (255, 0, 0))
        self.assertEqual(hex_to_rgb("00ff00"), (0, 255, 0))
        self.assertEqual(hex_to_rgb("#fff"), (255, 255, 255))
        print("  [PASS] test_02_hex_to_rgb: Chuyển đổi mã màu hex chính xác")

    def test_03_remove_background_transparent(self):
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
        print(f"  [PASS] test_03_remove_background_transparent: Tách nền thành công (Total Time: {metadata['timing_ms']['total']}ms)")

    def test_04_remove_background_solid_color(self):
        """Kiểm tra thay thế nền bằng màu tùy chọn (#000000)"""
        img_bytes = create_sample_image(width=150, height=150)
        out_img, metadata = remove_background(
            image_input=img_bytes,
            model_name="u2net",
            bg_color="#000000",
        )

        self.assertEqual(out_img.mode, "RGBA")
        self.assertEqual(metadata["bg_color"], "#000000")
        print("  [PASS] test_04_remove_background_solid_color: Gán màu nền mới thành công")

    def test_05_cli_execution(self):
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

        # Dọn dẹp file tạm
        if os.path.exists(temp_input):
            os.remove(temp_input)
        if os.path.exists(temp_output):
            os.remove(temp_output)

        print("  [PASS] test_05_cli_execution: CLI chạy thành công và trả về JSON hợp lệ")


if __name__ == "__main__":
    unittest.main()
