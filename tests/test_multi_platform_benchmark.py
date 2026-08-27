#!/usr/bin/env python3
"""
MULTI-PLATFORM & MULTI-FORMAT BENCHMARK TEST SUITE
Kiểm thử đa nền tảng và đa định dạng (YouTube, Facebook, CDN streams, v.v.)
Đo lường thời gian trích xuất metadata, tải & convert MP3 320k, MP4 1080p, và hiệu năng Cache Hit.
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
from app.url_conver.downloader import run_download_task, DEFAULT_DOWNLOAD_DIR

DOWNLOAD_DIR = DEFAULT_DOWNLOAD_DIR


TEST_PLATFORMS = [
    {
        "platform": "YouTube (Short)",
        "name": "Me at the zoo (18s)",
        "url": "https://www.youtube.com/watch?v=jNQXAC9IVRw",
        "format": "mp3",
        "quality": "320"
    },
    {
        "platform": "Facebook (Video Watch)",
        "name": "Meta AI Feature Demo",
        "url": "https://www.facebook.com/watch/?v=10153231379946729",
        "format": "mp3",
        "quality": "320"
    },
    {
        "platform": "YouTube (Full Music Video)",
        "name": "Rick Astley - Never Gonna Give You Up",
        "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "format": "mp3",
        "quality": "320"
    },
    {
        "platform": "YouTube (Sparks Coldplay)",
        "name": "Coldplay 1 Hour Ambient Track",
        "url": "https://www.youtube.com/watch?v=MK5fPnK4ae4",
        "format": "mp3",
        "quality": "320"
    },
    {
        "platform": "Facebook (Video MP4 HD)",
        "name": "Meta Connect Event (MP4 HD)",
        "url": "https://www.facebook.com/watch/?v=10153231379946729",
        "format": "mp4",
        "quality": "720"
    }
]


def print_banner(title: str):
    print("\n" + "═" * 88)
    print(f"  🌐  {title.upper()}")
    print("═" * 88)


class MultiPlatformBenchmarkTest(unittest.TestCase):

    def test_multi_platform_download_and_cache(self):
        """Đo lường chi tiết tốc độ xử lý trên 5 kịch bản / nền tảng khác nhau"""
        print_banner("KIỂM THỬ ĐA NỀN TẢNG & ĐỊNH DẠNG (YOUTUBE, FACEBOOK, MP3 320K, MP4 HD)")

        results = []

        for idx, item in enumerate(TEST_PLATFORMS, 1):
            platform = item["platform"]
            name = item["name"]
            url = item["url"]
            media_format = item["format"]
            quality = item["quality"]

            print(f"\n[{idx}/5] 🔍 Nền tảng: {platform} - '{name}'")
            print(f"     URL: {url} | Định dạng: {media_format.upper()} ({quality})")

            # 1. Trích xuất Metadata
            t_start = time.time()
            t0 = time.time()
            try:
                info = get_media_info(url)
                t_info = time.time() - t0
                title = info.get("title", name)[:30]
                duration_str = info.get("duration_str", "N/A")
                print(f"     -> [1] Metadata: '{title}' ({duration_str}) trong {t_info:.2f}s")
            except Exception as e:
                print(f"     -> [1] Metadata lỗi: {e}")
                t_info = time.time() - t0
                title = name

            # 2. Tải & Convert Lần 1 (Cold Run)
            t0 = time.time()
            job_id = f"multi_{idx}"
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
                print(f"     -> [2] Lần 1 (Tải & Nén {media_format.upper()}): {t_download:.2f}s | Dung lượng: {file_size_mb:.2f} MB")
            except Exception as e:
                print(f"     -> [2] Lỗi tải: {e}")
                t_download = 0.001
                file_size_mb = 0
                t_total_cold = 0

            # 3. Lần 2 (Cache Hit)
            t0 = time.time()
            try:
                cached_filename = run_download_task(
                    job_id=f"multi_cache_{idx}",
                    url=url,
                    media_format=media_format,
                    quality=quality,
                    progress_callback=None
                )
                t_cache_hit = max(time.time() - t0, 0.00005)
                speedup_factor = int(max(t_download, 0.001) / t_cache_hit)
                print(f"     -> [3] Lần 2 (Cache Hit): ⚡ {t_cache_hit * 1000:.2f} ms (Nhanh gấp {speedup_factor:,} lần!)")
            except Exception as e:
                t_cache_hit = 0
                speedup_factor = 1
                print(f"     -> [3] Lỗi cache: {e}")

            results.append({
                "idx": idx,
                "platform": platform,
                "name": name,
                "size_mb": file_size_mb,
                "t_total_cold": t_total_cold,
                "t_cache_hit_ms": t_cache_hit * 1000,
                "speedup": f"{speedup_factor:,}x"
            })

        # -------------------------------------------------------------
        # BẢNG TỔNG KẾT ĐA NỀN TẢNG
        # -------------------------------------------------------------
        print("\n" + "═" * 88)
        print("  📊  BẢNG TỔNG HỢP HIỆU NĂNG THỰC TẾ ĐA NỀN TẢNG & ĐỊNH DẠNG")
        print("═" * 88)
        print(f"  {'STT':<4} │ {'Nền tảng & Kịch bản':<26} │ {'Dung lượng':<10} │ {'Lần 1 (Tải/Nén)':<16} │ {'Lần 2 (Cache)':<14} │ {'Tăng tốc':<8}")
        print("  " + "─" * 84)

        for r in results:
            size_str = f"{r['size_mb']:.2f} MB" if r['size_mb'] > 0 else "N/A"
            cold_str = f"{r['t_total_cold']:.2f}s" if r['t_total_cold'] > 0 else "Error"
            cache_str = f"{r['t_cache_hit_ms']:.2f} ms"
            print(f"  #{r['idx']:<3} │ {r['platform'][:25]:<26} │ {size_str:<10} │ {cold_str:<16} │ {cache_str:<14} │ {r['speedup']:<8}")

        print("═" * 88)


if __name__ == "__main__":
    unittest.main()
