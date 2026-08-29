#!/usr/bin/env python3
import os
import sys
import unittest

# Thêm backend directory vào sys.path để import app.url_conver
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "backend"))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

def main():
    print("=" * 65)
    print("   BẮT ĐẦU CHẠY BỘ TEST: URL TO MP3 / MP4 ENGINE")
    print("=" * 65)

    test_dir = os.path.dirname(os.path.abspath(__file__))
    loader = unittest.TestLoader()
    suite = loader.discover(start_dir=test_dir, pattern="test_*.py")

    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)

    print("=" * 65)
    if result.wasSuccessful():
        print(f"🎉 TẤT CẢ {result.testsRun} BÀI TEST URL ĐỀU THÀNH CÔNG (PASSED)!")
    else:
        print(f"❌ CÓ {len(result.failures)} BÀI TEST THẤT BẠI, {len(result.errors)} LỖI!")
    print("=" * 65)

    sys.exit(0 if result.wasSuccessful() else 1)

if __name__ == "__main__":
    main()
