#!/usr/bin/env python3
import os
import sys
import unittest
import argparse

# Thêm backend directory vào sys.path
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend"))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

def main():
    parser = argparse.ArgumentParser(description="Chạy bộ kiểm thử (Test Suite) của MediaFlow")
    parser.add_argument("--url", action="store_true", help="Chỉ chạy các bài test liên quan đến URL to MP3/MP4")
    parser.add_argument("--file-conver", action="store_true", help="Chỉ chạy các bài test liên quan đến File Conver (Gotenberg)")
    parser.add_argument("--transcribe", action="store_true", help="Chỉ chạy các bài test liên quan đến Extract Text (whisper.cpp)")
    parser.add_argument("--autoscaler", action="store_true", help="Chỉ chạy các bài test liên quan đến Docker Swarm Autoscaler")
    parser.add_argument("--benchmark-limits", action="store_true", help="Chạy benchmark đo lường giới hạn thời lượng xử lý audio/video")
    parser.add_argument("--benchmark-model", action="store_true", help="Chạy benchmark so sánh hiệu năng giữa ggml-base.bin và ggml-small.bin")
    args = parser.parse_args()

    tests_dir = os.path.dirname(os.path.abspath(__file__))
    loader = unittest.TestLoader()

    if args.benchmark_limits:
        import subprocess
        bench_script = os.path.join(tests_dir, "benchmark_media_limits.py")
        sys.exit(subprocess.call([sys.executable, bench_script]))

    if args.benchmark_model:
        import subprocess
        bench_script = os.path.join(tests_dir, "benchmark_base_vs_small.py")
        sys.exit(subprocess.call([sys.executable, bench_script]))

    if args.url:
        target_dir = os.path.join(tests_dir, "test_url")
        print("=" * 65)
        print("   BẮT ĐẦU CHẠY BỘ TEST: URL TO MP3 / MP4")
        print("=" * 65)
        suite = loader.discover(start_dir=target_dir, pattern="test_*.py")
    elif args.file_conver:
        target_dir = os.path.join(tests_dir, "test_file_conver")
        print("=" * 65)
        print("   BẮT ĐẦU CHẠY BỘ TEST: FILE CONVER (GOTENBERG)")
        print("=" * 65)
        suite = loader.discover(start_dir=target_dir, pattern="test_*.py")
    elif args.transcribe:
        target_dir = os.path.join(tests_dir, "test_transcribe")
        print("=" * 65)
        print("   BẮT ĐẦU CHẠY BỘ TEST: EXTRACT TEXT (WHISPER.CPP CPU)")
        print("=" * 65)
        suite = loader.discover(start_dir=target_dir, pattern="test_*.py")
    elif args.autoscaler:
        target_dir = os.path.join(tests_dir, "autoscaler")
        print("=" * 65)
        print("   BẮT ĐẦU CHẠY BỘ TEST: DOCKER SWARM AUTOSCALER")
        print("=" * 65)
        suite = loader.discover(start_dir=target_dir, pattern="test_*.py")
    else:
        print("=" * 65)
        print("   BẮT ĐẦU CHẠY TOÀN BỘ BỘ KIỂM THỬ (URL + FILE CONVER + TRANSCRIBE + AUTOSCALER)")
        print("=" * 65)
        suite = loader.discover(start_dir=tests_dir, pattern="test_*.py")

    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)

    print("=" * 65)
    if result.wasSuccessful():
        print(f"🎉 TẤT CẢ {result.testsRun} BÀI TEST ĐỀU THÀNH CÔNG (PASSED)!")
    else:
        print(f"❌ CÓ {len(result.failures)} BÀI TEST THẤT BẠI, {len(result.errors)} LỖI!")
    print("=" * 65)

    sys.exit(0 if result.wasSuccessful() else 1)

if __name__ == "__main__":
    main()
