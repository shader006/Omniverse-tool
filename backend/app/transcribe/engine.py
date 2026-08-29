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
        vad_filter: bool = True,
    ) -> Dict[str, Any]:
        """
        Transcribe an audio or video file to text segments.
        """
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"Không tìm thấy file: {file_path}")

        # Chuẩn hóa ngôn ngữ ('auto' -> None)
        lang = language.strip().lower() if language and language.strip().lower() != "auto" else None

        start_time = time.time()

        segments_gen, info = self.model.transcribe(
            file_path,
            language=lang,
            task=task,
            beam_size=beam_size,
            vad_filter=vad_filter,
            vad_parameters=dict(min_silence_duration_ms=500),
        )

        segments: List[Dict[str, Any]] = []
        full_text_parts: List[str] = []

        for seg in segments_gen:
            clean_text = seg.text.strip()
            if clean_text:
                full_text_parts.append(clean_text)
                segments.append({
                    "id": seg.id,
                    "start": round(seg.start, 3),
                    "end": round(seg.end, 3),
                    "text": clean_text,
                    "avg_logprob": round(seg.avg_logprob, 3) if hasattr(seg, "avg_logprob") else 0.0,
                })

        duration_processed = round(time.time() - start_time, 2)
        full_text = " ".join(full_text_parts)

        return {
            "success": True,
            "text": full_text,
            "detected_language": info.language,
            "language_probability": round(info.language_probability, 3),
            "audio_duration": round(info.duration, 2),
            "processing_time": duration_processed,
            "segments": segments,
        }

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
