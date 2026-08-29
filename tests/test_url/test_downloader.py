import os
import sys
import unittest

# Thêm đường dẫn thư mục gốc chứa package 'app'
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.abspath(os.path.join(current_dir, ".."))
backend_dir = os.path.abspath(os.path.join(current_dir, "..", "backend"))

for path in ["/app", backend_dir, parent_dir]:
    if os.path.exists(path) and path not in sys.path:
        sys.path.insert(0, path)

from app.url_conver.utils import sanitize_filename
from app.url_conver.metadata import get_media_info
from app.url_conver.downloader import run_download_task, DEFAULT_DOWNLOAD_DIR


class TestDownloader(unittest.TestCase):

    def test_01_sanitize_filename(self):
        """Kiểm tra hàm lọc ký tự đặc biệt trong tên file"""
        dirty_name = 'Video / Test : "Special" <Chars> | ? * Name'
        clean = sanitize_filename(dirty_name)
        self.assertNotIn("/", clean)
        self.assertNotIn(":", clean)
        self.assertNotIn("<", clean)
        self.assertNotIn(">", clean)
        self.assertNotIn("|", clean)
        self.assertNotIn("?", clean)
        self.assertNotIn("*", clean)
        self.assertEqual(clean, "Video Test Special Chars Name")
        print(" [PASS] test_01_sanitize_filename")

    def test_02_get_media_info(self):
        """Kiểm tra hàm trích xuất metadata video nhanh"""
        test_url = "https://www.youtube.com/watch?v=jNQXAC9IVRw"  # Video 'Me at the zoo' (18s)
        info = get_media_info(test_url)
        self.assertIn("title", info)
        self.assertIn("duration", info)
        self.assertIn("thumbnail", info)
        print(f" [PASS] test_02_get_media_info: Title='{info['title']}', Duration={info['duration']}")

    def test_03_download_mp3_with_progress(self):
        """Kiểm tra tải và chuyển đổi sang MP3 kèm callback tiến độ"""
        test_url = "https://www.youtube.com/watch?v=jNQXAC9IVRw"
        progress_records = []

        def on_progress(percent, msg):
            progress_records.append(percent)

        filename = run_download_task(
            url=test_url,
            media_format="mp3",
            quality="128",
            progress_callback=on_progress
        )

        file_path = os.path.join(DEFAULT_DOWNLOAD_DIR, filename)
        self.assertTrue(os.path.exists(file_path), f"File {file_path} không tồn tại!")
        self.assertTrue(filename.endswith(".mp3"), f"File {filename} không có đuôi .mp3!")
        self.assertGreater(len(progress_records), 0, "Không nhận được sự kiện tiến độ nào!")
        print(f" [PASS] test_03_download_mp3: File={filename}, Size={os.path.getsize(file_path)} bytes")


if __name__ == "__main__":
    unittest.main()
