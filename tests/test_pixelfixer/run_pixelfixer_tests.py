#!/usr/bin/env python3
"""
RUNNER KIỂM THỬ TOÀN DIỆN CHO MODULE PIXELFIXER (PIXEL ART RESTORATION ENGINE)
Thực thi tuần tự 5 nhóm kiểm thử:
  1. test_01_core_functional.py             (Chức năng cốt lõi, Grid Detection & Reconstruct)
  2. test_02_error_and_edge_cases.py        (Ngoại lệ, Lỗi biên & Kích thước bất thường)
  3. test_03_protocols_and_streaming.py     (Giao thức truyền tải, MIME & Rust Headers)
  4. test_04_optimizations_and_concurrency.py (Đồng thời Rayon, FNV-1a Hash & Benchmark)
  5. test_05_security_and_validation.py     (Bảo mật: Chặn .EXE, Path Traversal & Giới hạn 50MB)
"""

import os
import sys
import unittest
import argparse

current_dir = os.path.dirname(os.path.abspath(__file__))
backend_dir = os.path.abspath(os.path.join(current_dir, "..", "..", "backend"))

for p in [backend_dir, os.path.join(backend_dir, "app_python")]:
    if os.path.exists(p) and p not in sys.path:
        sys.path.insert(0, p)

TEST_GROUPS = [
    ("test_01_core_functional.py", "NHÓM 1: CHỨC NĂNG CỐT LÕI (DETECT GRID, SOTA RECONSTRUCT, CUSTOM COLS/ROWS)"),
    ("test_02_error_and_edge_cases.py", "NHÓM 2: NGOẠI LỆ & LỖI BIÊN (MISSING FILE, CORRUPT BYTES, METHOD 405)"),
    ("test_03_protocols_and_streaming.py", "NHÓM 3: GIAO THỨC & HEADERS (MIME IMAGE/PNG, X-GRID HEADERS, OPENTELEMETRY)"),
    ("test_04_optimizations_and_concurrency.py", "NHÓM 4: TỐI ƯU HÓA & ĐỒNG THỜI (RAYON MULTI-THREAD, CACHE-HIT, BURST LOAD)"),
    ("test_05_security_and_validation.py", "NHÓM 5: AN TOÀN BẢO MẬT & VALIDATION (CHẶN .EXE, PATH TRAVERSAL, SPOOFING)")
]


def print_banner(title: str):
    print("\n" + "═" * 76)
    print(f"  📌  {title}")
    print("═" * 76)


def main():
    parser = argparse.ArgumentParser(description="Runner kiểm thử toàn diện module PixelFixer (5 nhóm)")
    parser.add_argument("--group", type=int, choices=[1, 2, 3, 4, 5], help="Chỉ chạy riêng 1 nhóm chỉ định (1..5)")
    args = parser.parse_args()

    loader = unittest.TestLoader()
    total_ran = 0
    total_failures = 0
    total_errors = 0

    groups_to_run = TEST_GROUPS
    if args.group:
        groups_to_run = [TEST_GROUPS[args.group - 1]]

    print("\n" + "█" * 76)
    print("   🚀 BẮT ĐẦU CHẠY 5 NHÓM KIỂM THỬ: PIXEL ART RESTORATION ENGINE (PIXELFIXER)")
    print("█" * 76)

    for filename, title in groups_to_run:
        print_banner(title)
        file_path = os.path.join(current_dir, filename)
        if not os.path.exists(file_path):
            print(f"⚠️ Không tìm thấy file {filename}, bỏ qua.")
            continue

        suite = loader.discover(start_dir=current_dir, pattern=filename)
        runner = unittest.TextTestRunner(verbosity=2)
        res = runner.run(suite)

        total_ran += res.testsRun
        total_failures += len(res.failures)
        total_errors += len(res.errors)

    print("\n" + "═" * 76)
    print("                      📊 TỔNG KẾT BỘ KIỂM THỬ PIXELFIXER")
    print("═" * 76)
    print(f"  • Tổng số testcase đã thực thi: {total_ran}")
    print(f"  • Số testcase thất bại:         {total_failures}")
    print(f"  • Số testcase gặp lỗi runtime:   {total_errors}")

    if total_failures == 0 and total_errors == 0:
        print(f"\n🎉 HOÀN TẤT THÀNH CÔNG! TẤT CẢ {total_ran} TESTCASE ĐỀU PASSED 100%!")
        print("═" * 76 + "\n")
        sys.exit(0)
    else:
        print(f"\n❌ CÓ {total_failures + total_errors} TESTCASE THẤT BẠI HOẶC GẶP LỖI!")
        print("═" * 76 + "\n")
        sys.exit(1)


if __name__ == "__main__":
    main()
