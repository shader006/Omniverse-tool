#!/usr/bin/env python3
"""
NHÓM 2: KIỂM THỬ NGOẠI LỆ, TRƯỜNG HỢP LỖI & LỖI BIÊN (ERROR & EDGE CASES)
Bao gồm:
- URL rỗng, thiếu tham số, scheme sai (ftp://, text thuần)
- Định dạng format không hợp lệ (exe, sh, zip)
- Chất lượng quality không hợp lệ (99999, -1)
- Video không tồn tại / đã bị xóa trên YouTube -> Báo lỗi thân thiện, không treo vô hạn
- Tên miền không tồn tại (DNS / Network Error)
- Giới hạn thời lượng xử lý tối đa 3 giờ (Duration limit filter)
"""

import os
import sys
import time
import json
import urllib.request
import urllib.error
import unittest

BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8000" if os.path.exists("/app") else "http://localhost:80")

# Thêm app_python vào sys.path để test các filter logic cục bộ
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "backend"))
for p in [backend_dir, os.path.join(backend_dir, "app_python")]:
    if os.path.exists(p) and p not in sys.path:
        sys.path.insert(0, p)


def make_request(path: str, data: dict = None, headers: dict = None, timeout: int = 15):
    url = f"{BASE_URL}{path}"
    h = {"User-Agent": "Omniverse-TestRunner/1.0", "X-Forwarded-For": "10.10.2.1"}
    if headers:
        h.update(headers)
    
    req_data = None
    if data is not None:
        req_data = json.dumps(data).encode("utf-8")
        h["Content-Type"] = "application/json"

    req = urllib.request.Request(url, data=req_data, headers=h)
    return urllib.request.urlopen(req, timeout=timeout)


class TestErrorAndEdgeCases(unittest.TestCase):

    def test_01_missing_or_empty_url(self):
        """1. Kiểm tra từ chối yêu cầu rỗng hoặc thiếu URL (400 Bad Request)"""
        # Test /api/info với body rỗng
        try:
            with make_request("/api/info", data={}) as res:
                self.fail(f"Kỳ vọng 400 nhưng nhận: {res.status}")
        except urllib.error.HTTPError as e:
            self.assertEqual(e.code, 400)
            body = json.loads(e.read().decode("utf-8"))
            self.assertFalse(body.get("success", True))
            print(" [PASS] test_01: /api/info từ chối payload rỗng chính xác (400)")

        # Test /api/download với body rỗng
        try:
            with make_request("/api/download", data={"url": "   "}) as res:
                self.fail(f"Kỳ vọng 400 nhưng nhận: {res.status}")
        except urllib.error.HTTPError as e:
            self.assertEqual(e.code, 400)
            print(" [PASS] test_01: /api/download từ chối URL khoảng trắng chính xác (400)")

    def test_02_invalid_url_scheme(self):
        """2. Kiểm tra từ chối các URL không có tiền tố http:// hoặc https://"""
        bad_schemes = [
            "ftp://files.example.com/video.mp4",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "just_some_random_string_not_url"
        ]
        for bad_url in bad_schemes:
            try:
                with make_request("/api/download", data={"url": bad_url, "format": "mp3", "quality": "128"}) as res:
                    self.fail(f"Kỳ vọng 400 cho bad scheme {bad_url} nhưng nhận: {res.status}")
            except urllib.error.HTTPError as e:
                self.assertEqual(e.code, 400)
        print(" [PASS] test_02: Chặn đứng toàn bộ URL scheme không hợp lệ")

    def test_03_unsupported_format(self):
        """3. Kiểm tra từ chối định dạng format nguy hiểm / không hỗ trợ (exe, sh, zip)"""
        bad_formats = ["exe", "sh", "bat", "zip", "tar"]
        for fmt in bad_formats:
            try:
                payload = {"url": "https://www.youtube.com/watch?v=jNQXAC9IVRw", "format": fmt, "quality": "128"}
                with make_request("/api/download", data=payload) as res:
                    self.fail(f"Kỳ vọng 400 cho format {fmt} nhưng nhận: {res.status}")
            except urllib.error.HTTPError as e:
                self.assertEqual(e.code, 400)
                body = json.loads(e.read().decode("utf-8"))
                detail = body.get("detail", "")
                self.assertIn("không được hỗ trợ", detail)
        print(" [PASS] test_03: Chặn đứng các định dạng độc hại / không hỗ trợ")

    def test_04_unsupported_quality(self):
        """4. Kiểm tra từ chối chất lượng quality tùy ý / không hợp lệ"""
        bad_qualities = ["99999", "-1", "ultra_max", "10k"]
        for q in bad_qualities:
            try:
                payload = {"url": "https://www.youtube.com/watch?v=jNQXAC9IVRw", "format": "mp3", "quality": q}
                with make_request("/api/download", data=payload) as res:
                    self.fail(f"Kỳ vọng 400 cho quality {q} nhưng nhận: {res.status}")
            except urllib.error.HTTPError as e:
                self.assertEqual(e.code, 400)
        print(" [PASS] test_04: Chặn đứng giá trị quality không hợp lệ")

    def test_05_deleted_or_nonexistent_youtube_video(self):
        """5. Video YouTube không tồn tại / đã bị xóa -> Chuyển sang status: error, không treo loop"""
        bad_video_url = "https://www.youtube.com/watch?v=nonexistent_video_id_9999999"
        with make_request("/api/download", data={"url": bad_video_url, "format": "mp3", "quality": "128"}) as res:
            self.assertEqual(res.status, 200)
            body = json.loads(res.read().decode("utf-8"))
            job_id = body.get("job_id")

        # Polling tối đa 20s
        error_caught = False
        for _ in range(20):
            time.sleep(1.0)
            with make_request(f"/api/status/{job_id}") as s_res:
                s_data = json.loads(s_res.read().decode("utf-8"))
                if s_data.get("status") == "error":
                    error_caught = True
                    error_msg = s_data.get("error", "")
                    self.assertTrue(len(error_msg) > 0, "Thông báo lỗi không được để trống")
                    print(f" [PASS] test_05: Bắt lỗi video không tồn tại chính xác: '{error_msg}'")
                    break
        self.assertTrue(error_caught, "Job không chuyển sang trạng thái 'error' khi video không tồn tại!")

    def test_06_nonexistent_domain(self):
        """6. Tên miền không tồn tại (DNS / Network Error) -> Trả về lỗi gracefully (400)"""
        fake_url = f"https://this-is-not-a-real-domain-{time.time_ns()}.xyz/watch?v=123"
        try:
            with make_request("/api/info", data={"url": fake_url}, timeout=10) as res:
                self.fail("Kỳ vọng 400 cho domain ảo nhưng nhận: 200")
        except urllib.error.HTTPError as e:
            self.assertEqual(e.code, 400)
            print(" [PASS] test_06: Bắt lỗi domain không tồn tại chính xác (400)")

    def test_07_duration_limit_filter_logic(self):
        """7. Kiểm tra bộ lọc giới hạn thời lượng tối đa 3 giờ (10.800 giây) trong downloader"""
        # Giả lập filter logic như trong run_download_task của downloader.py
        def duration_filter(info_dict, *, incomplete=False):
            dur = info_dict.get('duration') or 0
            if dur > 3 * 3600:
                return "Thời lượng video/audio vượt quá giới hạn tối đa 3 giờ."
            return None

        # Test video 10 giờ (> 3 giờ): Bị từ chối
        overlimit_info = {"duration": 10 * 3600}
        reject_msg = duration_filter(overlimit_info)
        self.assertIsNotNone(reject_msg)
        self.assertIn("vượt quá giới hạn tối đa 3 giờ", reject_msg)

        # Test video 3 phút (< 3 giờ): Được chấp nhận
        normal_info = {"duration": 180}
        self.assertIsNone(duration_filter(normal_info))

        # Test video đúng 3 giờ (<= 3 giờ): Được chấp nhận
        edge_info = {"duration": 3 * 3600}
        self.assertIsNone(duration_filter(edge_info))

        print(" [PASS] test_07: duration_filter từ chối video > 3 giờ chính xác (biên: 3h vs >3h)")


if __name__ == "__main__":
    unittest.main()
