"""
Transcribe Module using faster-whisper (CPU optimized)
"""
from app.transcribe.engine import TranscribeEngine, get_transcribe_engine

__all__ = ["TranscribeEngine", "get_transcribe_engine"]
