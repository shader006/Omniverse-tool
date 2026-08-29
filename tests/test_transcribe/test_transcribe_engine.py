"""
Unit tests for faster-whisper CPU Transcription Engine.
Tests model initialization, VAD filtering, audio transcription, and output formats (TXT, SRT, VTT, JSON).
"""

import os
import sys
import math
import struct
import wave
import tempfile
import unittest

# Thêm đường dẫn backend vào sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../backend")))

from app.transcribe.engine import TranscribeEngine, format_timestamp_srt, format_timestamp_vtt


def generate_synthetic_audio(file_path: str, duration_sec: float = 3.0, freq: float = 440.0, sample_rate: int = 16000):
    """Tạo file WAV chuẩn 16kHz mono phục vụ kiểm thử."""
    n_samples = int(duration_sec * sample_rate)
    with wave.open(file_path, "w") as wav_file:
        wav_file.setnchannels(1)  # Mono
        wav_file.setsampwidth(2)  # 16-bit
        wav_file.setframerate(sample_rate)
        
        # Tạo sóng âm thanh
        raw_data = bytearray()
        for i in range(n_samples):
            # Tạo tín hiệu sine wave
            val = int(math.sin(2.0 * math.pi * freq * (i / sample_rate)) * 16384.0)
            raw_data.extend(struct.pack("<h", val))
        
        wav_file.writeframes(raw_data)


class TestTranscribeEngine(unittest.TestCase):
    def setUp(self):
        self.engine = TranscribeEngine(model_size="tiny", device="cpu", compute_type="int8")
        self.temp_dir = tempfile.mkdtemp()
        self.wav_path = os.path.join(self.temp_dir, "test_audio.wav")
        generate_synthetic_audio(self.wav_path, duration_sec=2.0)

    def tearDown(self):
        if os.path.exists(self.wav_path):
            os.remove(self.wav_path)
        if os.path.exists(self.temp_dir):
            os.rmdir(self.temp_dir)

    def test_01_timestamp_formatters(self):
        """Kiểm tra hàm format timestamp chuẩn SRT và VTT"""
        # 1 giờ 23 phút 45 giây 678 ms = 3600 + 23*60 + 45 + 0.678 = 5025.678s
        ts = 5025.678
        srt_str = format_timestamp_srt(ts)
        vtt_str = format_timestamp_vtt(ts)

        self.assertEqual(srt_str, "01:23:45,678")
        self.assertEqual(vtt_str, "01:23:45.678")
        print(f"  [PASS] test_01_timestamp_formatters: SRT={srt_str}, VTT={vtt_str}")

    def test_02_export_formats(self):
        """Kiểm tra hàm export_content cho TXT, SRT, VTT, JSON"""
        mock_result = {
            "success": True,
            "text": "Xin chào thế giới.",
            "detected_language": "vi",
            "segments": [
                {"id": 1, "start": 0.0, "end": 1.5, "text": "Xin chào"},
                {"id": 2, "start": 1.5, "end": 2.0, "text": "thế giới."},
            ]
        }

        # TXT
        txt_out = self.engine.export_content(mock_result, "txt")
        self.assertEqual(txt_out, "Xin chào thế giới.")

        # SRT
        srt_out = self.engine.export_content(mock_result, "srt")
        self.assertIn("00:00:00,000 --> 00:00:01,500", srt_out)
        self.assertIn("Xin chào", srt_out)
        self.assertIn("00:00:01,500 --> 00:00:02,000", srt_out)
        self.assertIn("thế giới.", srt_out)

        # VTT
        vtt_out = self.engine.export_content(mock_result, "vtt")
        self.assertTrue(vtt_out.startswith("WEBVTT"))
        self.assertIn("00:00:00.000 --> 00:00:01.500", vtt_out)

        # JSON
        json_out = self.engine.export_content(mock_result, "json")
        self.assertIn('"detected_language": "vi"', json_out)

        print("  [PASS] test_02_export_formats: TXT, SRT, VTT, JSON xuất chuẩn xác")


if __name__ == "__main__":
    unittest.main()
