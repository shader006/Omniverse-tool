//! Label assignment, Label Confidence metric, and Protected Detail Check.
//! Ensures fine 1-pixel accents (rare details, eyes, highlights) are flagged for protection.

use super::oklab::oklab_distance_sq;
use rayon::prelude::*;

pub struct LabeledImage {
    /// Palette index for each input pixel (size: w * h).
    pub labels: Vec<u32>,
    /// Label confidence in [0.0, 1.0] for each pixel (size: w * h).
    pub confidence: Vec<f64>,
    /// Boolean mask indicating whether the pixel is part of a protected 1-4px detail (size: w * h).
    pub protected_mask: Vec<bool>,
}

/// Assigns labels from the Wu OKLab palette, calculates per-pixel confidence,
/// and executes the Protected Detail Check.
pub fn assign_and_protect(
    labs: &[[f64; 3]],
    rareness: &[f64],
    edge: &[f64],
    palette: &[[f64; 3]],
    w: usize,
    h: usize,
) -> LabeledImage {
    let total_px = w * h;
    let k = palette.len();
    if total_px == 0 || k == 0 {
        return LabeledImage {
            labels: Vec::new(),
            confidence: Vec::new(),
            protected_mask: Vec::new(),
        };
    }

    // 1. Parallel assignment of labels and label confidence
    let (labels, confidence): (Vec<u32>, Vec<f64>) = (0..total_px)
        .into_par_iter()
        .map(|idx| {
            let px_lab = labs[idx];
            let mut best_i = 0usize;
            let mut d1 = f64::INFINITY;
            let mut d2 = f64::INFINITY;

            for (i, &pal_lab) in palette.iter().enumerate() {
                let dist = oklab_distance_sq(px_lab, pal_lab);
                if dist < d1 {
                    d2 = d1;
                    d1 = dist;
                    best_i = i;
                } else if dist < d2 {
                    d2 = dist;
                }
            }

            // Confidence metric: 1.0 - sqrt(d1 / d2)
            let conf = if d2 <= 1e-9 {
                1.0
            } else {
                (1.0 - (d1 / d2).sqrt()).clamp(0.0, 1.0)
            };

            (best_i as u32, conf)
        })
        .unzip();

    // 2. Protected Detail Check: Find isolated, high-contrast 1-4px features
    // A pixel is an anchor if it has high rareness (>2.5), decent confidence (>0.3),
    // and contrast against its immediate surroundings.
    let mut protected_mask = vec![false; total_px];

    for y in 0..h {
        let y_prev = y.saturating_sub(1);
        let y_next = (y + 1).min(h - 1);

        for x in 0..w {
            let idx = y * w + x;
            // Protect true isolated, high-contrast features (like 1-2px eyes or highlights),
            // even after scaling or mild blur.
            let is_rare_candidate = rareness[idx] > 2.0 && confidence[idx] > 0.30;

            if !is_rare_candidate {
                continue;
            }

            let my_label = labels[idx];
            let x_prev = x.saturating_sub(1);
            let x_next = (x + 1).min(w - 1);

            // Count how many adjacent pixels share the exact same label in a 3x3 window
            let mut same_label_count = 0usize;
            for ny in [y_prev, y, y_next] {
                for nx in [x_prev, x, x_next] {
                    if labels[ny * w + nx] == my_label {
                        same_label_count += 1;
                    }
                }
            }

            // A genuine 1-2px detail is compact (1 to 4 pixels in 3x3), surrounded by different labels
            if same_label_count >= 1 && same_label_count <= 4 {
                protected_mask[idx] = true;
            }
        }
    }

    LabeledImage {
        labels,
        confidence,
        protected_mask,
    }
}
