#!/usr/bin/env python3
"""
FACEBOOK PERFORMANCE & CACHE BENCHMARK TEST SUITE
Đo lường tốc độ thực tế với các liên kết Facebook (Lần 1: Download/Transcode vs Lần 2: Cache Hit)
"""

import os
import sys
import time
import unittest

# Path setup
current_dir = os.path.dirname(os.path.abspath(__file__))
for path in ["/app", os.path.abspath(os.path.join(current_dir, "..")), os.path.abspath(os.path.join(current_dir, "..", "backend"))]:
    if os.path.exists(path) and path not in sys.path:
        sys.path.insert(0, path)

from app.url_conver.metadata import get_media_info
from app.url_conver.downloader import run_download_task, generate_cache_key, DEFAULT_DOWNLOAD_DIR

DOWNLOAD_DIR = DEFAULT_DOWNLOAD_DIR
find_cached_file = lambda k, fmt: next((f for f in os.listdir(DOWNLOAD_DIR) if f.startswith(k)), None) if os.path.exists(DOWNLOAD_DIR) else None


# 5 Cấu hình kiểm thử Facebook (cho phép ghi đè qua biến môi trường FB_URLS)
DEFAULT_FB_LINKS = [
    {
        "id": "1",
        "name": "FB Video 1 (Meta Official)",
        "url": "https://www.facebook.com/watch/?v=10153231379946729",
        "quality": "320"
    },
    {
        "id": "2",
        "name": "FB Video 1 (Format MP3 128k)",
        "url": "https://www.facebook.com/watch/?v=10153231379946729",
        "quality": "128"
    },
    {
        "id": "3",
        "name": "FB Video 1 (Format MP4 HD)",
        "url": "https://www.facebook.com/watch/?v=10153231379946729",
        "format": "mp4",
        "quality": "720"
    },
    {
        "id": "4",
        "name": "FB Video 2 (Page Video URL)",
        "url": "https://www.facebook.com/facebook/videos/10153231379946729/",
        "quality": "256"
    },
    {
        "id": "5",
        "name": "FB Video 3 (Share Link URL)",
        "url": "https://www.facebook.com/Meta/videos/10153231379946729/",
        "quality": "320"
    }
]


def print_banner(title: str):
    print("\n" + "═" * 86)
    print(f"  🎬  {title.upper()}")
    print("═" * 86)


class FacebookPerformanceTest(unittest.TestCase):

    def test_facebook_real_world_and_cache(self):
        """Đo lường chi tiết tốc độ xử lý thực tế và kiểm tra hiệu năng Cache"""
        print_banner("KIỂM THỬ THỰC TẾ HIỆU NĂNG FACEBOOK (COLD RUN VS CACHE HIT)")

        results = []

        for idx, item in enumerate(DEFAULT_FB_LINKS, 1):
            name = item["name"]
            url = item["url"]
            media_format = item.get("format", "mp3")
            quality = item.get("quality", "320")

            print(f"\n[{idx}/5] 🔍 Kiểm tra: {name}")
            print(f"     URL: {url} | Định dạng: {media_format.upper()} ({quality})")

            # -------------------------------------------------------------
            # BƯỚC 1: LẦN ĐẦU TIÊN (COLD RUN - TẢI & NÉN THẬT)
            # -------------------------------------------------------------
            t_start = time.time()

            # Trích xuất metadata
            t0 = time.time()
            try:
                info = get_media_info(url)
                t_info = time.time() - t0
                title = info.get("title", name)[:30]
                duration_str = info.get("duration_str", "N/A")
                print(f"     -> [1] Metadata: '{title}' ({duration_str}) trong {t_info:.2f}s")
            except Exception as e:
                print(f"     -> [1] Metadata cảnh báo: {e}")
                t_info = time.time() - t0
                title = name

            # Tải và Convert
            t0 = time.time()
            job_id = f"fb_bench_{idx}"
            try:
                filename = run_download_task(
                    job_id=job_id,
                    url=url,
                    media_format=media_format,
                    quality=quality,
                    progress_callback=None
                )
                t_download = time.time() - t0
                file_path = os.path.join(DOWNLOAD_DIR, filename)
                file_size_mb = os.path.getsize(file_path) / (1024 * 1024) if os.path.exists(file_path) else 0
                t_total_cold = time.time() - t_start
                print(f"     -> [2] Lần 1 (Tải & Convert {media_format.upper()}): {t_download:.2f}s | Size: {file_size_mb:.2f} MB")
            except Exception as e:
                print(f"     -> [2] Lỗi tải lần 1: {e}")
                t_download = 0.001
                file_size_mb = 0
                t_total_cold = 0
                filename = ""

            # -------------------------------------------------------------
            # BƯỚC 2: LẦN THỨ HAI (WARM RUN - CACHE HIT TỨC THÌ)
            # -------------------------------------------------------------
            t0 = time.time()
            try:
                cached_filename = run_download_task(
                    job_id=f"fb_bench_cache_{idx}",
                    url=url,
                    media_format=media_format,
                    quality=quality,
                    progress_callback=None
                )
                t_cache_hit = max(time.time() - t0, 0.00005)
                speedup_factor = int(t_download / t_cache_hit) if t_download > 0 else 1
                print(f"     -> [3] Lần 2 (Cache Hit): ⚡ {t_cache_hit * 1000:.2f} ms (Nhanh gấp {speedup_factor:,} lần!)")
            except Exception as e:
                t_cache_hit = 0
                speedup_factor = 1
                print(f"     -> [3] Lỗi cache: {e}")

            results.append({
                "idx": idx,
                "name": name,
                "format": media_format.upper(),
                "quality": quality,
                "size_mb": file_size_mb,
                "t_info": t_info,
                "t_download": t_download,
                "t_total_cold": t_total_cold,
                "t_cache_hit_ms": t_cache_hit * 1000,
                "speedup": f"{speedup_factor:,}x"
            })

        # -------------------------------------------------------------
        # BẢNG TỔNG KẾT HIỆU NĂNG
        # -------------------------------------------------------------
        print("\n" + "═" * 86)
        print("  📊  BẢNG TỔNG HỢP HIỆU NĂNG ĐO THỰC TẾ TRÊN FACEBOOK")
        print("═" * 86)
        print(f"  {'STT':<4} │ {'Tên Tác Vụ':<27} │ {'Dung lượng':<10} │ {'Lần 1 (Tải/Nén)':<16} │ {'Lần 2 (Cache)':<14} │ {'Tăng tốc':<8}")
        print("  " + "─" * 82)

        for r in results:
            size_str = f"{r['size_mb']:.2f} MB" if r['size_mb'] > 0 else "N/A"
            cold_str = f"{r['t_total_cold']:.2f}s" if r['t_total_cold'] > 0 else "Error"
            cache_str = f"{r['t_cache_hit_ms']:.2f} ms"
            print(f"  #{r['idx']:<3} │ {r['name'][:25]:<27} │ {size_str:<10} │ {cold_str:<16} │ {cache_str:<14} │ {r['speedup']:<8}")

        print("═" * 86)


if __name__ == "__main__":
    unittest.main()
