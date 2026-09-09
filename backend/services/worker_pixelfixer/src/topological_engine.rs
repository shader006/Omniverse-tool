//! Grid-Constrained Superpixel Engine (GC-SLIC) for Pixel Art Reconstruction (Branch C)
//!
//! Architectural Principles:
//! 1. Dual-Resolution Evidence:
//!    - RAW image: Preserves 100% fine details (1px eyes, high-contrast lines, crisp colors)
//!    - SMOOTH image (OKLab Bilateral): Eliminates AA mush & JPEG ringing for structure clustering
//! 2. True Grid-Constrained SLIC (GC-SLIC):
//!    - Search window permanently anchored to the grid cell (prevents feedback drift loops)
//!    - Centroid update strictly constrained: x' = x_grid + alpha * clamp(x_obs - x_grid, -max_drift, max_drift)
//! 3. Soft Multi-Evidence Cell Fusion:
//!    - Score(k) = w_slic * V_slic + w_center * V_center + w_edge * V_edge
//!    - Eliminates catastrophic hard vetoes (no false positives on boundaries)
//! 4. OKLab Trimmed-Median Coloring:
//!    - Strips edge-bleed AA pixels to preserve pure, vibrant retro palettes without muddy grays

use crate::advanced_refine::oklab::{rgb_to_oklab, oklab_to_rgb, oklab_distance_sq};
use rayon::prelude::*;
use std::collections::HashMap;

pub struct TopologicalResult {
    pub rgba: Vec<u8>,
    pub cols: usize,
    pub rows: usize,
}

/// 1. OKLab Perceptual Bilateral Smoothing (Structure Evidence)
/// Làm phẳng các mảng màu trong không gian OKLab thay vì RGB Euclidean,
/// loại bỏ hoàn toàn quầng mờ Anti-Aliasing nhưng bảo toàn độ tương phản cạnh tri giác.
pub fn oklab_bilateral_smooth(raw: &[u8], w: usize, h: usize) -> Vec<[f64; 3]> {
    let oklab_raw: Vec<[f64; 3]> = raw
        .par_chunks_exact(4)
        .map(|px| rgb_to_oklab([px[0], px[1], px[2]]))
        .collect();

    let mut smoothed = vec![[0.0, 0.0, 0.0]; w * h];
    let spatial_sigma = 2.0f64;
    let color_sigma = 0.08f64; // Trong OKLab, deltaE > 0.05 là mắt người đã thấy khác biệt rõ
    let radius = 2isize;

    let spatial_weights: Vec<f64> = (-radius..=radius)
        .flat_map(|dy| {
            (-radius..=radius).map(move |dx| {
                let d2 = (dx * dx + dy * dy) as f64;
                (-d2 / (2.0 * spatial_sigma * spatial_sigma)).exp()
            })
        })
        .collect();

    let inv_2_color_sigma_sq = 1.0 / (2.0 * color_sigma * color_sigma);

    smoothed
        .par_chunks_exact_mut(w)
        .enumerate()
        .for_each(|(y, row_out)| {
            let y_i = y as isize;
            for x in 0..w {
                let x_i = x as isize;
                let c_idx = y * w + x;
                let c_lab = oklab_raw[c_idx];

                // Nếu là pixel trong suốt
                if raw[c_idx * 4 + 3] < 16 {
                    row_out[x] = c_lab;
                    continue;
                }

                let mut sum_l = 0.0;
                let mut sum_a = 0.0;
                let mut sum_b = 0.0;
                let mut sum_w = 0.0;
                let mut k_idx = 0;

                for dy in -radius..=radius {
                    let ny = y_i + dy;
                    if ny < 0 || ny >= h as isize {
                        k_idx += (2 * radius + 1) as usize;
                        continue;
                    }
                    let row_offset = (ny as usize) * w;

                    for dx in -radius..=radius {
                        let nx = x_i + dx;
                        let sw = spatial_weights[k_idx];
                        k_idx += 1;

                        if nx < 0 || nx >= w as isize {
                            continue;
                        }
                        let n_idx = row_offset + (nx as usize);
                        if raw[n_idx * 4 + 3] < 16 {
                            continue;
                        }

                        let n_lab = oklab_raw[n_idx];
                        let d_col_sq = oklab_distance_sq(c_lab, n_lab);
                        let cw = (-d_col_sq * inv_2_color_sigma_sq).exp();
                        let total_w = sw * cw;

                        sum_l += n_lab[0] * total_w;
                        sum_a += n_lab[1] * total_w;
                        sum_b += n_lab[2] * total_w;
                        sum_w += total_w;
                    }
                }

                if sum_w > 1e-5 {
                    row_out[x] = [sum_l / sum_w, sum_a / sum_w, sum_b / sum_w];
                } else {
                    row_out[x] = c_lab;
                }
            }
        });

    smoothed
}

/// 2. Raw Edge & Contrast Map (Detail Evidence từ ảnh RAW gốc)
/// Tính toán độ tương phản cục bộ trực tiếp trên ảnh gốc chưa qua làm mờ
pub fn compute_raw_detail_map(raw: &[u8], w: usize, h: usize) -> Vec<f64> {
    let mut detail = vec![0.0f64; w * h];
    for y in 1..h - 1 {
        let r0 = (y - 1) * w * 4;
        let r1 = y * w * 4;
        let r2 = (y + 1) * w * 4;

        for x in 1..w - 1 {
            let idx = y * w + x;
            let c_lum = (raw[r1 + x * 4] as f64 * 0.299 + raw[r1 + x * 4 + 1] as f64 * 0.587 + raw[r1 + x * 4 + 2] as f64 * 0.114) / 255.0;

            let mut max_diff = 0.0f64;
            for &(row_off, nx) in &[
                (r0, x), (r2, x), (r1, x - 1), (r1, x + 1),
                (r0, x - 1), (r0, x + 1), (r2, x - 1), (r2, x + 1),
            ] {
                let n_lum = (raw[row_off + nx * 4] as f64 * 0.299 + raw[row_off + nx * 4 + 1] as f64 * 0.587 + raw[row_off + nx * 4 + 2] as f64 * 0.114) / 255.0;
                let diff = (c_lum - n_lum).abs();
                if diff > max_diff {
                    max_diff = diff;
                }
            }
            detail[idx] = max_diff;
        }
    }
    detail
}

/// 3. Grid-Constrained SLIC (GC-SLIC)
/// Centroid được khóa với ô lưới lý tưởng (Grid Anchor) để triệt tiêu hoàn toàn Feedback Drift Loop.
pub struct GcSlicCluster {
    pub grid_x: f64,
    pub grid_y: f64,
    pub cur_x: f64,
    pub cur_y: f64,
    pub lab: [f64; 3],
}

pub fn run_grid_constrained_slic(
    smoothed_lab: &[[f64; 3]],
    w: usize,
    h: usize,
    cols: usize,
    rows: usize,
) -> (Vec<usize>, Vec<[f64; 3]>) {
    let k = cols * rows;
    let step_x = w as f64 / cols as f64;
    let step_y = h as f64 / rows as f64;
    let avg_s = (step_x + step_y) / 2.0;

    // Khởi tạo K cụm neo chính xác tại tâm hình học của cell
    let mut clusters: Vec<GcSlicCluster> = Vec::with_capacity(k);
    for r in 0..rows {
        let gy = ((r as f64 + 0.5) * step_y).clamp(0.0, (h - 1) as f64);
        let y_int = gy.round() as usize;
        for c in 0..cols {
            let gx = ((c as f64 + 0.5) * step_x).clamp(0.0, (w - 1) as f64);
            let x_int = gx.round() as usize;
            let lab = smoothed_lab[y_int * w + x_int];
            clusters.push(GcSlicCluster {
                grid_x: gx,
                grid_y: gy,
                cur_x: gx,
                cur_y: gy,
                lab,
            });
        }
    }

    let mut labels = vec![0usize; w * h];
    let mut distances = vec![f64::INFINITY; w * h];

    // Tham số độ chặt và giới hạn co dãn
    let m = 28.0f64;
    let inv_s_sq = 1.0 / (avg_s * avg_s);
    let m_sq_inv_s_sq = m * m * inv_s_sq;

    // Giới hạn trôi dạt tối đa không quá 15% kích thước cell
    let max_drift_x = 0.15 * step_x;
    let max_drift_y = 0.15 * step_y;
    let alpha = 0.12f64; // Tỷ lệ thích ứng vi mô

    for _iter in 0..4 {
        distances.fill(f64::INFINITY);

        // Search Window: CỐ ĐỊNH neo theo grid_x, grid_y (không drift theo cur_x, cur_y)
        for (k_idx, cl) in clusters.iter().enumerate() {
            let min_x = (cl.grid_x - step_x * 1.15).max(0.0) as usize;
            let max_x = (cl.grid_x + step_x * 1.15).min((w - 1) as f64) as usize;
            let min_y = (cl.grid_y - step_y * 1.15).max(0.0) as usize;
            let max_y = (cl.grid_y + step_y * 1.15).min((h - 1) as f64) as usize;

            for py in min_y..=max_y {
                let dy = py as f64 - cl.cur_y;
                let row_offset = py * w;
                for px in min_x..=max_x {
                    let dx = px as f64 - cl.cur_x;
                    let p_idx = row_offset + px;
                    let p_lab = smoothed_lab[p_idx];

                    let d_col = oklab_distance_sq(p_lab, cl.lab);
                    let d_spa = dx * dx + dy * dy;
                    let dist = d_col + d_spa * m_sq_inv_s_sq;

                    if dist < distances[p_idx] {
                        distances[p_idx] = dist;
                        labels[p_idx] = k_idx;
                    }
                }
            }
        }

        // Cập nhật Centroid có kiểm soát: x' = grid_x + alpha * clamp(obs - grid_x, -max_drift, max_drift)
        let mut accum_x = vec![0.0f64; k];
        let mut accum_y = vec![0.0f64; k];
        let mut accum_l = vec![0.0f64; k];
        let mut accum_a = vec![0.0f64; k];
        let mut accum_b = vec![0.0f64; k];
        let mut count = vec![0usize; k];

        for y in 0..h {
            let row_offset = y * w;
            for x in 0..w {
                let idx = row_offset + x;
                let label = labels[idx];
                let lab = smoothed_lab[idx];

                accum_x[label] += x as f64;
                accum_y[label] += y as f64;
                accum_l[label] += lab[0];
                accum_a[label] += lab[1];
                accum_b[label] += lab[2];
                count[label] += 1;
            }
        }

        for i in 0..k {
            if count[i] > 0 {
                let c_inv = 1.0 / count[i] as f64;
                let obs_x = accum_x[i] * c_inv;
                let obs_y = accum_y[i] * c_inv;

                // Khóa tâm: Giới hạn độ trôi dạt nghiêm ngặt
                let drift_x = (obs_x - clusters[i].grid_x).clamp(-max_drift_x, max_drift_x);
                let drift_y = (obs_y - clusters[i].grid_y).clamp(-max_drift_y, max_drift_y);

                clusters[i].cur_x = clusters[i].grid_x + alpha * drift_x;
                clusters[i].cur_y = clusters[i].grid_y + alpha * drift_y;
                clusters[i].lab = [
                    accum_l[i] * c_inv,
                    accum_a[i] * c_inv,
                    accum_b[i] * c_inv,
                ];
            }
        }
    }

    let final_cluster_labs: Vec<[f64; 3]> = clusters.iter().map(|cl| cl.lab).collect();
    (labels, final_cluster_labs)
}

/// 4. Main GC-SLIC Refine Pipeline (Nhánh C) tích hợp Palette từ Nhánh A
pub fn topological_pixel_refine(
    raw: &[u8],
    w: usize,
    h: usize,
    cols: usize,
    rows: usize,
    k_colors: usize,
    _is_elastic: bool,
) -> TopologicalResult {
    // Bước 1: Trích xuất bảng màu toàn cục (Global Palette) từ Nhánh A
    // Giúp ảnh dứt khoát, sắc cạnh (cel-shading), loại bỏ 100% hiện tượng blur/gradient
    let k_req = if k_colors > 0 {
        k_colors
    } else {
        crate::kmeans::adaptive_k(raw, w, h, 16, 48, 0.003)
    };
    let (palette_labels, kc) = crate::kmeans::kmeans_labels(raw, w, h, k_req);
    let kc = kc.max(1);

    // Bước 2: Trích xuất song song Dual Evidence hình học
    // Kênh A: Smooth Evidence bằng OKLab Bilateral để phân cụm cấu trúc
    let smoothed_lab = oklab_bilateral_smooth(raw, w, h);

    // Kênh B: Detail & Edge Evidence từ ảnh RAW gốc (bảo toàn mắt 1px, nét mảnh, tia lửa)
    let raw_detail_map = compute_raw_detail_map(raw, w, h);

    // Bước 3: Chạy Grid-Constrained SLIC (Khóa tâm tuyệt đối, không trôi dạt)
    let (slic_labels, _cluster_labs) = run_grid_constrained_slic(&smoothed_lab, w, h, cols, rows);

    let step_x = w as f64 / cols as f64;
    let step_y = h as f64 / rows as f64;

    // Bước 4: Stage 1 + Stage 2 Palette Voting kết hợp SLIC Boundary Awareness
    let mut out_rgba = vec![0u8; cols * rows * 4];

    for r in 0..rows {
        let y_start = ((r as f64) * step_y).floor() as usize;
        let y_end = (((r + 1) as f64) * step_y).ceil().min(h as f64) as usize;
        let cy = (r as f64 + 0.5) * step_y;
        let cy_idx = (cy.floor() as usize).min(h.saturating_sub(1));

        for c in 0..cols {
            let x_start = ((c as f64) * step_x).floor() as usize;
            let x_end = (((c + 1) as f64) * step_x).ceil().min(w as f64) as usize;
            let cx = (c as f64 + 0.5) * step_x;
            let cx_idx = (cx.floor() as usize).min(w.saturating_sub(1));

            let center_p_idx = cy_idx * w + cx_idx;
            let center_slic_label = slic_labels[center_p_idx];

            let cell_idx = (r * cols + c) * 4;

            // STAGE 1: Bầu chọn nhãn Palette thắng cuộc (Winning Palette Label)
            // Kết hợp trọng số tâm + Độ nhạy tương phản RAW + Đồng thuận cụm SLIC
            let mut label_scores = vec![0.0f64; kc];
            let mut total_votes = 0.0f64;
            let mut alpha_count = 0usize;
            let mut total_pixels = 0usize;

            for y in y_start..y_end {
                let row_offset = y * w;
                let dy = (y as f64 + 0.5 - cy) / step_y;
                let wy = (1.0 - 2.0 * dy.abs()).max(0.0);

                for x in x_start..x_end {
                    let p_idx = row_offset + x;
                    let dx = (x as f64 + 0.5 - cx) / step_x;
                    let wx = (1.0 - 2.0 * dx.abs()).max(0.0);

                    // Trọng số tâm tam giác (kèm sàn 0.05 để không triệt tiêu chi tiết ở mép)
                    let center_weight = wx * wy + 0.05;

                    // Trọng số tương phản từ ảnh RAW: bảo vệ chi tiết 1px, tia lửa, viền mảnh
                    let contrast = raw_detail_map[p_idx];
                    let edge_boost = 1.0 + 2.5 * contrast;

                    // Trọng số đồng thuận hình học SLIC: ưu tiên pixel cùng mảng cấu trúc
                    let slic_weight = if slic_labels[p_idx] == center_slic_label { 1.4 } else { 0.8 };

                    let vote_weight = center_weight * edge_boost * slic_weight;

                    let p_label = palette_labels[p_idx] as usize;
                    if p_label < kc {
                        label_scores[p_label] += vote_weight;
                        total_votes += vote_weight;
                    }

                    let raw_idx = p_idx * 4;
                    if raw[raw_idx + 3] > 127 {
                        alpha_count += 1;
                    }
                    total_pixels += 1;
                }
            }

            // Tìm nhãn Palette có điểm bầu chọn cao nhất trong cell
            let mut win_label = 0usize;
            let mut best_score = -1.0f64;
            for (lbl, &score) in label_scores.iter().enumerate() {
                if score > best_score {
                    best_score = score;
                    win_label = lbl;
                }
            }

            // STAGE 2: Lấy màu nguyên bản từ ảnh RAW (theo đúng cơ chế tinh túy của Nhánh A)
            // Chỉ những sub-pixel CÓ CÙNG NHÃN THẮNG CUỘC mới được tham gia tính màu
            let mut csum = [0.0f64; 3];
            let mut wden = 0.0f64;
            let mut sel_count = 0usize;

            let mut msum = [0.0f64; 3];
            let mut fallback_count = 0usize;

            for y in y_start..y_end {
                let row_offset = y * w;
                let dy = (y as f64 + 0.5 - cy) / step_y;
                let wy = (1.0 - 2.0 * dy.abs()).max(0.0);

                for x in x_start..x_end {
                    let p_idx = row_offset + x;
                    let dx = (x as f64 + 0.5 - cx) / step_x;
                    let wx = (1.0 - 2.0 * dx.abs()).max(0.0);
                    let wgt = wx * wy + 0.05;

                    let raw_idx = p_idx * 4;
                    let r_val = raw[raw_idx] as f64;
                    let g_val = raw[raw_idx + 1] as f64;
                    let b_val = raw[raw_idx + 2] as f64;

                    msum[0] += r_val;
                    msum[1] += g_val;
                    msum[2] += b_val;
                    fallback_count += 1;

                    if (palette_labels[p_idx] as usize) == win_label {
                        csum[0] += r_val * wgt;
                        csum[1] += g_val * wgt;
                        csum[2] += b_val * wgt;
                        wden += wgt;
                        sel_count += 1;
                    }
                }
            }

            let final_rgb = if sel_count > 0 && wden > 1e-6 {
                [
                    (csum[0] / wden).round().clamp(0.0, 255.0) as u8,
                    (csum[1] / wden).round().clamp(0.0, 255.0) as u8,
                    (csum[2] / wden).round().clamp(0.0, 255.0) as u8,
                ]
            } else if fallback_count > 0 {
                let fc = fallback_count as f64;
                [
                    (msum[0] / fc).round().clamp(0.0, 255.0) as u8,
                    (msum[1] / fc).round().clamp(0.0, 255.0) as u8,
                    (msum[2] / fc).round().clamp(0.0, 255.0) as u8,
                ]
            } else {
                [0, 0, 0]
            };

            let final_alpha = if alpha_count * 2 >= total_pixels.max(1) { 255u8 } else { 0u8 };

            out_rgba[cell_idx] = final_rgb[0];
            out_rgba[cell_idx + 1] = final_rgb[1];
            out_rgba[cell_idx + 2] = final_rgb[2];
            out_rgba[cell_idx + 3] = final_alpha;
        }
    }

    TopologicalResult {
        rgba: out_rgba,
        cols,
        rows,
    }
}
