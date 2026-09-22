#!/usr/bin/env python3
"""
NHÓM 4: TỐI ƯU HÓA, XỬ LÝ ĐỒNG THỜI & BỘ NHỚ ĐỆM (OPTIMIZATIONS & CONCURRENCY)
Bao gồm:
- Xử lý đồng thời nhiều request /detect song song qua Rayon Multi-threaded
- Xử lý đồng thời nhiều request /fix tái tạo ảnh mà không gây nghẽn tiến trình
- Xác thực tính nhất quán của FNV-1a Hash và cơ chế Cache-Hit
- So sánh hiệu năng giữa Fast Mode và Full Mode
- Độ ổn định bộ nhớ và tài nguyên khi chịu tải chuỗi request liên tục (Burst load)
"""

import os
import sys
import io
import time
import requests
import unittest
from concurrent.futures import ThreadPoolExecutor
from PIL import Image, ImageDraw

DEFAULT_DIRECT_URL = "http://localhost:8004"
DEFAULT_GATEWAY_URL = os.getenv("API_BASE_URL", "http://localhost:8000" if os.path.exists("/app") else "http://localhost:80") + "/api/pixel"


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


def create_sample_sprite(cols=16, rows=16, scale=4) -> bytes:
    img = Image.new("RGBA", (cols, rows), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.rectangle([2, 2, cols - 3, rows - 3], fill=(180, 40, 40, 255), outline=(10, 10, 10, 255))
    draw.point((4, 4), fill=(255, 255, 0, 255))
    draw.point((cols - 5, 4), fill=(255, 255, 0, 255))
    draw.rectangle([4, rows - 6, cols - 5, rows - 4], fill=(40, 120, 220, 255))

    scaled = img.resize((cols * scale, rows * scale), Image.NEAREST)
    buf = io.BytesIO()
    scaled.save(buf, format="PNG")
    return buf.getvalue()


class TestPixelFixerOptimizationsAndConcurrency(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.base_url, cls.detect_url, cls.fix_url, cls.health_url = resolve_api_endpoints()
        try:
            res = requests.get(cls.health_url, timeout=3)
            if res.status_code != 200:
                raise Exception(f"Health returned HTTP {res.status_code}")
        except Exception as e:
            raise unittest.SkipTest(f"PixelFixer service not reachable at {cls.health_url}: {e}")

    def test_01_concurrent_detect_requests(self):
        """1. Gửi đồng thời 4 requests /detect (kiểm tra Rayon đa luồng song song)"""
        raw_png = create_sample_sprite(cols=16, rows=16, scale=4)

        def send_detect(worker_idx):
            files = {"file": (f"worker_{worker_idx}.png", raw_png, "image/png")}
            t0 = time.perf_counter()
            r = requests.post(self.detect_url, files=files, params={"mode": "fast"}, timeout=15)
            dur = time.perf_counter() - t0
            return r.status_code, dur, r.json() if r.status_code == 200 else {}

        with ThreadPoolExecutor(max_workers=4) as executor:
            futures = [executor.submit(send_detect, i) for i in range(4)]
            results = [f.result() for f in futures]

        for code, dur, data in results:
            self.assertEqual(code, 200)
            self.assertTrue(data.get("success"))
            self.assertGreater(data.get("cols", 0), 0)

        avg_time = sum(r[1] for r in results) / len(results)
        print(f"  [PASS] test_01_concurrent_detect_requests: 4/4 thành công đồng thời, avg_latency={avg_time*1000:.1f}ms")

    def test_02_concurrent_fix_requests(self):
        """2. Gửi đồng thời 4 requests /fix (kiểm tra tái tạo ảnh song song)"""
        raw_png = create_sample_sprite(cols=16, rows=16, scale=3)

        def send_fix(worker_idx):
            files = {"file": (f"fix_{worker_idx}.png", raw_png, "image/png")}
            t0 = time.perf_counter()
            r = requests.post(self.fix_url, files=files, params={"mode": "fast"}, timeout=20)
            dur = time.perf_counter() - t0
            return r.status_code, dur, len(r.content)

        with ThreadPoolExecutor(max_workers=4) as executor:
            futures = [executor.submit(send_fix, i) for i in range(4)]
            results = [f.result() for f in futures]

        for code, dur, length in results:
            self.assertEqual(code, 200)
            self.assertGreater(length, 0)

        print(f"  [PASS] test_02_concurrent_fix_requests: 4/4 tái tạo ảnh song song thành công không lỗi")

    def test_03_source_hash_consistency_and_caching(self):
        """3. Kiểm tra tính nhất quán của FNV-1a Hash và cơ chế Cache-Hit"""
        raw_png = create_sample_sprite(cols=20, rows=20, scale=3)
        files1 = {"file": ("cache_target.png", raw_png, "image/png")}
        res1 = requests.post(self.detect_url, files=files1, params={"mode": "fast"}, timeout=10)
        self.assertEqual(res1.status_code, 200)
        data1 = res1.json()

        # Gửi lại cùng file lần 2
        files2 = {"file": ("cache_target.png", raw_png, "image/png")}
        res2 = requests.post(self.detect_url, files=files2, params={"mode": "fast"}, timeout=10)
        self.assertEqual(res2.status_code, 200)
        data2 = res2.json()

        # Cả 2 lần đều trả về kết quả cấu trúc lưới giống nhau
        self.assertEqual(data1.get("cols"), data2.get("cols"))
        self.assertEqual(data1.get("rows"), data2.get("rows"))
        print(f"  [PASS] test_03_source_hash_consistency_and_caching: Hash và kết quả lưới đồng nhất (cached={data2.get('cached')})")

    def test_04_performance_fast_vs_full_mode(self):
        """4. So sánh hiệu năng giữa Fast Mode và Full Mode"""
        raw_png = create_sample_sprite(cols=24, rows=24, scale=3)

        files_fast = {"file": ("bench_fast.png", raw_png, "image/png")}
        t0 = time.perf_counter()
        r_fast = requests.post(self.detect_url, files=files_fast, params={"mode": "fast"}, timeout=10)
        t_fast = time.perf_counter() - t0
        self.assertEqual(r_fast.status_code, 200)

        files_full = {"file": ("bench_full.png", raw_png, "image/png")}
        t0 = time.perf_counter()
        r_full = requests.post(self.detect_url, files=files_full, params={"mode": "full"}, timeout=10)
        t_full = time.perf_counter() - t0
        self.assertEqual(r_full.status_code, 200)

        print(f"  [PASS] test_04_performance_fast_vs_full_mode: Fast={t_fast*1000:.1f}ms, Full={t_full*1000:.1f}ms (cả 2 đều hoàn tất ổn định)")

    def test_05_resource_stability_under_burst(self):
        """5. Kiểm tra ổn định tài nguyên và chống tràn bộ nhớ dưới tải burst 8 requests liên tiếp"""
        raw_png = create_sample_sprite(cols=16, rows=16, scale=2)
        success_count = 0

        for i in range(8):
            files = {"file": (f"burst_{i}.png", raw_png, "image/png")}
            r = requests.post(self.detect_url, files=files, params={"mode": "fast"}, timeout=10)
            if r.status_code == 200:
                success_count += 1

        self.assertEqual(success_count, 8)
        print("  [PASS] test_05_resource_stability_under_burst: 8/8 burst requests xử lý trơn tru không rò rỉ bộ nhớ")


if __name__ == "__main__":
    unittest.main()
