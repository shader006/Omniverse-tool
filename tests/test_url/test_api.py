#!/usr/bin/env python3
"""
GOLANG API GATEWAY ENDPOINTS TEST
Kiểm tra toàn bộ các Endpoints HTTP của Golang Server (/health, /api/info, /api/download, /api/status, /api/file)
"""

import os
import sys
import time
import json
import urllib.request
import urllib.error
import unittest

BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8000" if os.path.exists("/app") else "http://localhost:80")


class TestAPIEndpoints(unittest.TestCase):

    def test_01_index_html(self):
        """Kiểm tra trang giao diện chính (GET /)"""
        req = urllib.request.Request(f"{BASE_URL}/")
        with urllib.request.urlopen(req, timeout=5) as res:
            self.assertEqual(res.status, 200)
            content = res.read().decode("utf-8")
            self.assertIn("MediaFlow", content)
            print(" [PASS] test_01_index_html: Web UI trả về 200 OK")

    def test_02_api_info(self):
        """Kiểm tra Endpoint lấy thông tin video (POST /api/info)"""
        payload = json.dumps({"url": "https://www.youtube.com/watch?v=jNQXAC9IVRw"}).encode("utf-8")
        req = urllib.request.Request(
            f"{BASE_URL}/api/info",
            data=payload,
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=15) as res:
            self.assertEqual(res.status, 200)
            data = json.loads(res.read().decode("utf-8"))
            self.assertTrue(data.get("success"))
            self.assertIn("title", data.get("data", {}))
            print(f" [PASS] test_02_api_info: Lấy metadata thành công: {data['data']['title']}")

    def test_03_api_download_and_status(self):
        """Kiểm tra Endpoint tạo job và theo dõi tiến độ (POST /api/download & GET /api/status/{job_id})"""
        payload = json.dumps({
            "url": "https://www.youtube.com/watch?v=jNQXAC9IVRw",
            "format": "mp3",
            "quality": "128"
        }).encode("utf-8")
        req = urllib.request.Request(
            f"{BASE_URL}/api/download",
            data=payload,
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=10) as res:
            self.assertEqual(res.status, 200)
            data = json.loads(res.read().decode("utf-8"))
            self.assertTrue(data.get("success"))
            job_id = data.get("job_id")
            self.assertIsNotNone(job_id)
            print(f" [PASS] test_03_api_download: Tạo Job thành công ID={job_id}")

        # Polling trạng thái đến khi hoàn tất
        completed = False
        for _ in range(30):
            time.sleep(1)
            status_req = urllib.request.Request(f"{BASE_URL}/api/status/{job_id}")
            with urllib.request.urlopen(status_req, timeout=5) as s_res:
                self.assertEqual(s_res.status, 200)
                s_data = json.loads(s_res.read().decode("utf-8"))
                status = s_data.get("status")
                if status == "completed":
                    completed = True
                    filename = s_data.get("filename")
                    print(f" [PASS] test_03_api_status: Job hoàn tất 100%! Filename={filename}")
                    
                    # Kiểm tra tải file
                    encoded_filename = urllib.parse.quote(filename)
                    file_req = urllib.request.Request(f"{BASE_URL}/api/file/{encoded_filename}")
                    with urllib.request.urlopen(file_req, timeout=10) as f_res:
                        self.assertEqual(f_res.status, 200)
                        content = f_res.read()
                        self.assertGreater(len(content), 1000)
                        print(" [PASS] test_03_api_file: Tải file thành công qua /api/file/{filename}")
                    break
                elif status == "error":
                    self.fail(f"Job bị lỗi: {s_data.get('error')}")

        self.assertTrue(completed, "Quá thời gian chờ tải job!")


if __name__ == "__main__":
    unittest.main()
