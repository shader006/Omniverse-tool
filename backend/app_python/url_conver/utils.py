import re
import urllib.parse
from typing import Optional


def sanitize_filename(name: str) -> str:
    """Làm sạch tên file để tránh lỗi hệ điều hành và ký tự đặc biệt"""
    if not name:
        return "download"
    # Thay thế các ký tự cấm: \ / : * ? " < > |
    cleaned = re.sub(r'[\\/*?:"<>|]', "", name)
    # Rút gọn khoảng trắng
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned[:120] if cleaned else "download"


def clean_url_key(url: str) -> str:
    """Chuẩn hóa URL (bỏ query parameters rác như fbclid, tracking, timestamp) để tạo Cache Key chuẩn"""
    try:
        parsed = urllib.parse.urlparse(url)
        # Đối với YouTube, giữ lại query param 'v'
        if "youtube.com" in parsed.netloc or "youtu.be" in parsed.netloc:
            qs = urllib.parse.parse_qs(parsed.query)
            video_id = qs.get("v", [""])[0]
            if video_id:
                return f"https://www.youtube.com/watch?v={video_id}"
            elif "youtu.be" in parsed.netloc:
                return f"https://www.youtube.com/watch?v={parsed.path.strip('/')}"
        
        # Với các URL khác, bỏ các param tracking phổ biến
        qs = urllib.parse.parse_qs(parsed.query)
        filtered_qs = {k: v for k, v in qs.items() if not k.startswith("fbclid") and not k.startswith("utm_") and k != "mibextid"}
        new_query = urllib.parse.urlencode(filtered_qs, doseq=True)
        return urllib.parse.urlunparse((parsed.scheme, parsed.netloc, parsed.path, parsed.params, new_query, ""))
    except Exception:
        return url.strip()
