#!/usr/bin/env python3
"""
PINGORA PROXY INTEGRATION TEST
Kiểm tra kết nối và tính tương thích của Pingora Reverse Proxy với FastAPI Backend
"""

import os
import urllib.request
import json
import unittest

PINGORA_BASE_URL = os.getenv("PINGORA_URL", "http://pingora:80" if os.path.exists("/app") else "http://localhost:80")


class TestPingoraProxy(unittest.TestCase):

    def test_01_pingora_http_root(self):
        """Kiểm tra Pingora chuyển tiếp trang chủ (GET /) trên Port 80"""
        req = urllib.request.Request(f"{PINGORA_BASE_URL}/")
        with urllib.request.urlopen(req, timeout=5) as res:
            self.assertEqual(res.status, 200)
            headers = dict(res.headers)
            
            # Xác thực header do Cloudflare Pingora gán
            server_header = headers.get("Server", "")
            proxy_header = headers.get("X-Proxy-By", "")
            print(f"\n[+] Pingora Server Header: '{server_header}'")
            print(f"[+] Pingora Proxy Header:  '{proxy_header}'")
            self.assertIn("Pingora", server_header)
            self.assertIn("Pingora", proxy_header)

    def test_02_pingora_api_info_forwarding(self):
        """Kiểm tra Pingora chuyển tiếp API POST /api/info"""
        url = "https://www.youtube.com/watch?v=jNQXAC9IVRw"
        payload = json.dumps({"url": url}).encode("utf-8")
        req = urllib.request.Request(
            f"{PINGORA_BASE_URL}/api/info",
            data=payload,
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=10) as res:
            self.assertEqual(res.status, 200)
            data = json.loads(res.read().decode("utf-8"))
            self.assertTrue(data.get("success"))
            self.assertIn("Me at the zoo", data["data"]["title"])
            print(f"[+] Pingora API Info Forwarding: Title = '{data['data']['title']}'")

    def test_03_pingora_api_download_and_cache(self):
        """Kiểm tra Pingora chuyển tiếp API POST /api/download"""
        payload = json.dumps({
            "url": "https://www.youtube.com/watch?v=jNQXAC9IVRw",
            "format": "mp3",
            "quality": "320"
        }).encode("utf-8")
        req = urllib.request.Request(
            f"{PINGORA_BASE_URL}/api/download",
            data=payload,
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=25) as res:
            self.assertEqual(res.status, 200)
            data = json.loads(res.read().decode("utf-8"))
            self.assertTrue(data.get("success"))
            self.assertIn("job_id", data)
            print(f"[+] Pingora API Download Job: ID = '{data['job_id']}', Cached = {data.get('cached')}")


if __name__ == "__main__":
    unittest.main()
