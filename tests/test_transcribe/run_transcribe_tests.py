#!/usr/bin/env python3
"""
Test Runner for Media Transcription (faster-whisper CPU) Test Suite.
"""

import os
import sys
import unittest

def main():
    current_dir = os.path.dirname(os.path.abspath(__file__))
    sys.path.insert(0, os.path.abspath(os.path.join(current_dir, "../..")))

    print("=" * 65)
    print("   BẮT ĐẦU CHẠY BỘ TEST: EXTRACT TEXT (GOLANG WHISPER.CPP CPU)")
    print("=" * 65)

    loader = unittest.TestLoader()
    suite = loader.discover(start_dir=current_dir, pattern="test_*.py")

    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)

    print("\n" + "=" * 65)
    if result.wasSuccessful():
        print(f"🎉 TẤT CẢ {result.testsRun} BÀI TEST TRANSCRIBE ĐỀU THÀNH CÔNG (PASSED)!")
        print("=" * 65)
        sys.exit(0)
    else:
        print(f"❌ CÓ {len(result.failures)} BÀI TEST THẤT BẠI, {len(result.errors)} LỖI.")
        print("=" * 65)
        sys.exit(1)

if __name__ == "__main__":
    main()
