#!/usr/bin/env python3
"""
FULL BENCHMARK SUITE: UNIFORM VS ELASTIC RECONSTRUCTION
Evaluates on all 125 dataset samples against Ground Truth (1x Native):
1. Dimension accuracy (Exact cols x rows)
2. Pixel-level accuracy (% identical pixels against Ground Truth)
3. Color Fidelity (Mean Squared Error MSE & PSNR dB)
4. Reconstruction Latency (p50, p95, avg ms)
5. Performance breakdown by 5 distortion categories
"""

import os
import sys
import io
import json
import time
import argparse
from typing import Dict, List, Any
import requests
import numpy as np
from PIL import Image

GATEWAY_URL = "http://localhost:8000/api/pixel/fix"
DIRECT_URL = "http://localhost:8004/api/pixel/fix"

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATASET_DIR = os.path.join(SCRIPT_DIR, "dataset")
MANIFEST_FILE = os.path.join(DATASET_DIR, "manifest.json")


def compute_metrics(reconstructed_bytes: bytes, gt_path: str):
    try:
        recon_img = Image.open(io.BytesIO(reconstructed_bytes)).convert("RGBA")
        gt_img = Image.open(gt_path).convert("RGBA")
    except Exception as e:
        return {"error": str(e)}

    recon_arr = np.array(recon_img)
    gt_arr = np.array(gt_img)

    dim_match = (recon_arr.shape[:2] == gt_arr.shape[:2])
    if not dim_match:
        return {
            "dim_match": False,
            "recon_dim": (recon_arr.shape[1], recon_arr.shape[0]),
            "gt_dim": (gt_arr.shape[1], gt_arr.shape[0]),
            "pixel_match_pct": 0.0,
            "psnr": 0.0,
        }

    # Pixel exact match %
    exact_pixels = np.all(recon_arr == gt_arr, axis=-1)
    pixel_match_pct = (np.count_nonzero(exact_pixels) / exact_pixels.size) * 100.0

    # MSE on RGB
    diff = recon_arr[:, :, :3].astype(np.float64) - gt_arr[:, :, :3].astype(np.float64)
    mse = np.mean(diff ** 2)
    if mse < 1e-9:
        psnr = 100.0
    else:
        psnr = 10.0 * np.log10((255.0 ** 2) / mse)

    return {
        "dim_match": True,
        "recon_dim": (recon_arr.shape[1], recon_arr.shape[0]),
        "gt_dim": (gt_arr.shape[1], gt_arr.shape[0]),
        "pixel_match_pct": pixel_match_pct,
        "psnr": psnr,
    }


def run_full_benchmark(target_url: str, limit: int = None):
    print("=" * 95)
    print(f"FULL BENCHMARK: UNIFORM VS ELASTIC GRID RECONSTRUCTION")
    print(f"Target URL: {target_url}")
    print("=" * 95)

    with open(MANIFEST_FILE, "r") as f:
        manifest = json.load(f)

    if limit and limit > 0:
        manifest = manifest[:limit]

    print(f"Loaded {len(manifest)} test cases from manifest.json...\n")

    cat_stats = {}

    for idx, item in enumerate(manifest, 1):
        cat = item["category"]
        if cat not in cat_stats:
            cat_stats[cat] = {
                "total": 0,
                "uniform": {"exact_dim": 0, "pixel_matches": [], "psnrs": [], "latencies": []},
                "elastic": {"exact_dim": 0, "pixel_matches": [], "psnrs": [], "latencies": []},
            }

        dist_path = os.path.join(SCRIPT_DIR, "..", "..", item["file"])
        gt_path = os.path.join(SCRIPT_DIR, "..", "..", item["orig_file"])

        if not os.path.exists(dist_path) or not os.path.exists(gt_path):
            continue

        with open(dist_path, "rb") as f:
            dist_bytes = f.read()

        cat_stats[cat]["total"] += 1

        # Test Uniform
        t0 = time.perf_counter()
        res_uni = requests.post(
            target_url,
            files={"file": (os.path.basename(dist_path), dist_bytes, "image/png")},
            params={"mode": "fast", "elastic": "false"},
            timeout=30,
        )
        lat_uni = (time.perf_counter() - t0) * 1000.0

        # Test Elastic
        t0 = time.perf_counter()
        res_ela = requests.post(
            target_url,
            files={"file": (os.path.basename(dist_path), dist_bytes, "image/png")},
            params={"mode": "fast", "elastic": "true"},
            timeout=30,
        )
        lat_ela = (time.perf_counter() - t0) * 1000.0

        m_uni = compute_metrics(res_uni.content, gt_path) if res_uni.status_code == 200 else {}
        m_ela = compute_metrics(res_ela.content, gt_path) if res_ela.status_code == 200 else {}

        if m_uni.get("dim_match"):
            cat_stats[cat]["uniform"]["exact_dim"] += 1
            cat_stats[cat]["uniform"]["pixel_matches"].append(m_uni["pixel_match_pct"])
            cat_stats[cat]["uniform"]["psnrs"].append(m_uni["psnr"])
        cat_stats[cat]["uniform"]["latencies"].append(lat_uni)

        if m_ela.get("dim_match"):
            cat_stats[cat]["elastic"]["exact_dim"] += 1
            cat_stats[cat]["elastic"]["pixel_matches"].append(m_ela["pixel_match_pct"])
            cat_stats[cat]["elastic"]["psnrs"].append(m_ela["psnr"])
        cat_stats[cat]["elastic"]["latencies"].append(lat_ela)

        p_uni = m_uni.get("pixel_match_pct", 0.0)
        p_ela = m_ela.get("pixel_match_pct", 0.0)
        delta_p = p_ela - p_uni

        delta_sign = f"+{delta_p:.1f}%" if delta_p >= 0 else f"{delta_p:.1f}%"
        print(f"[{idx:03d}/{len(manifest):03d}] {cat:<16} | Match: Uni {p_uni:5.1f}% vs Ela {p_ela:5.1f}% ({delta_sign:>6}) | Lat: {lat_uni:5.1f}ms vs {lat_ela:5.1f}ms")

    # Category summary
    print("\n" + "=" * 95)
    print(f"{'CATEGORY':<18} | {'N':<3} | {'UNI MATCH %':<11} | {'ELA MATCH %':<11} | {'UNI PSNR':<9} | {'ELA PSNR':<9} | {'LAT UNI':<8} | {'LAT ELA'}")
    print("-" * 95)

    all_uni_p = []
    all_ela_p = []
    all_uni_psnr = []
    all_ela_psnr = []
    all_uni_lat = []
    all_ela_lat = []

    for cat, s in sorted(cat_stats.items()):
        cnt = s["total"]
        if cnt == 0:
            continue
        u_p = np.mean(s["uniform"]["pixel_matches"]) if s["uniform"]["pixel_matches"] else 0
        e_p = np.mean(s["elastic"]["pixel_matches"]) if s["elastic"]["pixel_matches"] else 0
        u_psnr = np.mean(s["uniform"]["psnrs"]) if s["uniform"]["psnrs"] else 0
        e_psnr = np.mean(s["elastic"]["psnrs"]) if s["elastic"]["psnrs"] else 0
        u_lat = np.mean(s["uniform"]["latencies"])
        e_lat = np.mean(s["elastic"]["latencies"])

        all_uni_p.extend(s["uniform"]["pixel_matches"])
        all_ela_p.extend(s["elastic"]["pixel_matches"])
        all_uni_psnr.extend(s["uniform"]["psnrs"])
        all_ela_psnr.extend(s["elastic"]["psnrs"])
        all_uni_lat.extend(s["uniform"]["latencies"])
        all_ela_lat.extend(s["elastic"]["latencies"])

        print(f"{cat:<18} | {cnt:<3} | {u_p:>10.2f}% | {e_p:>10.2f}% | {u_psnr:>7.2f}dB | {e_psnr:>7.2f}dB | {u_lat:>6.2f}ms | {e_lat:>6.2f}ms")

    print("-" * 95)
    total_samples = len(all_uni_lat)
    tot_u_p = np.mean(all_uni_p) if all_uni_p else 0
    tot_e_p = np.mean(all_ela_p) if all_ela_p else 0
    tot_u_psnr = np.mean(all_uni_psnr) if all_uni_psnr else 0
    tot_e_psnr = np.mean(all_ela_psnr) if all_ela_psnr else 0
    tot_u_lat = np.mean(all_uni_lat) if all_uni_lat else 0
    tot_e_lat = np.mean(all_ela_lat) if all_ela_lat else 0

    print(f"{'OVERALL AVERAGE':<18} | {total_samples:<3} | {tot_u_p:>10.2f}% | {tot_e_p:>10.2f}% | {tot_u_psnr:>7.2f}dB | {tot_e_psnr:>7.2f}dB | {tot_u_lat:>6.2f}ms | {tot_e_lat:>6.2f}ms")
    print("=" * 95)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default=GATEWAY_URL)
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()

    run_full_benchmark(args.url, limit=args.limit)
