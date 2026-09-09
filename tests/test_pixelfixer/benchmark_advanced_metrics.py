#!/usr/bin/env python3
"""
CHƯƠNG TRÌNH ĐO ĐẠC TOÀN DIỆN CÁC CHỈ SỐ CẤP CAO CHO PIXEL ART (SCIENTIFIC BENCHMARK)
1. 1-Pixel Feature Survival Rate (%) [Đo khả năng sống sót của chi tiết 1px]
2. SSIM (Structural Similarity Index) [Độ toàn vẹn cấu trúc hình khối 0.0 - 1.0]
3. Sobel Edge F1-Score (%) [Độ sắc nét & chuẩn xác của đường viền]
4. Perceptual Color Error ΔE_OK [Sai số màu sắc theo mắt người nhìn]
5. Alpha Mask IoU (%) [Độ sạch của viền nền trong suốt]
6. Throughput (Megapixels / sec) & Latency (ms)
"""

import os
import sys
import json
import time
import subprocess
import numpy as np
from PIL import Image
from scipy.signal import convolve2d

GATEWAY_URL = "http://localhost:8000/api/pixel/fix"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MANIFEST_FILE = os.path.join(SCRIPT_DIR, "dataset", "manifest.json")
ROOT_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, "..", ".."))

# -----------------------------------------------------------------------------
# 1. Color Spaces: sRGB -> Linear -> OKLab
# -----------------------------------------------------------------------------
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

# -----------------------------------------------------------------------------
# 2. SSIM (Structural Similarity Index) on Luminance
# -----------------------------------------------------------------------------
def compute_ssim(img1_rgba, img2_rgba):
    # RGB to Gray (Luminance)
    y1 = 0.299 * img1_rgba[..., 0] + 0.587 * img1_rgba[..., 1] + 0.114 * img1_rgba[..., 2]
    y2 = 0.299 * img2_rgba[..., 0] + 0.587 * img2_rgba[..., 1] + 0.114 * img2_rgba[..., 2]

    # Gaussian / box 3x3 kernel
    window = np.ones((3, 3)) / 9.0
    mu1 = convolve2d(y1, window, mode='valid')
    mu2 = convolve2d(y2, window, mode='valid')

    mu1_sq = mu1 * mu1
    mu2_sq = mu2 * mu2
    mu1_mu2 = mu1 * mu2

    sigma1_sq = convolve2d(y1 * y1, window, mode='valid') - mu1_sq
    sigma2_sq = convolve2d(y2 * y2, window, mode='valid') - mu2_sq
    sigma12 = convolve2d(y1 * y2, window, mode='valid') - mu1_mu2

    c1 = (0.01 * 255) ** 2
    c2 = (0.03 * 255) ** 2

    ssim_map = ((2 * mu1_mu2 + c1) * (2 * sigma12 + c2)) / ((mu1_sq + mu2_sq + c1) * (sigma1_sq + sigma2_sq + c2))
    return float(np.clip(np.mean(ssim_map), 0.0, 1.0))

# -----------------------------------------------------------------------------
# 3. 1-Pixel Isolated Feature Survival Rate (%)
# -----------------------------------------------------------------------------
def compute_1px_survival_rate(gt_rgba, pred_rgba):
    h, w, _ = gt_rgba.shape
    gt_rgb = gt_rgba[..., :3]
    gt_mask = gt_rgba[..., 3] > 127
    pred_rgb = pred_rgba[..., :3]
    pred_mask = pred_rgba[..., 3] > 127

    isolated_pts = []
    # Identify TRUE 1px isolated micro-features in GT (eyes, glints, dots, fangs)
    # A true 1px feature differs strongly from all 4 orthogonal neighbors or at least 7/8 neighbors
    for y in range(1, h - 1):
        for x in range(1, w - 1):
            if not gt_mask[y, x]:
                continue
            center = gt_rgb[y, x]
            orth_neighbors = [
                gt_rgb[y-1, x], gt_rgb[y+1, x],
                gt_rgb[y, x-1], gt_rgb[y, x+1],
            ]
            all_neighbors = orth_neighbors + [
                gt_rgb[y-1, x-1], gt_rgb[y-1, x+1],
                gt_rgb[y+1, x-1], gt_rgb[y+1, x+1],
            ]
            orth_diffs = [np.linalg.norm(center.astype(float) - n.astype(float)) for n in orth_neighbors]
            all_diffs = [np.linalg.norm(center.astype(float) - n.astype(float)) for n in all_neighbors]

            # Truly isolated micro-accent: distinct from all 4 orthogonal neighbors, or >=7/8 of 3x3
            if (all(d > 28.0 for d in orth_diffs)) or (sum(1 for d in all_diffs if d > 28.0) >= 7):
                isolated_pts.append((y, x, center))

    if not isolated_pts:
        return 100.0, 0

    survived = 0
    for y, x, gt_c in isolated_pts:
        if not pred_mask[y, x]:
            continue
        p_c = pred_rgb[y, x]
        dist_to_gt = np.linalg.norm(gt_c.astype(float) - p_c.astype(float))
        pred_orth = [
            pred_rgb[y-1, x], pred_rgb[y+1, x],
            pred_rgb[y, x-1], pred_rgb[y, x+1]
        ]
        p_diffs = [np.linalg.norm(p_c.astype(float) - pn.astype(float)) for pn in pred_orth]
        # Survived if pixel color matches GT and remains a sharp isolated contrast against neighbors
        if dist_to_gt <= 32.0 and sum(1 for pd in p_diffs if pd > 20.0) >= 3:
            survived += 1

    rate = (survived / len(isolated_pts)) * 100.0
    return rate, len(isolated_pts)

# -----------------------------------------------------------------------------
# 4. Sobel Edge F1-Score (%)
# -----------------------------------------------------------------------------
def compute_edge_f1(gt_rgba, pred_rgba):
    y_gt = (0.299 * gt_rgba[..., 0] + 0.587 * gt_rgba[..., 1] + 0.114 * gt_rgba[..., 2])
    y_pred = (0.299 * pred_rgba[..., 0] + 0.587 * pred_rgba[..., 1] + 0.114 * pred_rgba[..., 2])

    kx = np.array([[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]], dtype=float)
    ky = np.array([[-1, -2, -1], [0, 0, 0], [1, 2, 1]], dtype=float)

    gx_gt = convolve2d(y_gt, kx, mode='same')
    gy_gt = convolve2d(y_gt, ky, mode='same')
    mag_gt = np.hypot(gx_gt, gy_gt) > 35.0

    gx_pr = convolve2d(y_pred, kx, mode='same')
    gy_pr = convolve2d(y_pred, ky, mode='same')
    mag_pr = np.hypot(gx_pr, gy_pr) > 35.0

    tp = np.sum(mag_gt & mag_pr)
    fp = np.sum((~mag_gt) & mag_pr)
    fn = np.sum(mag_gt & (~mag_pr))

    precision = tp / (tp + fp) if (tp + fp) > 0 else 1.0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 1.0
    f1 = (2.0 * precision * recall / (precision + recall) * 100.0) if (precision + recall) > 0 else 100.0
    return f1

# -----------------------------------------------------------------------------
# 5. Pipeline Runner
# -----------------------------------------------------------------------------
def run_fix_curl(filepath: str, mode_param: str, cols: int = None, rows: int = None):
    out_tmp = f"/tmp/bench_adv_{os.path.basename(filepath)}"
    if mode_param == "uniform":
        url = f"{GATEWAY_URL}?mode=fast&elastic=false"
    elif mode_param == "elastic":
        url = f"{GATEWAY_URL}?mode=fast&elastic=true"
    elif mode_param == "uniform_sota":
        url = f"{GATEWAY_URL}?mode=advanced&elastic=false"
    elif mode_param == "elastic_sota":
        url = f"{GATEWAY_URL}?mode=advanced&elastic=true"
    else:
        url = f"{GATEWAY_URL}?mode={mode_param}"

    if cols and rows:
        url += f"&cols={cols}&rows={rows}"

    cmd = [
        "curl", "-s",
        "-X", "POST",
        "-F", f"file=@{filepath}",
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

def main():
    if not os.path.exists(MANIFEST_FILE):
        print(f"[-] Không tìm thấy manifest: {MANIFEST_FILE}")
        return

    with open(MANIFEST_FILE, "r") as f:
        manifest = json.load(f)

    print("=" * 135)
    print("BENCHMARK TOÀN DIỆN 4 CHẾ ĐỘ:")
    print("1. Uniform | 2. Uniform + SOTA | 3. Elastic | 4. Elastic + SOTA")
    print("Các chỉ số: SSIM (Cấu trúc), 1px Recall (Chi tiết mắt/nanh), Edge F1 (Đường viền), ΔE_OK (Màu mắt người), Throughput")
    print("=" * 135)

    categories = ["clean_nn_3x", "clean_nn_4x", "fractional_2_5x", "blur_bicubic"]
    test_cases = []
    for cat in categories:
        found = [c for c in manifest if c.get("category") == cat]
        if found:
            test_cases.append(found[0])
            if len(found) > 1 and len(test_cases) < 6:
                test_cases.append(found[1])

    modes = [
        ("Uniform", "uniform"),
        ("Uniform + SOTA", "uniform_sota"),
        ("Elastic", "elastic"),
        ("Elastic + SOTA", "elastic_sota"),
    ]

    header_fmt = f"{'TEST CASE':<18} | {'CHẾ ĐỘ':<16} | {'1PX SỐNG SÓT':<13} | {'SSIM ↑':<8} | {'EDGE F1 ↑':<10} | {'ΔE_OK ↓':<8} | {'ĐỘ TRỄ':<9} | {'THROUGHPUT'}"
    print(header_fmt)
    print("-" * 135)

    summary = {
        "Uniform": {"1px": [], "ssim": [], "edge": [], "de": [], "lat": [], "tp": []},
        "Uniform + SOTA": {"1px": [], "ssim": [], "edge": [], "de": [], "lat": [], "tp": []},
        "Elastic": {"1px": [], "ssim": [], "edge": [], "de": [], "lat": [], "tp": []},
        "Elastic + SOTA": {"1px": [], "ssim": [], "edge": [], "de": [], "lat": [], "tp": []},
    }

    for item in test_cases:
        dist_path = os.path.join(ROOT_DIR, item["file"])
        gt_path = os.path.join(ROOT_DIR, item["orig_file"])
        if not os.path.exists(dist_path) or not os.path.exists(gt_path):
            continue

        gt_img = Image.open(gt_path).convert("RGBA")
        gt_rgba = np.array(gt_img)
        w_in, h_in = Image.open(dist_path).size
        input_megapixels = (w_in * h_in) / 1_000_000.0
        orig_cols, orig_rows = item["orig_size"]

        cat_label = f"{item['category']}"

        for idx, (mode_label, mode_param) in enumerate(modes):
            status, lat_ms, pred_rgba = run_fix_curl(dist_path, mode_param, orig_cols, orig_rows)
            if status != 200 or pred_rgba is None:
                continue

            # Ensure same dimensions
            if pred_rgba.shape[:2] != gt_rgba.shape[:2]:
                pred_rgba = np.array(Image.fromarray(pred_rgba).resize((gt_rgba.shape[1], gt_rgba.shape[0]), Image.NEAREST))

            # 1. 1px survival rate
            surv_1px, n_pts = compute_1px_survival_rate(gt_rgba, pred_rgba)
            # 2. SSIM
            ssim_score = compute_ssim(gt_rgba, pred_rgba)
            # 3. Edge F1
            edge_f1 = compute_edge_f1(gt_rgba, pred_rgba)
            # 4. Delta E OK on visible
            common_vis = (gt_rgba[..., 3] > 127) & (pred_rgba[..., 3] > 127)
            if np.sum(common_vis) > 0:
                de_score = float(np.mean(compute_delta_e_ok(gt_rgba[common_vis, :3], pred_rgba[common_vis, :3])))
            else:
                de_score = 0.0

            # 5. Throughput (MP/s)
            tp_mps = input_megapixels / (lat_ms / 1000.0) if lat_ms > 0 else 0.0

            summary[mode_label]["1px"].append(surv_1px)
            summary[mode_label]["ssim"].append(ssim_score)
            summary[mode_label]["edge"].append(edge_f1)
            summary[mode_label]["de"].append(de_score)
            summary[mode_label]["lat"].append(lat_ms)
            summary[mode_label]["tp"].append(tp_mps)

            row_name = cat_label if idx == 0 else ""
            print(f"{row_name:<18} | {mode_label:<16} | {surv_1px:6.1f}% ({n_pts:>2}) | {ssim_score:6.4f} | {edge_f1:6.1f}%   | {de_score:6.2f}   | {lat_ms:5.1f} ms | {tp_mps:5.1f} MP/s")
        print("-" * 135)

    print("=" * 135)
    print("🏆 BẢNG TỔNG KẾT TRUNG BÌNH CÁC CHỈ SỐ CẤP CAO:")
    print(f"{'CHẾ ĐỘ':<18} | {'1PX SỐNG SÓT':<14} | {'SSIM ↑':<10} | {'EDGE F1 ↑':<11} | {'ΔE_OK ↓':<10} | {'ĐỘ TRỄ TRUNG BÌNH':<20} | {'THROUGHPUT'}")
    print("-" * 135)
    for m in ["Uniform", "Uniform + SOTA", "Elastic", "Elastic + SOTA"]:
        avg_1px = np.mean(summary[m]["1px"]) if summary[m]["1px"] else 0.0
        avg_ssim = np.mean(summary[m]["ssim"]) if summary[m]["ssim"] else 0.0
        avg_edge = np.mean(summary[m]["edge"]) if summary[m]["edge"] else 0.0
        avg_de = np.mean(summary[m]["de"]) if summary[m]["de"] else 0.0
        avg_lat = np.mean(summary[m]["lat"]) if summary[m]["lat"] else 0.0
        avg_tp = np.mean(summary[m]["tp"]) if summary[m]["tp"] else 0.0
        print(f"{m:<18} | {avg_1px:6.1f} %        | {avg_ssim:6.4f}     | {avg_edge:6.1f} %     | {avg_de:6.2f}       | {avg_lat:6.1f} ms           | {avg_tp:5.1f} MP/s")
    print("=" * 135)

if __name__ == "__main__":
    main()
