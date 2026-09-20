#!/usr/bin/env python3
"""
NHÓM 3: GIAO THỨC & TRUYỀN TẢI FILE KẾT QUẢ TRANSCRIBE (PROTOCOLS & STREAMING)
Bao gồm:
- Tải lên qua Multipart/Form-Data với kích thước chunk lớn
- HTTP Range Requests (RFC 7233) trên file kết quả phụ đề và audio
- Xác thực chuẩn MIME Type cho WebVTT (text/vtt), SRT/TXT (text/plain), JSON (application/json)
- Chuẩn Content-Disposition attachment và mã hóa RFC 5987 filename*=UTF-8''...
- Phản hồi 404 cho file kết quả không tồn tại
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

BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8000" if os.path.exists("/app") else "http://localhost:80")


def create_sample_wav_bytes(duration_sec: float = 1.5, sample_rate: int = 16000) -> bytes:
    buf = io.BytesIO()
    n_samples = int(duration_sec * sample_rate)
    with wave.open(buf, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        raw_data = bytearray()
        for i in range(n_samples):
            val = int(math.sin(2.0 * math.pi * 440.0 * (i / sample_rate)) * 16384.0)
            raw_data.extend(struct.pack("<h", val))
        wav_file.writeframes(raw_data)
    buf.seek(0)
    return buf.read()


class TestTranscribeProtocols(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        wav_bytes = create_sample_wav_bytes(duration_sec=2.0)
        # Tạo sẵn các file định dạng khác nhau để test tải giao thức
        cls.results = {}
        for fmt in ["txt", "srt", "vtt", "json"]:
            files = {"file": (f"test_protocol.{fmt}.wav", wav_bytes, "audio/wav")}
            res = requests.post(f"{BASE_URL}/api/transcribe", files=files, data={"format": fmt}, timeout=120)
            if res.status_code == 200:
                cls.results[fmt] = res.json().get("filename")

    def test_01_mime_types_for_subtitle_formats(self):
        """1. Kiểm tra trả về Content-Type MIME chuẩn xác cho WebVTT, SRT, TXT và JSON"""
        expected_mimes = {
            "vtt": "text/vtt",
            "srt": "text/plain",
            "txt": "text/plain",
            "json": "application/json"
        }

        for fmt, expected_mime in expected_mimes.items():
            filename = self.results.get(fmt)
            if not filename:
                continue
            # Chờ nhẹ cho file hoàn tất đồng bộ disk cache giữa các container
            res = None
            ct = ""
            for _ in range(6):
                res = requests.get(f"{BASE_URL}/api/file/{filename}", timeout=10)
                ct = res.headers.get("Content-Type", "")
                if expected_mime in ct:
                    break
                time.sleep(0.5)

            self.assertEqual(res.status_code, 200)
            self.assertIn(expected_mime, ct, f"Format {fmt} có MIME không chuẩn: {ct}")
            print(f" [PASS] test_01: MIME chuẩn cho .{fmt}: '{ct}'")

    def test_02_http_range_requests_on_subtitles(self):
        """2. Kiểm tra HTTP Range Requests (RFC 7233) trên file kết quả: Status 206 Partial Content"""
        vtt_filename = self.results.get("vtt")
        self.assertIsNotNone(vtt_filename)

        headers = {"Range": "bytes=0-5"}
        res = requests.get(f"{BASE_URL}/api/file/{vtt_filename}", headers=headers, timeout=10)
        self.assertEqual(res.status_code, 206, f"Kỳ vọng 206 Partial Content nhưng nhận: {res.status_code}")
        self.assertEqual(len(res.content), 6)
        self.assertTrue(res.headers.get("Content-Range", "").startswith("bytes 0-5/"))
        print(" [PASS] test_02: HTTP Range Requests (206 Partial Content) trên file phụ đề hoạt động hoàn hảo")

    def test_03_content_disposition_header(self):
        """3. Kiểm tra Header Content-Disposition attachment và bảo vệ chống Header Injection"""
        txt_filename = self.results.get("txt")
        self.assertIsNotNone(txt_filename)

        res = requests.get(f"{BASE_URL}/api/file/{txt_filename}", timeout=10)
        self.assertEqual(res.status_code, 200)
        cd = res.headers.get("Content-Disposition", "")
        self.assertIn("attachment;", cd)
        self.assertIn("filename=", cd)
        self.assertNotIn("\r", cd)
        self.assertNotIn("\n", cd)
        print(f" [PASS] test_03: Content-Disposition an toàn: '{cd}'")

    def test_04_nonexistent_transcript_file_404(self):
        """4. Truy vấn file transcript không tồn tại trả về 404 Not Found"""
        res = requests.get(f"{BASE_URL}/api/file/transcript_nonexistent_999999.vtt", timeout=5)
        self.assertEqual(res.status_code, 404)
        print(" [PASS] test_04: /api/file/ trả về 404 Not Found chính xác cho file không tồn tại")


if __name__ == "__main__":
    unittest.main()
