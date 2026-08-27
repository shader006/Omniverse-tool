#!/usr/bin/env python3
import os
import sys
import unittest

def main():
    print("=" * 60)
    print("   BẮT ĐẦU CHẠY BỘ KIỂM THỬ (TEST SUITE) - MEDIAFLOW")
    print("=" * 60)

    test_dir = os.path.dirname(os.path.abspath(__file__))
    loader = unittest.TestLoader()
    suite = loader.discover(start_dir=test_dir, pattern="test_*.py")

    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)

    print("=" * 60)
    if result.wasSuccessful():
        print("🎉 TẤT CẢ CÁC BÀI TEST ĐỀU THÀNH CÔNG (PASSED)!")
    else:
        print(f"❌ CÓ {len(result.failures)} BÀI TEST THẤT BẠI, {len(result.errors)} LỖI!")
    print("=" * 60)

    sys.exit(0 if result.wasSuccessful() else 1)

if __name__ == "__main__":
    main()
