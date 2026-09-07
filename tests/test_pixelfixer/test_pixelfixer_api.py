#!/usr/bin/env python3
"""
Integration tests for worker_pixelfixer API.
Tests endpoints:
- GET /health
- POST /detect
- POST /fix
"""

import os
import unittest
import requests
from PIL import Image
import io

DEFAULT_DIRECT_URL = "http://localhost:8004"
DEFAULT_GATEWAY_URL = "http://localhost:8000/api/pixel"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATASET_DIR = os.path.join(SCRIPT_DIR, "dataset")


def resolve_api_endpoints():
    url = os.getenv("WORKER_PIXELFIXER_URL")
    if url:
        return url, f"{url}/detect", f"{url}/fix"
    # Check if direct port 8004 is reachable
    try:
        if requests.get(f"{DEFAULT_DIRECT_URL}/health", timeout=1).status_code == 200:
            return DEFAULT_DIRECT_URL, f"{DEFAULT_DIRECT_URL}/detect", f"{DEFAULT_DIRECT_URL}/fix"
    except Exception:
        pass
    # Fallback to gateway
    return DEFAULT_GATEWAY_URL, f"{DEFAULT_GATEWAY_URL}/detect", f"{DEFAULT_GATEWAY_URL}/fix"



class TestPixelFixerAPI(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.base_url, cls.detect_url, cls.fix_url = resolve_api_endpoints()
        # Test if health endpoint or detect endpoint responds
        try:
            if "8004" in cls.base_url:
                res = requests.get(f"{cls.base_url}/health", timeout=3)
                if res.status_code != 200:
                    raise Exception(f"Server returned status {res.status_code}")
            else:
                # Gateway test
                res = requests.get(f"http://localhost:8000/health", timeout=3)
                if res.status_code != 200:
                    raise Exception(f"Gateway returned status {res.status_code}")
        except Exception as e:
            raise unittest.SkipTest(f"Pixelfixer service not reachable at {cls.base_url}: {e}")

    def test_01_health(self):
        """Test /health endpoint"""
        if "8004" in self.base_url:
            res = requests.get(f"{self.base_url}/health", timeout=3)
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertEqual(data.get("status"), "ok")
            print("  [PASS] test_01_health")
        else:
            print(f"  [SKIP] test_01_health (Testing via Gateway {self.base_url})")

    def test_02_detect_validation_missing_file(self):
        """Test detect returns 400 when missing file payload"""
        res = requests.post(self.detect_url)
        self.assertEqual(res.status_code, 400)
        print("  [PASS] test_02_detect_validation_missing_file")

    def test_03_detect_upscaled_sprite(self):
        """Test detect on a 3x scaled sprite"""
        sample_path = os.path.join(DATASET_DIR, "distorted", "sprite_01_nn3x.png")
        if not os.path.exists(sample_path):
            self.skipTest("Sample sprite_01_nn3x.png not found")

        with open(sample_path, "rb") as f:
            files = {"file": ("sprite_01_nn3x.png", f, "image/png")}
            res = requests.post(self.detect_url, files=files, params={"mode": "fast"}, timeout=10)

        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data.get("success"))
        self.assertGreater(data.get("confidence", 0), 0)
        print(f"  [PASS] test_03_detect_upscaled_sprite: detected grid {data.get('cols')}x{data.get('rows')}, conf={data.get('confidence')}%")

    def test_04_fix_reconstruct_image(self):
        """Test fix endpoint returns a valid reconstructed PNG"""
        sample_path = os.path.join(DATASET_DIR, "distorted", "sprite_01_nn3x.png")
        if not os.path.exists(sample_path):
            self.skipTest("Sample sprite_01_nn3x.png not found")

        with open(sample_path, "rb") as f:
            files = {"file": ("sprite_01_nn3x.png", f, "image/png")}
            params = {"mode": "fast"}
            res = requests.post(self.fix_url, files=files, params=params, timeout=15)

        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.headers.get("content-type"), "image/png")
        
        # Verify returned bytes is a valid image
        img = Image.open(io.BytesIO(res.content))
        self.assertGreater(img.width, 0)
        self.assertGreater(img.height, 0)
        print(f"  [PASS] test_04_fix_reconstruct_image: reconstructed dimensions={img.width}x{img.height}")



if __name__ == "__main__":
    unittest.main()
