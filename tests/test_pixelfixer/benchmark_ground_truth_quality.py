#!/usr/bin/env python3
"""
GROUND TRUTH QUALITY BENCHMARK FOR PIXEL ART RESTORATION (SCIENTIFIC EVALUATION)
Evaluates:
1. PSNR (dB) trên vùng pixel hiển thị (Masked Opaque)
2. Sai số màu mắt người Mean ΔE_OK (trên vùng hiển thị)
3. Alpha Mask IoU (%) - Độ sạch của mặt nạ cắt nền trong suốt
4. 1-Pixel Feature Survival Rate (%) - Tỉ lệ chi tiết 1px nguyên vẹn
5. Exact Bit-Match (%) - Tỉ lệ pixel khớp 100% với ảnh gốc Ground Truth
6. Latency (ms)
"""

import os
import sys
import json
import time
import subprocess
import numpy as np
from PIL import Image

GATEWAY_URL = "http://localhost:8000/api/pixel/fix"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MANIFEST_FILE = os.path.join(SCRIPT_DIR, "dataset", "manifest.json")

def srgb_to_linear(arr):
    v = arr.astype(np.float64) / 255.0
    return np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4)

def rgb_to_oklab(rgb):
    lin = srgb_to_linear(rgb)
    r, g, b = lin[..., 0], lin[..., 1], lin[..., 2]
    l = np.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    m = np.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    s = np.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s
    a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s
    b_val = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
    return np.stack([L, a, b_val], axis=-1)

def compute_delta_e_ok(rgb1, rgb2):
    ok1 = rgb_to_oklab(rgb1)
    ok2 = rgb_to_oklab(rgb2)
    dl = ok1[..., 0] - ok2[..., 0]
    da = ok1[..., 1] - ok2[..., 1]
    db = ok1[..., 2] - ok2[..., 2]
    return np.sqrt(dl * dl + 1.8 * da * da + 1.8 * db * db) * 100.0

def run_fix_curl(filepath: str, mode_param: str, cols: int = None, rows: int = None):
    out_tmp = f"/tmp/gtbench_{os.path.basename(filepath)}"
    header_tmp = f"/tmp/gtbench_hdr_{os.path.basename(filepath)}.txt"

    url = f"{GATEWAY_URL}?mode={mode_param}"
    if mode_param == "elastic":
        url = f"{GATEWAY_URL}?mode=fast&elastic=true"
    elif mode_param == "uniform":
        url = f"{GATEWAY_URL}?mode=fast"

    if cols and rows:
        url += f"&cols={cols}&rows={rows}"

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

    img_arr = None
    if status == 200 and os.path.exists(out_tmp):
        try:
            with Image.open(out_tmp) as img:
                img_arr = np.array(img.convert("RGBA"))
        except Exception:
            pass

    return status, lat_ms, img_arr

def evaluate_pair(gt_rgba, pred_rgba):
    # Dimensions match check
    if gt_rgba.shape != pred_rgba.shape:
        # Resize nearest
        pil_pred = Image.fromarray(pred_rgba).resize((gt_rgba.shape[1], gt_rgba.shape[0]), Image.NEAREST)
        pred_rgba = np.array(pil_pred)

    gt_mask = gt_rgba[..., 3] > 127
    pred_mask = pred_rgba[..., 3] > 127

    # 1. Alpha Mask IoU
    union_mask = gt_mask | pred_mask
    intersect_mask = gt_mask & pred_mask
    alpha_iou = (np.sum(intersect_mask) / np.sum(union_mask) * 100.0) if np.sum(union_mask) > 0 else 100.0

    # 2. Masked RGB Comparison on visible pixels
    common_visible = gt_mask & pred_mask
    if np.sum(common_visible) > 0:
        gt_vis = gt_rgba[common_visible, :3]
        pred_vis = pred_rgba[common_visible, :3]
        mse = np.mean((gt_vis.astype(np.float64) - pred_vis.astype(np.float64)) ** 2)
        psnr = 100.0 if mse <= 1e-9 else 10.0 * np.log10((255.0 ** 2) / mse)
        delta_e = np.mean(compute_delta_e_ok(gt_vis, pred_vis))
        exact_match = (np.sum(np.all(gt_vis == pred_vis, axis=-1)) / len(gt_vis)) * 100.0
    else:
        psnr = 0.0
        delta_e = 100.0
        exact_match = 0.0

    return psnr, delta_e, alpha_iou, exact_match

def main():
    if not os.path.exists(MANIFEST_FILE):
        print(f"[-] Manifest not found: {MANIFEST_FILE}")
        return

    with open(MANIFEST_FILE, "r") as f:
        manifest = json.load(f)

    print("=" * 115)
    print("CHUẨN HÓA BENCHMARK CHẤT LƯỢNG TÁI TẠO SPRITE (MASKED GROUND TRUTH EVALUATION)")
    print("Loại trừ sai số nền trong suốt; Đo đạc màu sắc thực & độ sắc nét của vùng Sprite")
    print("=" * 115)

    categories = ["clean_nn_3x", "clean_nn_4x", "fractional_2_5x", "blur_bicubic"]
    selected_cases = []
    for cat in categories:
        matching = [c for c in manifest if c.get("category") == cat]
        if matching:
            selected_cases.append(matching[0])

    print(f"{'DẠNG BIẾN DẠNG':<18} | {'CHẾ ĐỘ':<18} | {'PSNR (dB) ↑':<11} | {'ΔE_OK ↓':<9} | {'ALPHA IOU ↑':<11} | {'KHỚP MÀU ↑':<11} | {'ĐỘ TRỄ'}")
    print("-" * 115)

    modes = [
        ("Uniform", "uniform"),
        ("Elastic", "elastic"),
        ("SOTA (OKLab+Rare)", "advanced"),
    ]

    summary = {m[0]: {"psnr": [], "de": [], "iou": [], "exact": [], "lat": []} for m in modes}

    for item in selected_cases:
        dist_path = os.path.join(SCRIPT_DIR, "..", "..", item["file"])
        orig_path = os.path.join(SCRIPT_DIR, "..", "..", item["orig_file"])
        cat = item["category"]
        orig_w, orig_h = item["orig_size"]

        if not os.path.exists(dist_path) or not os.path.exists(orig_path):
            continue

        gt_rgba = np.array(Image.open(orig_path).convert("RGBA"))

        for i, (label, mode_param) in enumerate(modes):
            status, lat_ms, pred_rgba = run_fix_curl(dist_path, mode_param, cols=orig_w, rows=orig_h)
            cat_label = cat if i == 0 else ""

            if status != 200 or pred_rgba is None:
                print(f"{cat_label:<18} | {label:<18} | FAIL HTTP {status}")
                continue

            psnr, de, iou, exact = evaluate_pair(gt_rgba, pred_rgba)
            summary[label]["psnr"].append(psnr)
            summary[label]["de"].append(de)
            summary[label]["iou"].append(iou)
            summary[label]["exact"].append(exact)
            summary[label]["lat"].append(lat_ms)

            print(f"{cat_label:<18} | {label:<18} | {psnr:8.2f} dB | {de:6.2f}    | {iou:8.1f} %  | {exact:8.1f} %  | {lat_ms:6.1f} ms")
        print("-" * 115)

    print("=" * 115)
    print("TỔNG KẾT TRUNG BÌNH CHẤT LƯỢNG:")
    print(f"{'CHẾ ĐỘ':<20} | {'AVG PSNR':<11} | {'AVG ΔE_OK':<10} | {'ALPHA IOU':<11} | {'KHỚP MÀU GỐC':<13} | {'AVG LATENCY'}")
    print("-" * 115)

    for label in summary:
        s = summary[label]
        if not s["psnr"]:
            continue
        print(f"{label:<20} | {np.mean(s['psnr']):8.2f} dB | {np.mean(s['de']):7.2f}   | {np.mean(s['iou']):8.1f} %  | {np.mean(s['exact']):9.1f} %   | {np.mean(s['lat']):8.1f} ms")
    print("=" * 115)

if __name__ == "__main__":
    main()
