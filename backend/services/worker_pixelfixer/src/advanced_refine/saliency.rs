//! Tri-channel Saliency Tensor computation: Rareness, Edge, and Variance.
//! Uses OKLab color space to compute perceptual contrast, Sobel gradients, and local patch variance.

use super::oklab::{oklab_chroma, oklab_distance_sq};
use rayon::prelude::*;

pub struct SaliencyMaps {
    /// Combined weight map W(x, y) used to weight the Wu moments.
    pub fused_weights: Vec<f64>,
    /// Per-pixel rareness score (contrast with 8-neighborhood).
    pub rareness: Vec<f64>,
    /// Per-pixel edge magnitude (Sobel).
    pub edge: Vec<f64>,
    /// Per-pixel local 3x3 variance.
    pub variance: Vec<f64>,
}

/// Computes the tri-channel saliency maps for an OKLab image of dimensions w x h.
/// `labs` contains w * h elements of [L, a, b].
pub fn compute_saliency_tensor(labs: &[[f64; 3]], w: usize, h: usize) -> SaliencyMaps {
    let total_px = w * h;
    if total_px == 0 {
        return SaliencyMaps {
            fused_weights: Vec::new(),
            rareness: Vec::new(),
            edge: Vec::new(),
            variance: Vec::new(),
        };
    }

    let mut rareness = vec![0.0f64; total_px];
    let mut edge = vec![0.0f64; total_px];
    let mut variance = vec![0.0f64; total_px];
    let mut fused_weights = vec![1.0f64; total_px];

    // Parallel row computation using Rayon
    let rows_data: Vec<(Vec<f64>, Vec<f64>, Vec<f64>, Vec<f64>)> = (0..h)
        .into_par_iter()
        .map(|y| {
            let mut row_rare = vec![0.0f64; w];
            let mut row_edge = vec![0.0f64; w];
            let mut row_var = vec![0.0f64; w];
            let mut row_fused = vec![1.0f64; w];

            let y_prev = y.saturating_sub(1);
            let y_next = (y + 1).min(h - 1);

            for x in 0..w {
                let x_prev = x.saturating_sub(1);
                let x_next = (x + 1).min(w - 1);
                let center_lab = labs[y * w + x];
                let chroma = oklab_chroma(center_lab);

                // 1. Rareness: Maximum perceptual color distance to 8-neighbors
                let mut max_dist_sq = 0.0f64;
                for ny in [y_prev, y, y_next] {
                    for nx in [x_prev, x, x_next] {
                        if nx == x && ny == y {
                            continue;
                        }
                        let neighbor_lab = labs[ny * w + nx];
                        let d_sq = oklab_distance_sq(center_lab, neighbor_lab);
                        if d_sq > max_dist_sq {
                            max_dist_sq = d_sq;
                        }
                    }
                }
                // Scale rareness by saturation: vivid accents stand out more
                let rare_score = (max_dist_sq * 100.0).min(10.0) * (0.5 + chroma * 2.0);
                row_rare[x] = rare_score;

                // 2. Edge: Sobel filter on Lightness channel + chromatic channels
                // Horizontal and vertical Sobel kernel convolution
                let mut gx = 0.0f64;
                let mut gy = 0.0f64;

                let p00 = labs[y_prev * w + x_prev][0];
                let p01 = labs[y_prev * w + x][0];
                let p02 = labs[y_prev * w + x_next][0];
                let p10 = labs[y * w + x_prev][0];
                let p12 = labs[y * w + x_next][0];
                let p20 = labs[y_next * w + x_prev][0];
                let p21 = labs[y_next * w + x][0];
                let p22 = labs[y_next * w + x_next][0];

                gx += -1.0 * p00 + 1.0 * p02 - 2.0 * p10 + 2.0 * p12 - 1.0 * p20 + 1.0 * p22;
                gy += -1.0 * p00 - 2.0 * p01 - 1.0 * p02 + 1.0 * p20 + 2.0 * p21 + 1.0 * p22;

                let edge_mag = (gx * gx + gy * gy).sqrt();
                let edge_score = (edge_mag * 4.0).min(10.0);
                row_edge[x] = edge_score;

                // 3. Variance: 3x3 local color variance
                let mut sum_l = 0.0f64;
                let mut sum_sq_l = 0.0f64;
                let count = 9.0f64;
                for ny in [y_prev, y, y_next] {
                    for nx in [x_prev, x, x_next] {
                        let l_val = labs[ny * w + nx][0];
                        sum_l += l_val;
                        sum_sq_l += l_val * l_val;
                    }
                }
                let mean_l = sum_l / count;
                let var_l = (sum_sq_l / count - mean_l * mean_l).max(0.0);
                let var_score = (var_l * 50.0).min(10.0);
                row_var[x] = var_score;

                // 4. Fused Weight W(x, y) for Wu moments:
                // Base weight = 1.0
                // High rareness (accent 1px) gets up to +15.0
                // High edge gets up to +5.0
                // High variance gets up to +3.0
                let weight = 1.0 + rare_score * 1.5 + edge_score * 0.5 + var_score * 0.3;
                row_fused[x] = weight;
            }

            (row_rare, row_edge, row_var, row_fused)
        })
        .collect();

    // Flatten back into contiguous vectors
    for (y, (r_row, e_row, v_row, f_row)) in rows_data.into_iter().enumerate() {
        let base = y * w;
        rareness[base..base + w].copy_from_slice(&r_row);
        edge[base..base + w].copy_from_slice(&e_row);
        variance[base..base + w].copy_from_slice(&v_row);
        fused_weights[base..base + w].copy_from_slice(&f_row);
    }

    SaliencyMaps {
        fused_weights,
        rareness,
        edge,
        variance,
    }
}
