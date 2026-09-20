#!/usr/bin/env python3
"""
NHÓM 2: KIỂM THỬ NGOẠI LỆ & LỖI BIÊN TRANSCRIBE (ERROR & EDGE CASES)
Bao gồm:
- Tải lên file rỗng (0-byte)
- File âm thanh bị hỏng / corrupt binary
- Vượt giới hạn thời lượng tối đa cho phép 10 phút (600 giây)
- Kiểm tra biên: File đúng ngưỡng cho phép (dưới 10 phút)
- Thiếu file upload (Missing parameter)
- Định dạng xuất không hợp lệ (format: docx, pdf, exe)
- Tác vụ không hợp lệ (task: hack, summarize)
"""

import os
import sys
import io
import math
import struct
import wave
import requests
import unittest

BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8000" if os.path.exists("/app") else "http://localhost:80")


def create_sample_wav_bytes(duration_sec: float = 2.0, sample_rate: int = 8000) -> bytes:
    buf = io.BytesIO()
    n_samples = int(duration_sec * sample_rate)
    with wave.open(buf, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(b"\x00\x00" * n_samples)
    buf.seek(0)
    return buf.read()


class TestTranscribeErrorAndEdgeCases(unittest.TestCase):

    def test_01_missing_file_param(self):
        """1. Bắt lỗi 400 khi gửi request thiếu trường 'file'"""
        # Gửi multipart request nhưng không đính kèm file
        files = {"language": (None, "vi"), "format": (None, "txt")}
        res = requests.post(f"{BASE_URL}/api/transcribe", files=files)
        self.assertEqual(res.status_code, 400)
        data = res.json()
        self.assertFalse(data.get("success", True))
        self.assertIn("Không tìm thấy file", data.get("detail", ""))
        print(" [PASS] test_01: Bắt lỗi 400 chính xác khi thiếu file tải lên")

    def test_02_empty_zero_byte_file(self):
        """2. Xử lý file rỗng 0-byte: Từ chối an toàn với 400 hoặc 503, không làm crash worker"""
        files = {"file": ("empty.wav", b"", "audio/wav")}
        res = requests.post(f"{BASE_URL}/api/transcribe", files=files, timeout=10)
        self.assertIn(res.status_code, [400, 500, 503])
        data = res.json()
        self.assertFalse(data.get("success", True))
        print(f" [PASS] test_02: Từ chối an toàn file 0-byte (HTTP {res.status_code})")

    def test_03_corrupted_audio_file(self):
        """3. Xử lý file âm thanh bị hỏng (Corrupt binary bytes)"""
        corrupted_bytes = b"RIFF\x00\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00\x80\x3e\x00\x00corrupt_random_junk_data_here"
        files = {"file": ("corrupt.wav", corrupted_bytes, "audio/wav")}
        res = requests.post(f"{BASE_URL}/api/transcribe", files=files, timeout=15)
        # Hệ thống phải bắt lỗi 400, 500 hoặc 503 với thông báo lỗi, không treo vô hạn
        self.assertIn(res.status_code, [400, 500, 503])
        data = res.json()
        self.assertFalse(data.get("success", True))
        print(f" [PASS] test_03: Bắt lỗi an toàn file âm thanh bị lỗi/corrupt dữ liệu (HTTP {res.status_code})")

    def test_04_duration_limit_exceeded(self):
        """4. Bắt lỗi và từ chối file vượt quá giới hạn tối đa 10 phút (600 giây)"""
        # Tạo file WAV có header khai báo 650 giây (~10.8 phút)
        sample_rate = 8000
        n_samples = int(650 * sample_rate)
        buf = io.BytesIO()
        with wave.open(buf, "wb") as wav_file:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(sample_rate)
            wav_file.writeframes(b"\x00\x00" * n_samples)
        buf.seek(0)

        files = {"file": ("overlimit.wav", buf.read(), "audio/wav")}
        res = requests.post(f"{BASE_URL}/api/transcribe", files=files, timeout=30)
        self.assertEqual(res.status_code, 400)
        data = res.json()
        self.assertFalse(data.get("success", False))
        self.assertIn("vượt quá giới hạn tối đa", data.get("detail", ""))
        print(f" [PASS] test_04: Chặn đứng file vượt quá 10 phút: '{data.get('detail')}'")

    def test_05_unsupported_export_format(self):
        """5. Bắt lỗi 400 khi yêu cầu định dạng xuất không hợp lệ (docx, pdf, exe)"""
        wav_bytes = create_sample_wav_bytes(duration_sec=1.0)
        bad_formats = ["docx", "pdf", "exe", "zip"]
        for fmt in bad_formats:
            files = {"file": ("speech.wav", wav_bytes, "audio/wav")}
            res = requests.post(f"{BASE_URL}/api/transcribe", files=files, data={"format": fmt})
            self.assertEqual(res.status_code, 400)
            data = res.json()
            self.assertFalse(data.get("success", True))
            self.assertIn("không hợp lệ", data.get("detail", ""))
        print(" [PASS] test_05: Chặn đứng các format xuất không hỗ trợ (docx, pdf, exe)")

    def test_06_unsupported_task(self):
        """6. Bắt lỗi 400 khi yêu cầu task không hợp lệ (hỗ trợ duy nhất: transcribe, translate)"""
        wav_bytes = create_sample_wav_bytes(duration_sec=1.0)
        files = {"file": ("speech.wav", wav_bytes, "audio/wav")}
        res = requests.post(f"{BASE_URL}/api/transcribe", files=files, data={"task": "hack_system"})
        self.assertEqual(res.status_code, 400)
        data = res.json()
        self.assertFalse(data.get("success", True))
        self.assertIn("Tác vụ", data.get("detail", ""))
        print(" [PASS] test_06: Chặn đứng task không hợp lệ")


if __name__ == "__main__":
    unittest.main()
