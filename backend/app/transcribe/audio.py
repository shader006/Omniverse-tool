"""
Audio preprocessing utilities for transcription.
Applies FFmpeg filters (Bandpass 80-8000Hz, noise reduction, and loudness normalization).
"""

import os
import time
import subprocess
import tempfile
from typing import Tuple


def preprocess_audio_file(input_path: str) -> Tuple[str, bool]:
    """
    Tiền xử lý âm thanh chuyên sâu với FFmpeg:
    1. Bandpass filter: highpass=80Hz + lowpass=8000Hz (loại bỏ tiếng ù bass & tiếng chói treble).
    2. afftdn: Lọc giảm nhiễu nền (hiss, fan, background noise).
    3. loudnorm: Chuẩn hóa âm lượng EBU R128 (-16 LUFS) để Whisper nhận diện rõ từng từ thì thầm.
    4. Resample: Xuất file WAV chuẩn 16,000Hz Mono 16-bit PCM.
    Trả về: (đường_dẫn_file_xử_lý, is_temp_file)
    """
    if not os.path.exists(input_path):
        return input_path, False

    temp_wav = os.path.join(tempfile.gettempdir(), f"prep_{int(time.time()*1000)}_{os.path.basename(input_path)}.wav")
    audio_filter = "highpass=f=80,lowpass=f=8000,afftdn=nr=10:nf=-25,loudnorm=I=-16:TP=-1.5:LRA=11"

    cmd = [
        "ffmpeg", "-y", "-i", input_path,
        "-vn", "-sn",
        "-af", audio_filter,
        "-ar", "16000",
        "-ac", "1",
        "-c:a", "pcm_s16le",
        temp_wav
    ]

    try:
        res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120)
        if res.returncode == 0 and os.path.exists(temp_wav) and os.path.getsize(temp_wav) > 100:
            return temp_wav, True
    except Exception:
        pass

    return input_path, False
