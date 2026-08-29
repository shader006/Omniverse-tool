#!/usr/bin/env python3
"""
MEDIAFLOW PERFORMANCE & BENCHMARK SUITE
Đo lường chi tiết tốc độ xử lý từng giai đoạn (Latency, Throughput, Transcoding speed) trên Golang API & url_conver Engine
"""

import os
import sys
import time
import json
import shutil
import tempfile
import urllib.request
import unittest
from concurrent.futures import ThreadPoolExecutor

# Path setup
current_dir = os.path.dirname(os.path.abspath(__file__))
for path in ["/app", os.path.abspath(os.path.join(current_dir, "..")), os.path.abspath(os.path.join(current_dir, "..", "backend"))]:
    if os.path.exists(path) and path not in sys.path:
        sys.path.insert(0, path)

from app.url_conver.utils import sanitize_filename
from app.url_conver.metadata import get_media_info
from app.url_conver.downloader import run_download_task, DEFAULT_DOWNLOAD_DIR

BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8000" if os.path.exists("/app") else "http://localhost:80")


def print_banner(title: str):
    print("\n" + "═" * 70)
    print(f"  🚀  {title.upper()}")
    print("═" * 70)


def print_row(stage: str, duration_sec: float, extra_info: str = ""):
    ms = duration_sec * 1000
    bars = "█" * min(int(ms / 50), 30)
    print(f"  {stage:<32} │ {duration_sec:>6.3f}s ({ms:>7.1f} ms) │ {bars:<15} │ {extra_info}")


class PerformanceBenchmark(unittest.TestCase):

    def test_01_api_latency_and_throughput(self):
        """1. Đo độ trễ (Latency) & Khả năng chịu tải (Throughput) của Golang API Server"""
        print_banner("1. API LATENCY & CONCURRENCY BENCHMARK (GOLANG NATIVE SERVER)")

        total_requests = 100
        concurrency = 10

        def fetch_root():
            req = urllib.request.Request(f"{BASE_URL}/")
            with urllib.request.urlopen(req, timeout=5) as res:
                return res.status

        start_time = time.time()
        with ThreadPoolExecutor(max_workers=concurrency) as pool:
            futures = [pool.submit(fetch_root) for _ in range(total_requests)]
            results = [f.result() for f in futures]

        elapsed = time.time() - start_time
        rps = total_requests / elapsed
        avg_latency = (elapsed / total_requests) * 1000
        print_row("API GET / (Golang Web UI)", elapsed, f"{rps:5.1f} req/s, avg {avg_latency:.2f}ms")
        self.assertEqual(len(results), total_requests)

        # Benchmark POST /api/download (Job Creation & Cache Lookup)
        def create_download_req():
            payload = json.dumps({"url": "https://www.youtube.com/watch?v=jNQXAC9IVRw", "format": "mp3", "quality": "320"}).encode("utf-8")
            req = urllib.request.Request(f"{BASE_URL}/api/download", data=payload, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=5) as res:
                return res.status

        start_time = time.time()
        with ThreadPoolExecutor(max_workers=concurrency) as pool:
            futures = [pool.submit(create_download_req) for _ in range(total_requests)]
            results = [f.result() for f in futures]

        elapsed = time.time() - start_time
        rps = total_requests / elapsed
        avg_latency = (elapsed / total_requests) * 1000
        print_row("API POST /api/download (Go Cache)", elapsed, f"{rps:5.1f} req/s, avg {avg_latency:.2f}ms")
        self.assertEqual(len(results), total_requests)

    def test_02_ffmpeg_transcode_speed_mock(self):
        """2. Đo tốc độ FFmpeg mã hóa âm thanh sang MP3 (320k vs 128k)"""
        print_banner("2. FFMPEG AUDIO TRANSCODING SPEED TEST")

        import subprocess
        tmp_dir = tempfile.mkdtemp()
        raw_wav = os.path.join(tmp_dir, "test_tone_60s.wav")

        # Tạo file 60s âm thanh
        subprocess.run([
            "ffmpeg", "-y", "-f", "lavfi", "-i", "sine=frequency=1000:duration=60",
            "-ar", "44100", "-ac", "2", raw_wav
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)

        for bitrate in ["128k", "192k", "256k", "320k"]:
            out_mp3 = os.path.join(tmp_dir, f"out_{bitrate}.mp3")
            start = time.time()
            subprocess.run([
                "ffmpeg", "-y", "-i", raw_wav,
                "-b:a", bitrate, "-threads", "0", out_mp3
            ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
            duration = time.time() - start
            speed_ratio = 60.0 / duration
            size_kb = os.path.getsize(out_mp3) // 1024
            print_row(f"FFmpeg MP3 encode ({bitrate[:3]}k)", duration, f"{speed_ratio:5.1f}x Realtime | Size: {size_kb} KB")
            self.assertLess(duration, 3.0)

        shutil.rmtree(tmp_dir)

    def test_03_real_link_full_pipeline_breakdown(self):
        """3. LIVE LINK PIPELINE TEST: Đo đạc chi tiết từng mili-giây trên link YouTube thực tế"""
        print_banner("3. REAL PIPELINE SPEED BREAKDOWN (LINK TEST)")

        url = "https://www.youtube.com/watch?v=MK5fPnK4ae4&list=RDuCJIIQ5GYcs&index=3"
        print(f"  Target URL: {url}\n")

        # Bước 1: Trích xuất metadata
        t0 = time.time()
        info = get_media_info(url)
        t_meta = time.time() - t0
        self.assertIsNotNone(info)
        print_row("1. Trích xuất Metadata", t_meta, f"Title: {info['title'][:25]}... ({info['duration']})")

        # Bước 2: Tải và nén MP3 320k
        t1 = time.time()
        filename = run_download_task(
            url=url,
            media_format="mp3",
            quality="320",
        )
        t_dl = time.time() - t1
        self.assertIsNotNone(filename)

        file_size_mb = os.path.getsize(os.path.join(DEFAULT_DOWNLOAD_DIR, filename)) / (1024 * 1024)
        print_row("2. Tải Stream & FFmpeg MP3 320k", t_dl, f"File: {file_size_mb:.2f} MB")

        total_time = t_meta + t_dl
        print("  " + "─" * 66)
        print_row("🎯 TỔNG THỜI GIAN (E2E TOTAL)", total_time, "Hoàn tất 100%")
        print("═" * 70)


if __name__ == "__main__":
    unittest.main()
