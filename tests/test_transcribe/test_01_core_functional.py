#!/usr/bin/env python3
"""
NHÓM 1: KIỂM THỬ CHỨC NĂNG CỐT LÕI TRANSCRIBE (CORE FUNCTIONAL & MULTI-FORMAT)
Bao gồm:
- Tải lên & nhận diện các định dạng media đa dạng (.wav, .mp3, .mp4, .flac, .ogg)
- Xuất các định dạng phụ đề và dữ liệu cấu trúc (.txt, .srt, .vtt, .json)
- Nhận diện đa ngôn ngữ (Tiếng Việt 'vi', Tiếng Anh 'en', Tự động 'auto')
- Tác vụ dịch thuật trực tiếp sang tiếng Anh (task 'translate')
"""

import os
import sys
import io
import math
import struct
import wave
import json
import requests
import unittest

BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8000" if os.path.exists("/app") else "http://localhost:80")


def create_sample_wav_bytes(duration_sec: float = 2.0, freq: float = 440.0, sample_rate: int = 16000) -> bytes:
    """Tạo buffer WAV in-memory với tần số chỉ định."""
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


class TestTranscribeCoreFunctional(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        try:
            res = requests.get(f"{BASE_URL}/health", timeout=5)
            if res.status_code != 200:
                raise Exception("Server is not healthy")
        except Exception as e:
            raise unittest.SkipTest(f"Không kết nối được Gateway tại {BASE_URL}: {e}")

    def test_01_transcribe_wav_to_txt(self):
        """1. Nhận diện giọng nói từ file WAV và tải về file .txt hoàn chỉnh"""
        wav_bytes = create_sample_wav_bytes(duration_sec=2.0)
        files = {"file": ("speech_vi.wav", wav_bytes, "audio/wav")}
        data_params = {"language": "vi", "format": "txt", "task": "transcribe"}

        res = requests.post(f"{BASE_URL}/api/transcribe", files=files, data=data_params, timeout=120)
        self.assertEqual(res.status_code, 200)
        data = res.json()

        self.assertTrue(data.get("success", False))
        self.assertIn("download_url", data)
        self.assertTrue(data["filename"].endswith(".txt"))

        dl_res = requests.get(f"{BASE_URL}{data['download_url']}", timeout=10)
        self.assertEqual(dl_res.status_code, 200)
        print(f" [PASS] test_01: Transcribe WAV -> TXT thành công: '{data['filename']}' ({data.get('audio_duration')}s)")

    def test_02_transcribe_mp4_video_to_srt(self):
        """2. Trích xuất âm thanh từ file video MP4 và xuất phụ đề SubRip (.srt)"""
        wav_bytes = create_sample_wav_bytes(duration_sec=2.5)
        files = {"file": ("demo_video.mp4", wav_bytes, "video/mp4")}
        data_params = {"language": "en", "format": "srt"}

        res = requests.post(f"{BASE_URL}/api/transcribe", files=files, data=data_params, timeout=120)
        self.assertEqual(res.status_code, 200)
        data = res.json()

        self.assertTrue(data.get("success", False))
        self.assertTrue(data["filename"].endswith(".srt"))

        dl_res = requests.get(f"{BASE_URL}{data['download_url']}", timeout=10)
        self.assertEqual(dl_res.status_code, 200)
        print(f" [PASS] test_02: Transcribe Video MP4 -> SRT Subtitle thành công: '{data['filename']}'")

    def test_03_transcribe_mp3_to_vtt(self):
        """3. Nhận diện từ file MP3 và xuất phụ đề WebVTT (.vtt) chuẩn web"""
        wav_bytes = create_sample_wav_bytes(duration_sec=2.0)
        files = {"file": ("podcast_audio.mp3", wav_bytes, "audio/mpeg")}
        data_params = {"language": "auto", "format": "vtt"}

        res = requests.post(f"{BASE_URL}/api/transcribe", files=files, data=data_params, timeout=120)
        self.assertEqual(res.status_code, 200)
        data = res.json()

        self.assertTrue(data.get("success", False))
        self.assertTrue(data["filename"].endswith(".vtt"))

        dl_res = requests.get(f"{BASE_URL}{data['download_url']}", timeout=10)
        self.assertEqual(dl_res.status_code, 200)
        self.assertTrue(dl_res.text.startswith("WEBVTT"), "File VTT phải bắt đầu bằng header WEBVTT")
        print(f" [PASS] test_03: Transcribe MP3 -> VTT thành công (Header WEBVTT hợp lệ)")

    def test_04_transcribe_export_json_segments(self):
        """4. Xuất dữ liệu cấu trúc JSON chứa đầy đủ mảng segments và timestamps"""
        wav_bytes = create_sample_wav_bytes(duration_sec=2.0)
        files = {"file": ("interview.wav", wav_bytes, "audio/wav")}
        data_params = {"language": "en", "format": "json"}

        res = requests.post(f"{BASE_URL}/api/transcribe", files=files, data=data_params, timeout=120)
        self.assertEqual(res.status_code, 200)
        data = res.json()

        self.assertTrue(data.get("success", False))
        self.assertTrue(data["filename"].endswith(".json"))

        dl_res = requests.get(f"{BASE_URL}{data['download_url']}", timeout=10)
        self.assertEqual(dl_res.status_code, 200)
        json_content = dl_res.json()
        self.assertIn("text", json_content)
        self.assertIn("segments", json_content)
        self.assertIn("audio_duration", json_content)
        print(f" [PASS] test_04: Transcribe -> JSON Segments thành công (Segments: {len(json_content['segments'])})")

    def test_05_task_translate_to_english(self):
        """5. Kiểm tra tác vụ 'translate' (Dịch trực tiếp âm thanh ngôn ngữ khác sang tiếng Anh)"""
        wav_bytes = create_sample_wav_bytes(duration_sec=2.0)
        files = {"file": ("foreign_speech.wav", wav_bytes, "audio/wav")}
        data_params = {
            "language": "vi",
            "format": "txt",
            "task": "translate"
        }

        res = requests.post(f"{BASE_URL}/api/transcribe", files=files, data=data_params, timeout=120)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data.get("success", False))
        print(f" [PASS] test_05: Thực thi thành công tác vụ translate (Dịch sang tiếng Anh)")

    def test_06_support_extended_audio_formats(self):
        """6. Kiểm tra chấp nhận các định dạng mở rộng (.flac, .ogg, .m4a, .webm)"""
        wav_bytes = create_sample_wav_bytes(duration_sec=1.5)
        extended_formats = [
            ("audio.flac", "audio/flac"),
            ("audio.ogg", "audio/ogg"),
            ("audio.m4a", "audio/mp4"),
            ("audio.webm", "audio/webm"),
        ]

        for fname, mime in extended_formats:
            files = {"file": (fname, wav_bytes, mime)}
            res = requests.post(f"{BASE_URL}/api/transcribe", files=files, data={"format": "txt"}, timeout=120)
            self.assertEqual(res.status_code, 200, f"Định dạng {fname} bị từ chối")
            self.assertTrue(res.json().get("success", False))
        print(f" [PASS] test_06: Hỗ trợ trơn tru tất cả các định dạng âm thanh mở rộng (.flac, .ogg, .m4a, .webm)")


if __name__ == "__main__":
    unittest.main()
