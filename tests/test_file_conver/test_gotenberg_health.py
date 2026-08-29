#!/usr/bin/env python3
"""
GOTENBERG HEALTH & CONNECTIVITY TEST
Kiểm tra tính sẵn sàng và kết nối giữa Go Backend Server và Gotenberg v8 Engine.
"""

import os
import json
import urllib.request
import unittest

BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8000" if os.path.exists("/app") else "http://localhost:80")


class TestGotenbergHealth(unittest.TestCase):

    def test_01_gateway_health_and_gotenberg_status(self):
        """Kiểm tra Endpoint /health trả về gotenberg_status == True"""
        req = urllib.request.Request(f"{BASE_URL}/health")
        with urllib.request.urlopen(req, timeout=5) as res:
            self.assertEqual(res.status, 200)
            data = json.loads(res.read().decode("utf-8"))
            self.assertEqual(data.get("status"), "healthy")
            self.assertTrue(data.get("gotenberg_status"), "Gotenberg engine chưa sẵn sàng hoặc không kết nối được!")
            print(f" [PASS] test_01_gateway_health: Server healthy, Gotenberg connected at {data.get('gotenberg_url')}")


if __name__ == "__main__":
    unittest.main()
