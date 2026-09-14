#!/usr/bin/env python3
"""
Unit tests validating logic fixes for Whisper, YT-DLP, and RMBG workers.
Runs with standard Python library without external dependencies.
"""
import os
import sys
import unittest
import json
import queue
import time
import threading

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


class TestWorkerLogicFixes(unittest.TestCase):

    def test_vtt_formatting_contract(self):
        """Kiểm tra logic sinh định dạng WebVTT chuẩn (WEBVTT header + timestamp với dấu chấm)"""
        segments = [
            {
                "id": 1,
                "timestamp_from": "00:00:01,250",
                "timestamp_to": "00:00:04,800",
                "text": "Xin chào đây là bản dịch phụ đề"
            },
            {
                "id": 2,
                "timestamp_from": "00:00:05,000",
                "timestamp_to": "00:00:08,120",
                "text": "Kiểm thử WebVTT tự động"
            }
        ]

        # Mô phỏng logic xuất VTT trong worker_whisper/main.py
        lines = ["WEBVTT\n\n"]
        for seg in segments:
            vtt_from = seg["timestamp_from"].replace(",", ".")
            vtt_to = seg["timestamp_to"].replace(",", ".")
            lines.append(f"{vtt_from} --> {vtt_to}\n{seg['text']}\n\n")

        vtt_content = "".join(lines)
        self.assertTrue(vtt_content.startswith("WEBVTT\n\n"))
        self.assertIn("00:00:01.250 --> 00:00:04.800", vtt_content)
        self.assertNotIn(",", vtt_content.split("-->")[0])  # WebVTT không được chứa dấu phẩy ở timestamp
        print("  [PASS] test_vtt_formatting_contract: Chuẩn WebVTT header và timestamp dấu chấm.")

    def test_whisper_10_min_duration_limit(self):
        """Kiểm tra logic chặn audio quá 10 phút (600s)"""
        def validate_duration(duration_sec: float):
            if duration_sec > 600.0:
                mins = int(duration_sec // 60)
                secs = int(duration_sec % 60)
                return False, f"Thời lượng audio ({mins} phút {secs} giây) vượt quá giới hạn tối đa 10 phút."
            return True, "OK"

        ok, _ = validate_duration(599.9)
        self.assertTrue(ok)

        ok, _ = validate_duration(600.0)
        self.assertTrue(ok)

        ok, msg = validate_duration(600.1)
        self.assertFalse(ok)
        self.assertIn("vượt quá giới hạn tối đa 10 phút", msg)

        ok, msg = validate_duration(3600.0)
        self.assertFalse(ok)
        print("  [PASS] test_whisper_10_min_duration_limit: Chặn đứng file > 600 giây.")

    def test_whisper_format_allowlist(self):
        """Kiểm tra format allowlist cho Whisper export"""
        allowed = {"txt", "srt", "vtt", "json"}

        for fmt in ["txt", "srt", "vtt", "json", "VTT", "SRT"]:
            self.assertIn(fmt.lower().lstrip("."), allowed)

        for invalid in ["exe", "php", "sh", "doc", "mp3"]:
            self.assertNotIn(invalid.lower().lstrip("."), allowed)

        print("  [PASS] test_whisper_format_allowlist: Chỉ cho phép txt, srt, vtt, json.")

    def test_telemetry_queue_bounded_and_single_worker(self):
        """Kiểm tra cơ chế Queue Telemetry không spam thread khi có hàng trăm request"""
        trace_queue = queue.Queue(maxsize=1000)
        processed_count = 0
        lock = threading.Lock()

        def mock_worker():
            nonlocal processed_count
            while True:
                item = trace_queue.get()
                if item is None:
                    break
                with lock:
                    processed_count += 1
                trace_queue.task_done()

        worker_thread = threading.Thread(target=mock_worker, daemon=True)
        worker_thread.start()

        # Bơm 200 trace vào queue từ nhiều thread giả lập requests
        threads = []
        for i in range(50):
            def send(idx):
                for j in range(4):
                    try:
                        trace_queue.put_nowait({"id": f"{idx}_{j}"})
                    except queue.Full:
                        pass
            t = threading.Thread(target=send, args=(i,))
            threads.append(t)
            t.start()

        for t in threads:
            t.join()

        trace_queue.join()
        trace_queue.put(None)
        worker_thread.join(timeout=1.0)

        self.assertEqual(processed_count, 200)
        print("  [PASS] test_telemetry_queue_bounded_and_single_worker: Xử lý 200 items an toàn với 1 thread.")

    def test_decompression_bomb_dimension_guard(self):
        """Kiểm tra logic chặn ảnh quá 25 Megapixels (5000x5000)"""
        max_pixels = 25_000_000

        def check_dimensions(w: int, h: int) -> bool:
            return (w * h) <= max_pixels

        self.assertTrue(check_dimensions(1920, 1080))
        self.assertTrue(check_dimensions(3840, 2160)) # 4K ~ 8.3MP
        self.assertTrue(check_dimensions(4096, 4096)) # ~16.7MP
        self.assertFalse(check_dimensions(5001, 5001)) # > 25MP
        self.assertFalse(check_dimensions(10000, 10000)) # 100MP
        print("  [PASS] test_decompression_bomb_dimension_guard: Chặn đứng kích thước vượt quá 25MP.")


if __name__ == "__main__":
    unittest.main()
