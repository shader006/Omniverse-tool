"""
URL CONVERTER ENGINE
Module chuyên trách phân tích và tải đa nền tảng (YouTube, Facebook, TikTok, SoundCloud, ...)
sử dụng yt-dlp, Deno PO Token, và FFmpeg Adaptive Concurrency.
"""

from .downloader import run_download_task, get_base_ydl_opts
from .metadata import get_media_info
from .utils import sanitize_filename, clean_url_key

__all__ = [
    "run_download_task",
    "get_base_ydl_opts",
    "get_media_info",
    "sanitize_filename",
    "clean_url_key",
]
