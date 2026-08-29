"""
Formatter utilities for transcription output.
Handles SRT, WebVTT, Plain Text, and JSON formatting with micro-second timestamp precision.
"""

import json
from typing import Dict, Any, List


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


def export_content(result: Dict[str, Any], output_format: str) -> str:
    """
    Convert transcription result into specified format: txt, srt, vtt, json.
    """
    fmt = output_format.strip().lower().replace(".", "")
    segments: List[Dict[str, Any]] = result.get("segments", [])

    if fmt == "srt":
        lines = []
        for idx, seg in enumerate(segments, start=1):
            lines.append(str(idx))
            lines.append(f"{format_timestamp_srt(seg['start'])} --> {format_timestamp_srt(seg['end'])}")
            lines.append(seg.get("text", ""))
            lines.append("")
        return "\n".join(lines)

    elif fmt == "vtt":
        lines = ["WEBVTT", ""]
        for idx, seg in enumerate(segments, start=1):
            lines.append(str(idx))
            lines.append(f"{format_timestamp_vtt(seg['start'])} --> {format_timestamp_vtt(seg['end'])}")
            lines.append(seg.get("text", ""))
            lines.append("")
        return "\n".join(lines)

    elif fmt == "json":
        return json.dumps(result, ensure_ascii=False, indent=2)

    else:  # txt
        return result.get("text", "")
