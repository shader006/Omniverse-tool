#!/usr/bin/env python3
"""
NHÓM 1: KIỂM THỬ CÁC CHỨC NĂNG CỐT LÕI (CORE FUNCTIONAL & REAL-WORLD URLS)
Bao gồm:
- Trích xuất thông tin video (Standard URL, Short URL youtu.be, Shorts, Tracking query, Playlist)
- Tải & chuyển đổi MP3 (128 kbps, 320 kbps)
- Tải & ghép luồng MP4 Video (360p, 720p)
- Chấp nhận các định dạng mở rộng (m4a, wav, flac, webm)
- Kiểm tra tính hợp lệ của file thành phẩm (MIME Type, File size > 1KB)
"""

import os
import sys
import time
import json
import urllib.request
import urllib.parse
import urllib.error
import unittest

BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8000" if os.path.exists("/app") else "http://localhost:80")
SAMPLE_VIDEO_URL = "https://www.youtube.com/watch?v=jNQXAC9IVRw"
SAMPLE_SHORT_URL = "https://youtu.be/jNQXAC9IVRw"
SAMPLE_SHORTS_URL = "https://www.youtube.com/shorts/jNQXAC9IVRw"


def make_request(path: str, data: dict = None, headers: dict = None, timeout: int = 20):
    url = f"{BASE_URL}{path}"
    h = {"User-Agent": "Omniverse-TestRunner/1.0", "X-Forwarded-For": "10.10.1.1"}
    if headers:
        h.update(headers)
    
    req_data = None
    if data is not None:
        req_data = json.dumps(data).encode("utf-8")
        h["Content-Type"] = "application/json"

    req = urllib.request.Request(url, data=req_data, headers=h)
    return urllib.request.urlopen(req, timeout=timeout)


def wait_for_job(job_id: str, max_wait_sec: int = 40):
    start = time.time()
    while time.time() - start < max_wait_sec:
        time.sleep(1.0)
        try:
            with make_request(f"/api/status/{job_id}", timeout=10) as res:
                s_data = json.loads(res.read().decode("utf-8"))
                status = s_data.get("status")
                if status == "completed":
                    return s_data
                elif status == "error":
                    raise RuntimeError(f"Job {job_id} failed: {s_data.get('error')}")
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(2.0)
                continue
            raise
    raise TimeoutError(f"Job {job_id} did not finish within {max_wait_sec}s")


class TestCoreFunctional(unittest.TestCase):

    def test_00_index_html(self):
        """0. Kiểm tra trang giao diện chính (GET /) trả về 200 OK"""
        with make_request("/") as res:
            self.assertEqual(res.status, 200)
            content = res.read().decode("utf-8")
            self.assertTrue("Oniverse" in content or "Omniverse" in content or "root" in content)
            print(" [PASS] test_00: Web UI trả về 200 OK")

    def test_01_extract_metadata_standard_youtube(self):
        """1. Trích xuất metadata từ URL YouTube chuẩn (watch?v=...)"""
        with make_request("/api/info", data={"url": SAMPLE_VIDEO_URL}) as res:
            self.assertEqual(res.status, 200)
            body = json.loads(res.read().decode("utf-8"))
            self.assertTrue(body.get("success"), "API info không trả về success: true")
            data = body.get("data", {})
            self.assertIn("title", data)
            self.assertIn("duration", data)
            self.assertIn("thumbnail", data)
            dur = data.get("duration")
            self.assertTrue(dur is not None and len(str(dur)) > 0)
            print(f" [PASS] test_01: Metadata chuẩn: '{data['title']}' ({dur})")

    def test_02_extract_metadata_short_url_and_tracking(self):
        """2. Trích xuất metadata từ URL rút gọn (youtu.be) kèm tham số tracking (?si=...&t=1s)"""
        tracking_url = f"{SAMPLE_SHORT_URL}?si=omniverse_test_tracking&t=1s"
        with make_request("/api/info", data={"url": tracking_url}) as res:
            self.assertEqual(res.status, 200)
            body = json.loads(res.read().decode("utf-8"))
            self.assertTrue(body.get("success"))
            self.assertIn("title", body.get("data", {}))
            print(" [PASS] test_02: Trích xuất thành công URL rút gọn kèm tracking parameters")

    def test_03_extract_metadata_shorts_url(self):
        """3. Trích xuất metadata từ định dạng YouTube Shorts (/shorts/...)"""
        with make_request("/api/info", data={"url": SAMPLE_SHORTS_URL}) as res:
            self.assertEqual(res.status, 200)
            body = json.loads(res.read().decode("utf-8"))
            self.assertTrue(body.get("success"))
            print(f" [PASS] test_03: Trích xuất thành công YouTube Shorts: '{body['data']['title']}'")

    def test_04_extract_metadata_playlist_isolation(self):
        """4. Cô lập URL Playlist: Chỉ trích xuất đúng 1 video đích, không kéo cả playlist"""
        playlist_url = f"{SAMPLE_VIDEO_URL}&list=PLbpi6ZahtOH6Blw3RGYpWkSByi_T73gbU&index=1"
        with make_request("/api/info", data={"url": playlist_url}) as res:
            self.assertEqual(res.status, 200)
            body = json.loads(res.read().decode("utf-8"))
            self.assertTrue(body.get("success"))
            data = body.get("data", {})
            self.assertIn("title", data)
            self.assertNotIn("entries", data, "Không được trả về toàn bộ entries của playlist")
            print(" [PASS] test_04: Playlist được cô lập chính xác về video đơn lẻ")

    def test_05_download_mp3_different_qualities(self):
        """5. Tải & chuyển đổi MP3 với các mức bitrate (128 kbps và 320 kbps)"""
        for quality in ["128", "320"]:
            payload = {
                "url": SAMPLE_VIDEO_URL,
                "format": "mp3",
                "quality": quality
            }
            with make_request("/api/download", data=payload) as res:
                self.assertEqual(res.status, 200)
                body = json.loads(res.read().decode("utf-8"))
                self.assertTrue(body.get("success"))
                job_id = body.get("job_id")
                self.assertIsNotNone(job_id)

            # Chờ hoàn thành
            job_info = wait_for_job(job_id)
            self.assertEqual(job_info.get("status"), "completed")
            filename = job_info.get("filename")
            self.assertTrue(filename.endswith(".mp3"), f"Filename {filename} phải có đuôi .mp3")

            # Tải file qua /api/file/{filename}
            encoded_name = urllib.parse.quote(filename)
            with make_request(f"/api/file/{encoded_name}") as file_res:
                self.assertEqual(file_res.status, 200)
                content_type = file_res.headers.get("Content-Type", "")
                self.assertIn("audio/mpeg", content_type, f"Content-Type không đúng: {content_type}")
                content = file_res.read()
                self.assertGreater(len(content), 1024, "File MP3 tải về bị rỗng hoặc quá nhỏ")
            print(f" [PASS] test_05: Tải MP3 {quality}k thành công: '{filename}' ({len(content)} bytes)")

    def test_06_download_mp4_video_muxing(self):
        """6. Tải & gộp luồng MP4 Video (Video Stream + Audio Stream) độ phân giải 360p"""
        payload = {
            "url": SAMPLE_VIDEO_URL,
            "format": "mp4",
            "quality": "360"
        }
        with make_request("/api/download", data=payload) as res:
            self.assertEqual(res.status, 200)
            body = json.loads(res.read().decode("utf-8"))
            self.assertTrue(body.get("success"))
            job_id = body.get("job_id")

        job_info = wait_for_job(job_id, max_wait_sec=50)
        self.assertEqual(job_info.get("status"), "completed")
        filename = job_info.get("filename")
        self.assertTrue(filename.endswith(".mp4"), f"Filename {filename} phải có đuôi .mp4")

        encoded_name = urllib.parse.quote(filename)
        with make_request(f"/api/file/{encoded_name}") as file_res:
            self.assertEqual(file_res.status, 200)
            content_type = file_res.headers.get("Content-Type", "")
            self.assertIn("video/mp4", content_type, f"Content-Type không đúng: {content_type}")
            content = file_res.read()
            self.assertGreater(len(content), 5000, "File MP4 tải về quá nhỏ, có thể bị lỗi muxing")
        print(f" [PASS] test_06: Tải MP4 Video thành công: '{filename}' ({len(content)} bytes)")

    def test_07_support_extended_formats(self):
        """7. Kiểm tra hệ thống chấp nhận các định dạng mở rộng (m4a, wav, flac, webm)"""
        allowed_formats = ["m4a", "wav", "flac", "webm"]
        for fmt in allowed_formats:
            payload = {
                "url": SAMPLE_VIDEO_URL,
                "format": fmt,
                "quality": "320" if fmt in ["flac", "wav"] else "best"
            }
            with make_request("/api/download", data=payload) as res:
                self.assertEqual(res.status, 200)
                body = json.loads(res.read().decode("utf-8"))
                self.assertTrue(body.get("success"), f"Hệ thống từ chối định dạng hợp lệ: {fmt}")
                self.assertIn("job_id", body)
        print(f" [PASS] test_07: Đã kiểm tra chấp nhận các định dạng mở rộng: {allowed_formats}")

    def test_08_facebook_watch_video(self):
        """8. Kiểm tra nền tảng khác ngoài YouTube: Trích xuất metadata & tải từ Facebook Watch"""
        fb_url = "https://www.facebook.com/watch/?v=10153231379946729"
        with make_request("/api/info", data={"url": fb_url}) as res:
            self.assertEqual(res.status, 200)
            body = json.loads(res.read().decode("utf-8"))
            self.assertTrue(body.get("success"))
            data = body.get("data", {})
            self.assertIn("title", data)
            self.assertEqual(data.get("platform"), "Facebook")
            print(f" [PASS] test_08: Trích xuất Facebook thành công: '{data['title']}' (Platform: {data.get('platform')})")

        # Kiểm tra tạo job tải Facebook
        payload = {"url": fb_url, "format": "mp3", "quality": "128"}
        with make_request("/api/download", data=payload) as res:
            self.assertEqual(res.status, 200)
            b = json.loads(res.read().decode("utf-8"))
            self.assertTrue(b.get("success"))
            self.assertIn("job_id", b)
            print(f" [PASS] test_08: Tạo Job tải Facebook thành công (ID: {b.get('job_id')})")


if __name__ == "__main__":
    unittest.main()
