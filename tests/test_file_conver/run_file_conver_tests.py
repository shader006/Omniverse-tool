#!/usr/bin/env python3
import os
import sys
import unittest

def main():
    print("=" * 65)
    print("   BẮT ĐẦU CHẠY BỘ TEST: FILE CONVER (GOTENBERG PDF ENGINE)")
    print("=" * 65)

    test_dir = os.path.dirname(os.path.abspath(__file__))
    loader = unittest.TestLoader()
    suite = loader.discover(start_dir=test_dir, pattern="test_*.py")

    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)

    print("=" * 65)
    if result.wasSuccessful():
        print(f"🎉 TẤT CẢ {result.testsRun} BÀI TEST FILE CONVER ĐỀU THÀNH CÔNG (PASSED)!")
    else:
        print(f"❌ CÓ {len(result.failures)} BÀI TEST THẤT BẠI, {len(result.errors)} LỖI!")
    print("=" * 65)

    sys.exit(0 if result.wasSuccessful() else 1)

if __name__ == "__main__":
    main()
