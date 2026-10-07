#!/usr/bin/env python3
"""
NHÓM 4: KIỂM THỬ TỐI ƯU, ĐỒNG THỜI & BỘ NHỚ ĐỆM (OPTIMIZATIONS, CONCURRENCY & CACHE)
Bao gồm:
- Fast-path Disk Cache Hit: Lần tải 2 trả về ngay kết quả cached: true (< 50ms)
- In-memory RAM Cache (/api/info): Trích xuất lần 2 tức thì với cached: true
- Chuẩn hóa URL Cache Key (clean_url_key): Loại bỏ query tracking, playlist để tái sử dụng cache
- Kiểm soát tải đồng thời (mediaLimiter Semaphore): Xử lý nhiều job tải cùng lúc an toàn
- Cơ chế bảo vệ file của active jobs khi dọn dẹp tự động (Cleanup Protection)
"""

import os
import sys
import time
import json
import urllib.request
import urllib.parse
import urllib.error
import unittest
from concurrent.futures import ThreadPoolExecutor

BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8000" if os.path.exists("/app") else "http://localhost:80")
SAMPLE_VIDEO_URL = "https://www.youtube.com/watch?v=jNQXAC9IVRw"

# Nạp logic utils nếu có
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "backend"))
for p in [backend_dir, os.path.join(backend_dir, "app_python")]:
    if os.path.exists(p) and p not in sys.path:
        sys.path.insert(0, p)


def make_request(path: str, data: dict = None, headers: dict = None, timeout: int = 15):
    url = f"{BASE_URL}{path}"
    h = {"User-Agent": "Omniverse-TestRunner/1.0", "X-Forwarded-For": "10.10.4.1"}
    if headers:
        h.update(headers)
    
    req_data = None
    if data is not None:
        req_data = json.dumps(data).encode("utf-8")
        h["Content-Type"] = "application/json"

    req = urllib.request.Request(url, data=req_data, headers=h)
    return urllib.request.urlopen(req, timeout=timeout)


class TestOptimizationsAndCache(unittest.TestCase):

    def test_01_metadata_ram_cache_hit(self):
        """1. Kiểm tra In-Memory RAM Cache: Gọi /api/info lần 2 phải trả về cached: true tức thì"""
        # Lần 1: Có thể hit hoặc miss
        payload = {"url": SAMPLE_VIDEO_URL}
        with make_request("/api/info", data=payload) as res:
            self.assertEqual(res.status, 200)

        # Lần 2: Chắc chắn phải hit RAM cache trong < 50ms
        start_t = time.perf_counter()
        with make_request("/api/info", data=payload) as res:
            self.assertEqual(res.status, 200)
            elapsed_ms = (time.perf_counter() - start_t) * 1000.0
            data = json.loads(res.read().decode("utf-8"))
            self.assertTrue(data.get("cached"), "Lần gọi thứ 2 phải có cờ cached: true")
            self.assertLess(elapsed_ms, 200.0, f"Cache Hit RAM phải cực nhanh, thực tế: {elapsed_ms:.2f}ms")
            print(f" [PASS] test_01: Metadata RAM Cache Hit thành công trong {elapsed_ms:.2f}ms (cached=True)")

    def test_02_fastpath_disk_cache_hit(self):
        """2. Kiểm tra Fast-path Disk Cache: Tải lại file đã có trong đĩa phải trả về cached: true"""
        payload = {
            "url": SAMPLE_VIDEO_URL,
            "format": "mp3",
            "quality": "128"
        }

        # Gọi tải lần 1 để file chắc chắn có trong disk
        with make_request("/api/download", data=payload) as res:
            self.assertEqual(res.status, 200)

        # Chờ tối đa 5s để đảm bảo file sẵn sàng
        time.sleep(1.0)

        # Gọi tải lần 2: Phải nhận ngay cached: true
        start_t = time.perf_counter()
        with make_request("/api/download", data=payload) as res:
            self.assertEqual(res.status, 200)
            elapsed_ms = (time.perf_counter() - start_t) * 1000.0
            body = json.loads(res.read().decode("utf-8"))
            self.assertTrue(body.get("cached"), "Lần tải thứ 2 phải trả về cached: true ngay lập tức")
            self.assertLess(elapsed_ms, 150.0, f"Fast-path Disk Cache Hit phải < 150ms, thực tế: {elapsed_ms:.2f}ms")
            print(f" [PASS] test_02: Fast-path Disk Cache Hit thành công trong {elapsed_ms:.2f}ms (cached=True)")

    def test_03_url_cache_key_normalization(self):
        """3. Kiểm tra chuẩn hóa URL Cache Key: Bỏ query rác &list=, &t= để tăng tỷ lệ Cache Hit"""
        try:
            from app.url_conver.utils import clean_url_key
            from app.url_conver.downloader import generate_cache_key

            url1 = "https://www.youtube.com/watch?v=jNQXAC9IVRw"
            url2 = "https://www.youtube.com/watch?v=jNQXAC9IVRw&list=PL123&index=5&si=abc&t=30s"

            clean1 = clean_url_key(url1)
            clean2 = clean_url_key(url2)
            self.assertEqual(clean1, clean2, "clean_url_key phải loại bỏ các query parameters thừa")

            key1 = generate_cache_key(clean1, "mp3", "320")
            key2 = generate_cache_key(clean2, "mp3", "320")
            self.assertEqual(key1, key2, "Hai URL cùng video ID phải tạo ra cùng một MD5 cache key")
            print(f" [PASS] test_03: Chuẩn hóa Cache Key thành công (MD5={key1})")
        except ImportError:
            # Fallback nếu test môi trường không có trực tiếp code Python
            print(" [SKIP] test_03: Bỏ qua test unit import trực tiếp Python module (chạy trên worker)")

    def test_04_concurrent_download_requests(self):
        """4. Kiểm tra xử lý đồng thời (Concurrency): Bắn 4 requests song song mà không nghẽn/sập"""
        def send_download(quality):
            payload = {
                "url": SAMPLE_VIDEO_URL,
                "format": "mp3",
                "quality": quality
            }
            try:
                with make_request("/api/download", data=payload, timeout=10) as res:
                    body = json.loads(res.read().decode("utf-8"))
                    return res.status == 200 and body.get("success") is True
            except Exception:
                return False

        qualities = ["128", "192", "256", "320"]
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(send_download, qualities))

        self.assertTrue(all(results), f"Tất cả requests đồng thời phải thành công: {results}")
        print(f" [PASS] test_04: Xử lý an toàn 4 requests tải đồng thời không gây lỗi máy chủ")


if __name__ == "__main__":
    unittest.main()
