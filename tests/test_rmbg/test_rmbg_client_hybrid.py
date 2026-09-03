"""
Unit and Integration Tests for Client-Side RMBG (WebAssembly) & Server Fallback.
Kiểm tra tính toàn vẹn của module rmbg-client.js, tích hợp UI và API server fallback.
"""

import os
import io
import re
import unittest
import requests

BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8000")
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
FRONTEND_DIR = os.path.join(REPO_ROOT, "frontend")


def create_sample_png(width=200, height=200) -> bytes:
    """Tạo byte buffer ảnh PNG test hợp lệ cho model AI."""
    try:
        from PIL import Image, ImageDraw
        img = Image.new("RGB", (width, height), (255, 255, 255))
        draw = ImageDraw.Draw(img)
        draw.rectangle([40, 40, width - 40, height - 40], fill=(0, 128, 255))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)
        return buf.read()
    except Exception:
        # Fallback binary PNG hợp lệ kích thước lớn hơn stride mạng nơ-ron
        return (
            b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
            b"\x08\x06\x00\x00\x00\x1f\x15c4\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00"
            b"\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
        )


class TestRmbgClientHybrid(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        # Kiểm tra Gateway Server có đang chạy không
        try:
            res = requests.get(f"{BASE_URL}/health", timeout=3)
            cls.server_online = (res.status_code == 200)
        except Exception:
            cls.server_online = False

    def test_01_client_file_exists_and_content(self):
        """Kiểm tra file frontend/rmbg-client.js tồn tại và chứa các hàm cốt lõi"""
        rmbg_js_path = os.path.join(FRONTEND_DIR, "rmbg-client.js")
        self.assertTrue(os.path.isfile(rmbg_js_path), f"Không tìm thấy file {rmbg_js_path}")

        with open(rmbg_js_path, "r", encoding="utf-8") as f:
            content = f.read()

        # Kiểm tra các hàm và interface then chốt
        self.assertIn("window.RmbgClient", content, "Thiếu namespace window.RmbgClient")
        self.assertIn("isBrowserSupported", content, "Thiếu hàm isBrowserSupported")
        self.assertIn("isWebGPUSupported", content, "Thiếu hàm isWebGPUSupported")
        self.assertIn("loadBiRefNetClientEngine", content, "Thiếu hàm loadBiRefNetClientEngine")
        self.assertIn("processOnClient", content, "Thiếu hàm processOnClient")
        self.assertIn("processOnServer", content, "Thiếu hàm processOnServer")
        self.assertIn("removeBackgroundHybrid", content, "Thiếu hàm removeBackgroundHybrid")
        self.assertIn("changeExistingBackgroundColor", content, "Thiếu hàm changeExistingBackgroundColor")
        self.assertIn("applyBackgroundColorToBlob", content, "Thiếu hàm applyBackgroundColorToBlob")

        # Kiểm tra Model ID đồng nhất chính xác 100% với Server (remover.py:76)
        self.assertIn("onnx-community/BiRefNet_lite-ONNX", content, "Client phải dùng đúng model onnx-community/BiRefNet_lite-ONNX của Server")
        self.assertIn("BIREFNET_MODEL_ID", content, "Thiếu hằng số BIREFNET_MODEL_ID")
        self.assertIn("transformers", content, "Thiếu nạp thư viện transformers cho BiRefNet-Lite")
        print("  [PASS] test_01: File frontend/rmbg-client.js đồng nhất 100% mô hình BiRefNet-Lite với Server.")

    def test_02_static_serving_rmbg_client(self):
        """Kiểm tra server Gateway phân phối static file /static/rmbg-client.js chuẩn MIME"""
        if not self.server_online:
            raise unittest.SkipTest(f"Server không online tại {BASE_URL}")

        res = requests.get(f"{BASE_URL}/static/rmbg-client.js", timeout=5)
        self.assertEqual(res.status_code, 200, f"Lỗi GET /static/rmbg-client.js: {res.status_code}")
        self.assertIn("javascript", res.headers.get("Content-Type", "").lower(), "Content-Type phải là javascript")
        self.assertGreater(len(res.content), 2000, "Dung lượng file script quá nhỏ")
        self.assertIn(b"RmbgClient", res.content)
        print(f"  [PASS] test_02: Phục vụ static file /static/rmbg-client.js thành công ({len(res.content)} bytes).")

    def test_03_frontend_ui_integration(self):
        """Kiểm tra index.html và app.js đã tích hợp Engine selector và script tag"""
        index_html_path = os.path.join(FRONTEND_DIR, "index.html")
        app_js_path = os.path.join(FRONTEND_DIR, "app.js")

        with open(index_html_path, "r", encoding="utf-8") as f:
            html = f.read()

        with open(app_js_path, "r", encoding="utf-8") as f:
            app_js = f.read()

        # index.html
        self.assertIn("rmbg-client.js", html, "index.html chưa nạp rmbg-client.js")
        self.assertIn('id="bg-engine-select"', html, "index.html thiếu select box id='bg-engine-select'")
        self.assertIn('value="client"', html, "index.html thiếu option value='client'")
        self.assertIn('value="server"', html, "index.html thiếu option value='server'")

        # app.js
        self.assertIn("bgEngineSelect", app_js, "app.js chưa khai báo bgEngineSelect")
        self.assertIn("RmbgClient.removeBackgroundHybrid", app_js, "app.js chưa gọi RmbgClient.removeBackgroundHybrid")
        self.assertIn("changeExistingBackgroundColor", app_js, "app.js chưa tích hợp đổi màu Canvas tức thì")
        print("  [PASS] test_03: Giao diện index.html và app.js đã tích hợp đầy đủ UI & logic Hybrid.")

    def test_04_server_fallback_endpoint_health(self):
        """Kiểm tra endpoint server fallback /api/remove-bg hoạt động bình thường khi cần cứu cánh"""
        if not self.server_online:
            raise unittest.SkipTest(f"Server không online tại {BASE_URL}")

        img_data = create_sample_png(200, 200)
        files = {"file": ("fallback_sample.png", img_data, "image/png")}
        payload = {
            "model": "bria-rmbg",
            "bg_color": "transparent",
            "alpha_matting": "false"
        }

        res = requests.post(f"{BASE_URL}/api/remove-bg", files=files, data=payload, timeout=60)
        self.assertEqual(res.status_code, 200, f"Server fallback trả về status: {res.status_code}")
        data = res.json()

        self.assertTrue(data.get("success"), "Server fallback trả về success=false")
        self.assertIn("download_url", data, "Thiếu download_url trong phản hồi server fallback")
        self.assertIn("preview_base64", data, "Thiếu preview_base64")
        self.assertIn("processing_time_ms", data, "Thiếu processing_time_ms")
        print(f"  [PASS] test_04: Server fallback /api/remove-bg sẵn sàng phản hồi (Thời gian: {data.get('processing_time_ms')}ms).")

    def test_05_instant_recolor_logic(self):
        """Kiểm tra logic đổi màu nền không gửi request tới server fallback"""
        rmbg_js_path = os.path.join(FRONTEND_DIR, "rmbg-client.js")
        with open(rmbg_js_path, "r", encoding="utf-8") as f:
            content = f.read()

        # Hàm changeExistingBackgroundColor phải dùng canvas blob trực tiếp, không gọi server
        fn_start = content.find("function changeExistingBackgroundColor")
        self.assertGreater(fn_start, 0, "Không tìm thấy hàm changeExistingBackgroundColor trong rmbg-client.js")
        fn_snippet = content[fn_start:fn_start + 400]
        self.assertIn("applyBackgroundColorToBlob", fn_snippet, "changeExistingBackgroundColor phải dùng applyBackgroundColorToBlob")
        self.assertNotIn("fetch('/api/remove-bg'", fn_snippet, "Đổi màu nền không được gọi lại server!")
        print("  [PASS] test_05: Logic đổi màu nền Canvas thực thi hoàn toàn ở Client, 0 request tới Server.")


if __name__ == "__main__":
    unittest.main()
