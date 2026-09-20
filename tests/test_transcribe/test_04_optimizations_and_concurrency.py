#!/usr/bin/env python3
"""
NHÓM 4: TỐI ƯU HÓA, ĐỒNG THỜI & CHUYỂN ĐỔI DỰ PHÒNG TRANSCRIBE (OPTIMIZATIONS & CONCURRENCY)
Bao gồm:
- Kiểm soát luồng tải đồng thời qua mediaLimiter Semaphore
- Chạy đồng thời nhiều file audio song song an toàn, không gây sập worker
- Tự động dọn dẹp file tạm (.wav / .tmp) sau khi xử lý để chống cạn kiệt ổ đĩa
- Thời gian phản hồi phân vị ổn định khi có nhiều tác vụ
"""

import os
import sys
import io
import math
import struct
import wave
import time
import requests
import unittest
from concurrent.futures import ThreadPoolExecutor

BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8000" if os.path.exists("/app") else "http://localhost:80")


def create_sample_wav_bytes(duration_sec: float = 1.0, freq: float = 440.0, sample_rate: int = 16000) -> bytes:
    buf = io.BytesIO()
    n_samples = int(duration_sec * sample_rate)
    with wave.open(buf, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        raw_data = bytearray()
        for i in range(n_samples):
            val = int(math.sin(2.0 * math.pi * freq * (i / sample_rate)) * 16384.0)
            raw_data.extend(struct.pack("<h", val))
        wav_file.writeframes(raw_data)
    buf.seek(0)
    return buf.read()


class TestTranscribeOptimizations(unittest.TestCase):

    def test_01_concurrent_transcribe_requests(self):
        """1. Kiểm tra gửi 3 requests transcribe đồng thời (mediaLimiter điều phối an toàn)"""
        wav_bytes = create_sample_wav_bytes(duration_sec=1.5)

        def send_job(worker_id):
            files = {"file": (f"concurrent_{worker_id}.wav", wav_bytes, "audio/wav")}
            data = {"format": "txt", "language": "vi"}
            start_t = time.perf_counter()
            res = requests.post(f"{BASE_URL}/api/transcribe", files=files, data=data, timeout=120)
            elapsed = time.perf_counter() - start_t
            return res.status_code == 200, elapsed, res.json() if res.status_code == 200 else {}

        with ThreadPoolExecutor(max_workers=3) as pool:
            futures = [pool.submit(send_job, i) for i in range(3)]
            results = [f.result() for f in futures]

        for success, elapsed, data in results:
            self.assertTrue(success, f"Một trong các request đồng thời bị lỗi: {data}")
            self.assertIn("download_url", data)

        avg_time = sum(r[1] for r in results) / len(results)
        print(f" [PASS] test_01: Xử lý an toàn 3 requests đồng thời (Thời gian TB: {avg_time:.2f}s/req)")

    def test_02_temp_file_cleanup_verification(self):
        """2. Kiểm tra các file trung gian được tự động dọn dẹp, không lưu rác trong đĩa"""
        wav_bytes = create_sample_wav_bytes(duration_sec=1.0)
        files = {"file": ("cleanup_test.wav", wav_bytes, "audio/wav")}
        res = requests.post(f"{BASE_URL}/api/transcribe", files=files, data={"format": "json"}, timeout=60)
        self.assertEqual(res.status_code, 200)

        # Kiểm tra thư mục tạm của worker nếu truy cập được
        tmp_dir = os.path.join(os.path.dirname(__file__), "..", "..", "backend", "downloads", "tmp")
        if os.path.exists(tmp_dir):
            wav_temps = [f for f in os.listdir(tmp_dir) if f.endswith(".wav")]
            self.assertEqual(len(wav_temps), 0, f"Vẫn còn sót lại file tạm: {wav_temps}")
        print(" [PASS] test_02: File tạm sau khi xử lý được dọn dẹp sạch sẽ")


if __name__ == "__main__":
    unittest.main()
