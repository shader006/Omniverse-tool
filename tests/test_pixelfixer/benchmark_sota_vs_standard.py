#!/usr/bin/env python3
"""
Benchmark comparison between:
1. Standard Two-Stage Pack (Uniform)
2. Elastic Cuts Reconstruct (Elastic)
3. New SOTA Flow: OKLab + Tri-Channel Saliency (Rareness, Edge, Variance) + Weighted Wu + Confidence/Protected Check + Local Refinement
"""

import os
import sys
import time
import subprocess
import json
from PIL import Image

GATEWAY_URL = "http://localhost:8000/api/pixel/fix"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REAL_SAMPLES_DIR = os.path.join(SCRIPT_DIR, "dataset", "real_samples")
DISTORTED_DIR = os.path.join(SCRIPT_DIR, "dataset", "distorted")

def run_fix_curl(filepath: str, mode_param: str):
    out_tmp = f"/tmp/bench_{os.path.basename(filepath)}"
    header_tmp = f"/tmp/bench_hdr_{os.path.basename(filepath)}.txt"

    if mode_param == "uniform":
        url = f"{GATEWAY_URL}?mode=fast&elastic=false"
    elif mode_param == "uniform_sota":
        url = f"{GATEWAY_URL}?mode=advanced&elastic=false"
    elif mode_param == "elastic":
        url = f"{GATEWAY_URL}?mode=fast&elastic=true"
    elif mode_param == "elastic_sota":
        url = f"{GATEWAY_URL}?mode=advanced&elastic=true"
    else:
        url = f"{GATEWAY_URL}?mode={mode_param}"

    cmd = [
        "curl", "-s",
        "-X", "POST",
        "-F", f"file=@{filepath}",
        "-D", header_tmp,
        url,
        "-o", out_tmp,
        "-w", "%{http_code}:%{time_total}",
    ]

    res = subprocess.run(cmd, capture_output=True, text=True)
    parts = res.stdout.strip().split(":")
    status = int(parts[0]) if len(parts) > 0 and parts[0].isdigit() else 0
    time_total_s = float(parts[1]) if len(parts) > 1 else 0.0
    lat_ms = time_total_s * 1000.0

    headers = {}
    if os.path.exists(header_tmp):
        with open(header_tmp, "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                if ":" in line:
                    k, v = line.split(":", 1)
                    headers[k.strip().lower()] = v.strip()

    out_kb = 0.0
    n_colors = 0
    if status == 200 and os.path.exists(out_tmp):
        out_kb = os.path.getsize(out_tmp) / 1024.0
        try:
            with Image.open(out_tmp) as img:
                n_colors = len(set(img.getdata()))
        except Exception:
            pass

    return status, lat_ms, headers, out_kb, n_colors

def main():
    print("=" * 115)
    print("BENCHMARK THỰC TẾ 4 CHẾ ĐỘ TRÊN ẢNH NẶNG:")
    print("1. Uniform | 2. Uniform + SOTA | 3. Elastic | 4. Elastic + SOTA")
    print("=" * 115)

    test_files = [
        "dragon.png",
        "frog.png",
        "koi-pond.png",
        "lighthouse.png",
        "mj_narrowboat_dusk.png",
        "mj_telescope_aurora.png",
    ]

    print(f"{'FILE':<24} | {'CHẾ ĐỘ':<20} | {'GRID':<10} | {'SỐ MÀU':<7} | {'KÍCH THƯỚC':<11} | {'ĐỘ TRỄ (ms)'}")
    print("-" * 115)

    modes = [
        ("Uniform", "uniform"),
        ("Uniform + SOTA", "uniform_sota"),
        ("Elastic", "elastic"),
        ("Elastic + SOTA", "elastic_sota"),
    ]

    for fname in test_files:
        path = os.path.join(REAL_SAMPLES_DIR, fname)
        if not os.path.exists(path):
            continue
        size_mb = os.path.getsize(path) / (1024.0 * 1024.0)

        for i, (label, mode_param) in enumerate(modes):
            status, lat_ms, headers, out_kb, n_colors = run_fix_curl(path, mode_param)
            grid_cols = headers.get("x-grid-cols", "?")
            grid_rows = headers.get("x-grid-rows", "?")
            grid_str = f"{grid_cols}x{grid_rows}"
            file_col = f"{fname} ({size_mb:.2f}MB)" if i == 0 else ""
            status_str = f"{lat_ms:6.1f} ms" if status == 200 else f"FAIL ({status})"

            print(f"{file_col:<24} | {label:<18} | {grid_str:<10} | {n_colors:<7} | {out_kb:6.1f} KB   | {status_str}")
        print("-" * 105)

    print("=" * 105)

if __name__ == "__main__":
    main()
