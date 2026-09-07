#!/usr/bin/env python3
"""
BENCHMARK SUITE FOR WORKER_PIXELFIXER (RUST ENGINE & HTTP SERVICE)
Measures:
1. Detection Accuracy (Exact size & within 1px match against ground truth)
2. Detection & Reconstruction Latency (p50, p95, avg ms)
3. Performance breakdown across 5 distortion categories
4. Real-world benchmark on high-res samples
"""

import os
import sys
import json
import time
import argparse
from typing import Dict, List, Any
import requests

DEFAULT_DIRECT_URL = "http://localhost:8004"
DEFAULT_GATEWAY_URL = "http://localhost:8000/api/pixel"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATASET_DIR = os.path.join(SCRIPT_DIR, "dataset")
MANIFEST_FILE = os.path.join(DATASET_DIR, "manifest.json")
REAL_SAMPLES_DIR = os.path.join(DATASET_DIR, "real_samples")


def resolve_api_endpoints(custom_url: str = None):
    if custom_url:
        return custom_url, f"{custom_url}/detect", f"{custom_url}/fix"
    env_url = os.getenv("WORKER_PIXELFIXER_URL")
    if env_url:
        return env_url, f"{env_url}/detect", f"{env_url}/fix"
    try:
        if requests.get(f"{DEFAULT_DIRECT_URL}/health", timeout=1).status_code == 200:
            return DEFAULT_DIRECT_URL, f"{DEFAULT_DIRECT_URL}/detect", f"{DEFAULT_DIRECT_URL}/fix"
    except Exception:
        pass
    return DEFAULT_GATEWAY_URL, f"{DEFAULT_GATEWAY_URL}/detect", f"{DEFAULT_GATEWAY_URL}/fix"



def run_benchmark(limit: int = None, mode: str = "fast", url: str = None):
    base_url, detect_url, fix_url = resolve_api_endpoints(url)
    print("=" * 80)
    print(f"PIXELFIXER BENCHMARK - Target: {base_url} (Mode: {mode})")
    print("=" * 80)

    # Health check
    is_live = False
    try:
        if "8004" in base_url:
            is_live = (requests.get(f"{base_url}/health", timeout=3).status_code == 200)
        else:
            is_live = (requests.get("http://localhost:8000/health", timeout=3).status_code == 200)
    except Exception:
        is_live = False

    if not is_live:
        print(f"[-] ERROR: Service at {base_url} is NOT reachable.")
        print(f"    Please start the service (e.g. ./start.sh or docker compose up -d worker-pixelfixer)")
        print(f"    Or specify target URL: python benchmark_pixelfixer.py --url http://<host>:<port>")
        sys.exit(1)


    with open(MANIFEST_FILE, "r") as f:
        manifest = json.load(f)

    if limit and limit > 0:
        manifest = manifest[:limit]

    print(f"Loaded {len(manifest)} test cases from {MANIFEST_FILE}...\n")

    category_stats: Dict[str, Dict[str, Any]] = {}
    all_latencies = []

    for idx, item in enumerate(manifest, 1):
        cat = item["category"]
        if cat not in category_stats:
            category_stats[cat] = {
                "total": 0,
                "exact": 0,
                "within1": 0,
                "latencies": [],
            }

        file_path = os.path.join(SCRIPT_DIR, "..", "..", item["file"])
        if not os.path.exists(file_path):
            file_path = item["file"]

        if not os.path.exists(file_path):
            continue

        target_w, target_h = item["orig_size"]

        t0 = time.perf_counter()
        try:
            with open(file_path, "rb") as f:
                files = {"file": (os.path.basename(file_path), f, "image/png")}
                res = requests.post(
                    detect_url,
                    files=files,
                    params={"mode": mode},
                    timeout=10,
                )
            dur_ms = (time.perf_counter() - t0) * 1000.0
        except Exception as e:
            print(f"[{idx:03d}] ERROR testing {file_path}: {e}")
            continue

        if res.status_code != 200:
            print(f"[{idx:03d}] FAIL {file_path}: HTTP {res.status_code}")
            continue

        data = res.json()
        det_cols = data.get("cols", 0)
        det_rows = data.get("rows", 0)

        is_exact = (det_cols == target_w and det_rows == target_h)
        is_within1 = (abs(det_cols - target_w) <= 1 and abs(det_rows - target_h) <= 1)

        category_stats[cat]["total"] += 1
        if is_exact:
            category_stats[cat]["exact"] += 1
        if is_within1:
            category_stats[cat]["within1"] += 1
        category_stats[cat]["latencies"].append(dur_ms)
        all_latencies.append(dur_ms)

        status_sym = "EXACT" if is_exact else ("~1PX" if is_within1 else "MISS")
        print(f"[{idx:03d}/{len(manifest):03d}] {cat:<16} | GT: {target_w:>3}x{target_h:<3} | Det: {det_cols:>3}x{det_rows:<3} | {status_sym:<5} | {dur_ms:>6.2f}ms")

    # Summary table
    print("\n" + "=" * 80)
    print(f"{'CATEGORY':<20} | {'SAMPLES':<8} | {'EXACT %':<9} | {'±1PX %':<8} | {'AVG (ms)':<9} | {'P95 (ms)':<9}")
    print("-" * 80)

    total_samples = 0
    total_exact = 0
    total_within1 = 0

    for cat, stats in sorted(category_stats.items()):
        cnt = stats["total"]
        if cnt == 0:
            continue
        exact_pct = (stats["exact"] / cnt) * 100.0
        within1_pct = (stats["within1"] / cnt) * 100.0
        avg_ms = sum(stats["latencies"]) / cnt
        sorted_lats = sorted(stats["latencies"])
        p95_ms = sorted_lats[int(cnt * 0.95)] if cnt > 1 else sorted_lats[0]

        total_samples += cnt
        total_exact += stats["exact"]
        total_within1 += stats["within1"]

        print(f"{cat:<20} | {cnt:<8} | {exact_pct:>7.1f}% | {within1_pct:>6.1f}% | {avg_ms:>8.2f} | {p95_ms:>8.2f}")

    print("-" * 80)
    overall_exact_pct = (total_exact / total_samples) * 100.0 if total_samples else 0
    overall_within1_pct = (total_within1 / total_samples) * 100.0 if total_samples else 0
    overall_avg_ms = sum(all_latencies) / len(all_latencies) if all_latencies else 0
    all_latencies.sort()
    overall_p95_ms = all_latencies[int(len(all_latencies) * 0.95)] if all_latencies else 0

    print(f"{'OVERALL':<20} | {total_samples:<8} | {overall_exact_pct:>7.1f}% | {overall_within1_pct:>6.1f}% | {overall_avg_ms:>8.2f} | {overall_p95_ms:>8.2f}")
    print("=" * 80)

    # Real samples benchmark
    if os.path.exists(REAL_SAMPLES_DIR):
        print("\n" + "=" * 80)
        print("REAL-WORLD HIGH-RES SAMPLES BENCHMARK (/fix Reconstruction)")
        print("=" * 80)
        for fname in sorted(os.listdir(REAL_SAMPLES_DIR)):
            if not fname.endswith(".png"):
                continue
            path = os.path.join(REAL_SAMPLES_DIR, fname)
            size_mb = os.path.getsize(path) / (1024 * 1024)

            t0 = time.perf_counter()
            with open(path, "rb") as f:
                files = {"file": (fname, f, "image/png")}
                res = requests.post(fix_url, files=files, params={"mode": "fast"}, timeout=30)
            dur_ms = (time.perf_counter() - t0) * 1000.0

            if res.status_code == 200:
                out_size_kb = len(res.content) / 1024
                print(f"{fname:<24} ({size_mb:4.2f} MB) -> OK ({out_size_kb:6.1f} KB) in {dur_ms:7.2f}ms")
            else:
                print(f"{fname:<24} ({size_mb:4.2f} MB) -> HTTP {res.status_code} in {dur_ms:7.2f}ms")
        print("=" * 80)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Worker Pixelfixer Benchmark")
    parser.add_argument("--url", default=None, help="Base URL of worker_pixelfixer or gateway (e.g. http://localhost:8000/api/pixel)")
    parser.add_argument("--mode", default="fast", choices=["fast", "full"], help="Detection mode")
    parser.add_argument("--limit", type=int, default=None, help="Limit number of test samples")
    args = parser.parse_args()

    run_benchmark(limit=args.limit, mode=args.mode, url=args.url)
