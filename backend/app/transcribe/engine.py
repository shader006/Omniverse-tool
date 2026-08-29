"""
Core Engine for Media Transcription using faster-whisper on CPU.
Supports MP3, MP4, WAV, M4A, WEBM, FLAC, and exports to TXT, SRT, VTT, JSON.
"""

import os
import sys
import time
import math
from typing import Optional, Dict, Any, List, Tuple


def format_timestamp_srt(seconds: float) -> str:
    """Format seconds into SRT timestamp format: HH:MM:SS,mmm"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int(round((seconds - int(seconds)) * 1000))
    if millis >= 1000:
        millis = 999
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def format_timestamp_vtt(seconds: float) -> str:
    """Format seconds into WebVTT timestamp format: HH:MM:SS.mmm"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int(round((seconds - int(seconds)) * 1000))
    if millis >= 1000:
        millis = 999
    return f"{hours:02d}:{minutes:02d}:{secs:02d}.{millis:03d}"


def preprocess_audio_file(input_path: str) -> Tuple[str, bool]:
    """
    Tiền xử lý âm thanh chuyên sâu với FFmpeg:
    1. Bandpass filter: highpass=80Hz + lowpass=8000Hz (loại bỏ tiếng ù bass & tiếng chói treble).
    2. afftdn: Lọc giảm nhiễu nền (hiss, fan, background noise).
    3. loudnorm: Chuẩn hóa âm lượng EBU R128 (-16 LUFS) để Whisper nhận diện rõ từng từ thì thầm.
    4. Resample: Xuất file WAV chuẩn 16,000Hz Mono 16-bit PCM.
    Trả về: (đường_dẫn_file_xử_lý, is_temp_file)
    """
    import subprocess
    import tempfile

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


class TranscribeEngine:
    def __init__(
        self,
        model_size: str = "small",
        device: str = "cpu",
        compute_type: str = "int8",
        cpu_threads: int = 4,
    ):
        self.model_size = os.getenv("WHISPER_MODEL_SIZE", model_size)
        self.device = "cpu"  # Strictly CPU mode as requested
        self.compute_type = os.getenv("WHISPER_COMPUTE_TYPE", compute_type)
        self.cpu_threads = int(os.getenv("WHISPER_CPU_THREADS", str(cpu_threads)))
        self._model = None

    @property
    def model(self):
        if self._model is None:
            try:
                from faster_whisper import WhisperModel
                # Tải model tối ưu trên CPU với định dạng INT8
                self._model = WhisperModel(
                    self.model_size,
                    device=self.device,
                    compute_type=self.compute_type,
                    cpu_threads=self.cpu_threads,
                    download_root=os.getenv("WHISPER_CACHE_DIR", "/tmp/whisper_models"),
                )
            except Exception as e:
                raise RuntimeError(f"Không thể khởi tạo faster-whisper model '{self.model_size}': {e}")
        return self._model

    def transcribe_file(
        self,
        file_path: str,
        language: Optional[str] = None,
        task: str = "transcribe",
        beam_size: int = 5,
        vad_filter: bool = False,
    ) -> Dict[str, Any]:
        """
        Transcribe an audio or video file to text segments with audio preprocessing.
        """
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"Không tìm thấy file: {file_path}")

        # Chuẩn hóa ngôn ngữ ('auto' -> None)
        lang = language.strip().lower() if language and language.strip().lower() != "auto" else None

        start_time = time.time()

        # Tiền xử lý âm thanh qua FFmpeg (Loudness Normalization + Bandpass Filter)
        audio_to_process, is_temp = preprocess_audio_file(file_path)

        try:
            segments_gen, info = self.model.transcribe(
                audio_to_process,
                language=lang,
                task=task,
                beam_size=beam_size,
                condition_on_previous_text=False,
                vad_filter=vad_filter,
                no_speech_threshold=0.8,
                compression_ratio_threshold=3.0,
                log_prob_threshold=-1.5,
                hallucination_silence_threshold=2.0,
                no_repeat_ngram_size=3,
                repetition_penalty=1.2,
            )

            segments: List[Dict[str, Any]] = []
            full_text_parts: List[str] = []
            last_text = ""

            for seg in segments_gen:
                clean_text = seg.text.strip()
                # Lọc bỏ các phân đoạn ảo giác sinh ra trên nền nhạc không lời (outro solo guitar/drums)
                no_speech = getattr(seg, "no_speech_prob", 0.0) or 0.0
                if no_speech > 0.85:
                    continue

                # Loại bỏ lặp từ vô tận nếu có
                if clean_text and clean_text != last_text:
                    full_text_parts.append(clean_text)
                    segments.append({
                        "id": seg.id,
                        "start": round(seg.start, 3),
                        "end": round(seg.end, 3),
                        "text": clean_text,
                        "avg_logprob": round(seg.avg_logprob, 3) if hasattr(seg, "avg_logprob") else 0.0,
                    })
                    last_text = clean_text

            duration_processed = round(time.time() - start_time, 2)
            full_text = " ".join(full_text_parts)

            detected_lang = getattr(info, "language", None) or "vi"
            lang_prob = getattr(info, "language_probability", 0.0) or 0.0
            audio_dur = getattr(info, "duration", 0.0) or 0.0

            return {
                "success": True,
                "text": full_text,
                "detected_language": detected_lang,
                "language_probability": round(float(lang_prob), 3),
                "audio_duration": round(float(audio_dur), 2),
                "processing_time": duration_processed,
                "segments": segments,
            }
        finally:
            # Tự động dọn dẹp file WAV tiền xử lý tạm thời
            if is_temp and os.path.exists(audio_to_process):
                try:
                    os.remove(audio_to_process)
                except Exception:
                    pass

    def export_content(self, result: Dict[str, Any], output_format: str) -> str:
        """
        Convert transcription result into specified format: txt, srt, vtt, json.
        """
        fmt = output_format.strip().lower().replace(".", "")
        segments = result.get("segments", [])

        if fmt == "srt":
            lines = []
            for idx, seg in enumerate(segments, start=1):
                lines.append(str(idx))
                lines.append(f"{format_timestamp_srt(seg['start'])} --> {format_timestamp_srt(seg['end'])}")
                lines.append(seg["text"])
                lines.append("")
            return "\n".join(lines)

        elif fmt == "vtt":
            lines = ["WEBVTT", ""]
            for idx, seg in enumerate(segments, start=1):
                lines.append(str(idx))
                lines.append(f"{format_timestamp_vtt(seg['start'])} --> {format_timestamp_vtt(seg['end'])}")
                lines.append(seg["text"])
                lines.append("")
            return "\n".join(lines)

        elif fmt == "json":
            import json
            return json.dumps(result, ensure_ascii=False, indent=2)

        else:  # txt
            return result.get("text", "")


# Singleton instance
_engine_instance = None

def get_transcribe_engine() -> TranscribeEngine:
    global _engine_instance
    if _engine_instance is None:
        _engine_instance = TranscribeEngine()
    return _engine_instance
