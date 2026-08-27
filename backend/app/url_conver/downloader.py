import os
import hashlib
import yt_dlp
from typing import Callable, Optional, Dict, Any
from .utils import sanitize_filename, clean_url_key

DEFAULT_DOWNLOAD_DIR = os.getenv("DOWNLOAD_DIR", "/app/downloads")


def generate_cache_key(url: str, media_format: str, quality: str) -> str:
    """Tạo tiền tố MD5 nhất quán cho file tải"""
    raw = f"{url.strip()}_{media_format.lower()}_{quality}"
    return hashlib.md5(raw.encode("utf-8")).hexdigest()[:10]


def get_base_ydl_opts(media_format: str = "mp3") -> Dict[str, Any]:
    """Cấu hình tối ưu hóa tốc độ tải và Adaptive Concurrency theo định dạng"""
    is_audio = media_format in ("mp3", "m4a", "wav", "flac")

    # Adaptive Concurrency: Audio dùng 4 fragments + 5MB buffer, Video dùng 8 fragments + 10MB buffer
    concurrent_fragments = 4 if is_audio else 8
    chunk_size = 5 * 1024 * 1024 if is_audio else 10 * 1024 * 1024

    return {
        'quiet': True,
        'no_warnings': True,
        'socket_timeout': 15,
        'retries': 10,
        'fragment_retries': 10,
        'skip_unavailable_fragments': True,
        'keepvideo': False,
        'nocheckcertificate': True,
        'concurrent_fragment_downloads': concurrent_fragments,
        'http_chunk_size': chunk_size,
        'hls_prefer_native': True,
    }


def run_download_task(
    url: str,
    media_format: str = "mp3",
    quality: str = "320",
    progress_callback: Optional[Callable[[float, str], None]] = None,
    output_dir: str = DEFAULT_DOWNLOAD_DIR,
    job_id: Optional[str] = None,
) -> Optional[str]:
    """Tải và chuyển đổi định dạng Media với Adaptive Concurrency và FFmpeg"""
    cleaned_url = clean_url_key(url)
    os.makedirs(output_dir, exist_ok=True)

    if progress_callback:
        progress_callback(10.0, "Đang lấy thông tin định dạng...")

    ydl_opts = get_base_ydl_opts(media_format)
    cache_prefix = generate_cache_key(cleaned_url, media_format, quality)

    def hook(d):
        if d['status'] == 'downloading':
            total = d.get('total_bytes') or d.get('total_bytes_estimate') or 0
            downloaded = d.get('downloaded_bytes', 0)
            if total > 0 and progress_callback:
                pct = 15.0 + (downloaded / total) * 65.0
                speed_str = d.get('_speed_str', '')
                progress_callback(min(pct, 80.0), f"Đang tải dữ liệu {speed_str}...")
        elif d['status'] == 'finished' and progress_callback:
            progress_callback(85.0, "Đang xử lý nén âm thanh qua FFmpeg...")

    ydl_opts['progress_hooks'] = [hook]

    # Cấu hình Output Template
    outtmpl = os.path.join(output_dir, f"{cache_prefix}_%(title)s.%(ext)s")
    ydl_opts['outtmpl'] = outtmpl

    if media_format == "mp3":
        ydl_opts.update({
            'format': 'bestaudio/best',
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': quality,
            }],
        })
    elif media_format == "mp4":
        ydl_opts.update({
            'format': f'bestvideo[height<={quality}]+bestaudio/best[height<={quality}]/best',
            'merge_output_format': 'mp4',
        })

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(cleaned_url, download=True)
            if not info:
                return None

            if 'entries' in info and info['entries']:
                info = info['entries'][0]

            title = sanitize_filename(info.get('title', 'media'))
            final_filename = f"{cache_prefix}_{title}.{media_format}"
            final_path = os.path.join(output_dir, final_filename)

            if not os.path.exists(final_path):
                # Quét file khớp với prefix
                for fname in os.listdir(output_dir):
                    if fname.startswith(cache_prefix):
                        final_filename = fname
                        final_path = os.path.join(output_dir, fname)
                        break

            if progress_callback:
                progress_callback(100.0, "Hoàn tất chuyển đổi!")

            return final_filename
    except Exception as e:
        print(f"[-] Lỗi trong quá trình tải {url}: {e}")
        if progress_callback:
            progress_callback(-1.0, f"Lỗi: {str(e)}")
        return None
