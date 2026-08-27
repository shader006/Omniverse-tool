import yt_dlp
from typing import Dict, Any, Optional
from .utils import clean_url_key

# Cấu hình yt-dlp trích xuất nhanh thông tin không tải stream
FAST_INFO_OPTS = {
    'quiet': True,
    'no_warnings': True,
    'skip_download': True,
    'extract_flat': False,
    'socket_timeout': 10,
}


def get_media_info(url: str) -> Optional[Dict[str, Any]]:
    """Trích xuất nhanh Metadata của Video / Audio từ URL sử dụng yt-dlp"""
    cleaned_url = clean_url_key(url)
    try:
        with yt_dlp.YoutubeDL(FAST_INFO_OPTS) as ydl:
            info = ydl.extract_info(cleaned_url, download=False)
            if not info:
                return None

            # Xử lý trường hợp playlist / entries
            if 'entries' in info and info['entries']:
                info = info['entries'][0]

            duration_secs = info.get('duration', 0)
            if duration_secs:
                minutes = int(duration_secs) // 60
                seconds = int(duration_secs) % 60
                duration_str = f"{minutes}:{seconds:02d}"
            else:
                duration_str = "N/A"

            thumbnail = info.get('thumbnail') or ""
            # Nếu thumbnail là mảng formats
            if not thumbnail and info.get('thumbnails'):
                thumbnail = info['thumbnails'][-1].get('url', '')

            return {
                "title": info.get('title', 'Untitled Media'),
                "duration": duration_str,
                "duration_str": duration_str,
                "duration_seconds": duration_secs,
                "thumbnail": thumbnail,
                "uploader": info.get('uploader', 'Unknown Creator'),
                "platform": info.get('extractor_key', 'Generic'),
                "url": cleaned_url,
                "original_url": url,
            }
    except Exception as e:
        print(f"[-] Lỗi khi trích xuất Metadata cho {url}: {e}")
        return None
