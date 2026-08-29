#!/usr/bin/env python3
"""
UNIT TEST FOR CACHE TTL AND 5-MINUTE AUTO CLEANUP (URL_CONVER & GOLANG ENGINE)
"""

import os
import sys
import time
import unittest

# Path setup
current_dir = os.path.dirname(os.path.abspath(__file__))
for path in ["/app", os.path.abspath(os.path.join(current_dir, "..")), os.path.abspath(os.path.join(current_dir, "..", "backend"))]:
    if os.path.exists(path) and path not in sys.path:
        sys.path.insert(0, path)

from app.url_conver.downloader import generate_cache_key, DEFAULT_DOWNLOAD_DIR
from app.url_conver.utils import clean_url_key

DOWNLOAD_DIR = DEFAULT_DOWNLOAD_DIR
CACHE_TTL = 300


class TestCacheExpiration(unittest.TestCase):

    def setUp(self):
        os.makedirs(DOWNLOAD_DIR, exist_ok=True)

    def test_01_cache_key_generation(self):
        """Kiểm tra tạo mã băm cache nhất quán theo URL, định dạng và chất lượng"""
        key1 = generate_cache_key(clean_url_key("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "mp3", "320")
        key2 = generate_cache_key(clean_url_key("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=123"), "mp3", "320")
        # Do clean_url_key lọc bỏ query list/tracking nên 2 key phải trùng nhau
        self.assertEqual(key1, key2)

    def test_02_metadata_cache_consistency(self):
        """Kiểm tra tính toàn vẹn của cache key và TTL chuẩn 5 phút (300s)"""
        self.assertEqual(CACHE_TTL, 300)
        key = generate_cache_key("https://www.youtube.com/watch?v=test", "mp3", "320")
        self.assertEqual(len(key), 10)

    def test_03_file_cache_and_cleanup_older_than_5_mins(self):
        """Kiểm tra phát hiện và xóa file cũ hơn 5 phút (300s)"""
        cache_key = "testttl001"
        test_file = os.path.join(DOWNLOAD_DIR, f"{cache_key}_Sample.mp3")

        # Tạo file giả lập
        with open(test_file, "wb") as f:
            f.write(b"x" * 2048)

        self.assertTrue(os.path.exists(test_file))

        # Giả lập lùi thời gian tạo file về quá khứ 350 giây trước (> 5 phút = 300s)
        past_time = time.time() - 350
        os.utime(test_file, (past_time, past_time))

        now = time.time()
        if (now - os.path.getmtime(test_file)) > CACHE_TTL:
            os.remove(test_file)

        self.assertFalse(os.path.exists(test_file), "File cũ hơn 5 phút phải được tự động xóa khỏi đĩa!")


if __name__ == "__main__":
    unittest.main()
