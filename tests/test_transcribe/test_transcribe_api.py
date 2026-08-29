"""
Integration tests for /api/transcribe Endpoint on live Pingora/Go Gateway.
"""

import os
import sys
import io
import math
import struct
import wave
import tempfile
import requests
import unittest

BASE_URL = os.getenv("API_BASE_URL", "http://localhost:80")


def create_sample_wav_bytes(duration_sec: float = 2.0, freq: float = 440.0, sample_rate: int = 16000) -> bytes:
    """Tạo buffer WAV in-memory."""
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


class TestTranscribeAPI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Kiểm tra Gateway có sẵn sàng không
        try:
            res = requests.get(f"{BASE_URL}/health", timeout=5)
            if res.status_code != 200:
                raise Exception("Server is not healthy")
        except Exception as e:
            raise unittest.SkipTest(f"Không kết nối được Gateway tại {BASE_URL}: {e}")

    def test_01_validation_missing_file(self):
        """Kiểm tra bắt lỗi 400 khi không gửi file upload"""
        res = requests.post(f"{BASE_URL}/api/transcribe", data={"language": "vi"})
        self.assertEqual(res.status_code, 400)
        data = res.json()
        self.assertFalse(data.get("success", True))
        print("  [PASS] test_01_validation_missing_file: Bắt lỗi 400 đúng khi thiếu file")

    def test_02_validation_unsupported_file_type(self):
        """Kiểm tra bắt lỗi 400 khi tải lên file không phải audio/video (ví dụ .pdf hay .exe)"""
        files = {"file": ("malicious.exe", b"MZDummyBinaryData", "application/octet-stream")}
        res = requests.post(f"{BASE_URL}/api/transcribe", files=files)
        self.assertEqual(res.status_code, 400)
        data = res.json()
        self.assertFalse(data.get("success", True))
        self.assertIn("không được hỗ trợ", data.get("detail", ""))
        print("  [PASS] test_02_validation_unsupported_file_type: Chặn file không đúng định dạng media")

    def test_03_transcribe_audio_and_download_txt(self):
        """Kiểm tra nhận diện giọng nói từ file âm thanh WAV và tải về file .txt"""
        wav_bytes = create_sample_wav_bytes(duration_sec=2.0)
        files = {"file": ("test_speech.wav", wav_bytes, "audio/wav")}
        data_params = {
            "language": "vi",
            "format": "txt",
            "task": "transcribe"
        }

        res = requests.post(f"{BASE_URL}/api/transcribe", files=files, data=data_params, timeout=60)
        self.assertEqual(res.status_code, 200)
        data = res.json()

        self.assertTrue(data.get("success", False))
        self.assertIn("download_url", data)
        self.assertIn("filename", data)
        self.assertTrue(data["filename"].endswith(".txt"))

        # Tải file từ download_url
        download_url = f"{BASE_URL}{data['download_url']}"
        dl_res = requests.get(download_url, timeout=10)
        self.assertEqual(dl_res.status_code, 200)
        self.assertIn("attachment;", dl_res.headers.get("Content-Disposition", ""))

        print(f"  [PASS] test_03_transcribe_audio_and_download_txt: File={data['filename']}, Duration={data.get('audio_duration')}s")

    def test_04_transcribe_export_srt_subtitles(self):
        """Kiểm tra trích xuất phụ đề video chuẩn SubRip (.srt)"""
        wav_bytes = create_sample_wav_bytes(duration_sec=2.5)
        files = {"file": ("sample_clip.mp4", wav_bytes, "video/mp4")}
        data_params = {
            "language": "en",
            "format": "srt"
        }

        res = requests.post(f"{BASE_URL}/api/transcribe", files=files, data=data_params, timeout=60)
        self.assertEqual(res.status_code, 200)
        data = res.json()

        self.assertTrue(data.get("success", False))
        self.assertTrue(data["filename"].endswith(".srt"))

        # Tải và kiểm tra nội dung file SRT
        download_url = f"{BASE_URL}{data['download_url']}"
        dl_res = requests.get(download_url, timeout=10)
        self.assertEqual(dl_res.status_code, 200)

        print(f"  [PASS] test_04_transcribe_export_srt_subtitles: SRT Filename={data['filename']}")

    def test_05_transcribe_export_vtt_subtitles(self):
        """Kiểm tra trích xuất phụ đề WebVTT (.vtt)"""
        wav_bytes = create_sample_wav_bytes(duration_sec=2.0)
        files = {"file": ("podcast.mp3", wav_bytes, "audio/mpeg")}
        data_params = {
            "language": "auto",
            "format": "vtt"
        }

        res = requests.post(f"{BASE_URL}/api/transcribe", files=files, data=data_params, timeout=60)
        self.assertEqual(res.status_code, 200)
        data = res.json()

        self.assertTrue(data.get("success", False))
        self.assertTrue(data["filename"].endswith(".vtt"))

        # Tải và kiểm tra nội dung file VTT
        download_url = f"{BASE_URL}{data['download_url']}"
        dl_res = requests.get(download_url, timeout=10)
        self.assertEqual(dl_res.status_code, 200)
        self.assertTrue(dl_res.text.startswith("WEBVTT"))

        print(f"  [PASS] test_05_transcribe_export_vtt_subtitles: VTT Filename={data['filename']}, Header=WEBVTT OK")


if __name__ == "__main__":
    unittest.main()
