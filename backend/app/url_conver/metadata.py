import yt_dlp
import re
from typing import Dict, Any, Tuple, Optional
from .utils import clean_url_key

# Cấu hình yt-dlp trích xuất nhanh thông tin không tải stream
FAST_INFO_OPTS = {
    'quiet': True,
    'no_warnings': True,
    'skip_download': True,
    'extract_flat': False,
    'socket_timeout': 10,
}


MAX_URL_DURATION_SECS = 3 * 3600  # 3 giờ tối đa (10800 giây)

def parse_friendly_error(err_str: str, url: str) -> str:
    """Chuyển đổi các thông báo lỗi kỹ thuật của yt-dlp/Facebook/YouTube thành lỗi tiếng Việt chính xác và dễ hiểu"""
    err_lower = err_str.lower()
    
    if "login.php" in err_lower or "login" in err_lower or "sign in" in err_lower:
        if "stories" in url.lower():
            return "Facebook Story (Tin 24h) yêu cầu đăng nhập tài khoản Facebook cá nhân nên không thể tải công khai."
        return "Nội dung này yêu cầu đăng nhập tài khoản để xem. Vui lòng dùng liên kết ở chế độ Công khai (Public)."

    if "cannot parse data" in err_lower or "400" in err_lower:
        if "reel" in url.lower() or "facebook" in err_lower:
            return "Video Reel/Facebook này ở chế độ Riêng tư (Bạn bè/Nhóm kín) hoặc đã bị giới hạn người xem."
        return "Không thể phân tích dữ liệu video. Có thể video ở chế độ riêng tư hoặc đã bị xóa."

    if "private video" in err_lower or "this video is private" in err_lower or "join this group" in err_lower:
        return "Video được đặt ở chế độ Riêng tư hoặc thuộc Nhóm kín (Private Group)."

    if "video unavailable" in err_lower or "this video is unavailable" in err_lower or "not available" in err_lower:
        return "Video không khả dụng hoặc đã bị tác giả xóa bỏ khỏi nền tảng."

    if "unsupported url" in err_lower:
        return "Định dạng liên kết này không chứa video hoặc nền tảng không hỗ trợ."

    if "geo" in err_lower or "country" in err_lower or "not available in your country" in err_lower:
        return "Video bị giới hạn bản quyền theo quốc gia / vùng địa lý."

    if "timed out" in err_lower or "timeout" in err_lower:
        return "Hết thời gian kết nối tới máy chủ video (Timeout). Vui lòng thử lại."

    # Lọc bỏ các tiền tố kỹ thuật nếu có
    clean_err = re.sub(r'ERROR:\s*\[.*?\]\s*', '', err_str).strip()
    return clean_err if clean_err else "Không thể trích xuất thông tin từ liên kết này."


def get_media_info_with_error(url: str) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """Trích xuất Metadata kèm thông báo lỗi chi tiết và kiểm tra giới hạn thời lượng"""
    cleaned_url = clean_url_key(url)
    try:
        with yt_dlp.YoutubeDL(FAST_INFO_OPTS) as ydl:
            info = ydl.extract_info(cleaned_url, download=False)
            if not info:
                return None, "Không tìm thấy dữ liệu video cho liên kết này."

            if isinstance(info.get('entries'), (list, tuple)) and len(info['entries']) > 0:
                info = info['entries'][0]

            duration_secs = info.get('duration', 0) or 0
            try:
                dur_int = int(duration_secs)
                hours = dur_int // 3600
                minutes = (dur_int % 3600) // 60
                seconds = dur_int % 60
                if hours > 0:
                    duration_str = f"{hours}:{minutes:02d}:{seconds:02d}"
                else:
                    duration_str = f"{minutes}:{seconds:02d}"
            except Exception:
                duration_str = "N/A"

            # Kiểm tra giới hạn thời lượng 3 giờ
            if duration_secs > MAX_URL_DURATION_SECS:
                return None, f"Thời lượng video/audio ({duration_str}) vượt quá giới hạn tối đa cho phép là 3 giờ. Vui lòng chọn liên kết ngắn hơn."

            thumbnail = info.get('thumbnail') or ""
            if not thumbnail and isinstance(info.get('thumbnails'), (list, tuple)) and len(info['thumbnails']) > 0:
                last_thumb = info['thumbnails'][-1]
                if isinstance(last_thumb, dict):
                    thumbnail = last_thumb.get('url', '')

            data = {
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
            return data, None

    except Exception as e:
        err_msg = parse_friendly_error(str(e), url)
        return None, err_msg


def get_media_info(url: str) -> Optional[Dict[str, Any]]:
    """Hàm tương thích chuẩn trả về Dict hoặc None"""
    data, _ = get_media_info_with_error(url)
    return data
