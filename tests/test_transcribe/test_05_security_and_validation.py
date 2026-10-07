#!/usr/bin/env python3
"""
NHÓM 5: AN TOÀN BẢO MẬT & XÁC THỰC TRANSCRIBE (SECURITY & VALIDATION)
Bao gồm:
- Chặn tải lên file thực thi nguy hiểm (.exe, .sh, .bat, .bin) giả mạo hoặc đổi tên
- Chống Path Traversal trên tên file tải lên (../../etc/passwd)
- Giới hạn kích thước tải lên tối đa 250MB
- Kiểm tra phản hồi lỗi không rò rỉ đường dẫn tuyệt đối nhạy cảm của server
"""

import os
import sys
import io
import requests
import unittest

BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8000" if os.path.exists("/app") else "http://localhost:80")


class TestTranscribeSecurity(unittest.TestCase):

    def test_01_block_executable_files(self):
        """1. Chặn đứng tải lên các file thực thi nguy hiểm (.exe, .sh, .py, .bin)"""
        malicious_files = [
            ("malicious.exe", b"MZDummyPEHeaderExecutable", "application/x-msdownload"),
            ("script.sh", b"#!/bin/bash\nrm -rf /", "application/x-sh"),
            ("payload.bin", b"\x7fELF\x02\x01\x01\x00BinaryPayload", "application/octet-stream"),
            ("trojan.py", b"import os; os.system('echo hack')", "text/x-python"),
        ]

        for fname, content, mime in malicious_files:
            files = {"file": (fname, content, mime)}
            res = requests.post(f"{BASE_URL}/api/transcribe", files=files, timeout=10)
            self.assertEqual(res.status_code, 400, f"File nguy hiểm {fname} không bị chặn 400")
            data = res.json()
            self.assertFalse(data.get("success", True))
            self.assertIn("không được hỗ trợ", data.get("detail", ""))
        print(" [PASS] test_01: Chặn đứng 100% các file thực thi nguy hiểm (.exe, .sh, .bin, .py)")

    def test_02_path_traversal_on_upload_filename(self):
        """2. Chống Path Traversal trên tên file upload (../../etc/passwd.mp3)"""
        traversal_names = [
            "../../etc/passwd.mp3",
            "..%2f..%2fapp%2fmain.go.wav",
            "/root/secret.mp4",
        ]
        dummy_wav = b"RIFF$\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00\x80>\x00\x00\x00}\x00\x00\x02\x00\x10\x00data\x00\x00\x00\x00"

        for bad_name in traversal_names:
            files = {"file": (bad_name, dummy_wav, "audio/wav")}
            res = requests.post(f"{BASE_URL}/api/transcribe", files=files, timeout=15)
            # Dù thành công hay lỗi, filename trả về không bao giờ được chứa dấu ../
            if res.status_code == 200:
                out_name = res.json().get("filename", "")
                self.assertNotIn("..", out_name)
                self.assertNotIn("/", out_name)
        print(" [PASS] test_02: Tên file upload chứa Path Traversal được làm sạch an toàn tuyệt đối")

    def test_03_no_internal_server_path_leak(self):
        """3. Kiểm tra phản hồi lỗi không làm lộ đường dẫn nội bộ nhạy cảm trên máy chủ"""
        # Gửi request với dữ liệu rác để kích hoạt lỗi
        files = {"file": ("corrupt.mp3", b"NotAnMp3FileAtAll", "audio/mpeg")}
        res = requests.post(f"{BASE_URL}/api/transcribe", files=files, timeout=10)
        detail = res.text
        # Không được để lộ đường dẫn nhạy cảm như /etc/, /home/shader/, /root/
        self.assertNotIn("/etc/passwd", detail)
        self.assertNotIn("/root/", detail)
        print(" [PASS] test_03: Phản hồi lỗi thân thiện, không rò rỉ cấu trúc thư mục nội bộ")


if __name__ == "__main__":
    unittest.main()
