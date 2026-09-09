//! Wu Quantization in OKLab space with Saliency Weights.
//! Adapted from Wu (1991) and pixelfixer's wu.rs, extended to accept arbitrary weights
//! and operate in perceptually uniform OKLab color space.

const SIDE: usize = 33; // 32 bins + 1 SAT padding

#[inline]
fn at(i: usize, j: usize, k: usize) -> usize {
    (i * SIDE + j) * SIDE + k
}

type Box6 = (usize, usize, usize, usize, usize, usize);

struct Moments {
    wt: Vec<f64>,
    ml: Vec<f64>,
    ma: Vec<f64>,
    mb: Vec<f64>,
    m2: Vec<f64>,
}

#[inline]
fn oklab_to_bin(lab: [f64; 3]) -> (usize, usize, usize) {
    let l_norm = lab[0].clamp(0.0, 1.0);
    let a_norm = ((lab[1] + 0.4) / 0.8).clamp(0.0, 1.0);
    let b_norm = ((lab[2] + 0.4) / 0.8).clamp(0.0, 1.0);

    let l_bin = ((l_norm * 31.999).floor() as usize).min(31) + 1;
    let a_bin = ((a_norm * 31.999).floor() as usize).min(31) + 1;
    let b_bin = ((b_norm * 31.999).floor() as usize).min(31) + 1;

    (l_bin, a_bin, b_bin)
}

fn build_moments(labs: &[[f64; 3]], weights: &[f64]) -> Moments {
    let n = SIDE * SIDE * SIDE;
    let mut wt = vec![0.0f64; n];
    let mut ml = vec![0.0f64; n];
    let mut ma = vec![0.0f64; n];
    let mut mb = vec![0.0f64; n];
    let mut m2 = vec![0.0f64; n];

    for (i, &lab) in labs.iter().enumerate() {
        let (l_b, a_b, b_b) = oklab_to_bin(lab);
        let idx = at(l_b, a_b, b_b);
        let w = if i < weights.len() { weights[i] } else { 1.0 };
        let (l, a, b_val) = (lab[0], lab[1], lab[2]);

        wt[idx] += w;
        ml[idx] += w * l;
        ma[idx] += w * a;
        mb[idx] += w * b_val;
        m2[idx] += w * (l * l + a * a + b_val * b_val);
    }

    // 3D cumulative sums along axis 0, 1, 2
    for arr in [&mut wt, &mut ml, &mut ma, &mut mb, &mut m2] {
        // axis 0 (L)
        for i in 1..SIDE {
            for j in 0..SIDE {
                for k in 0..SIDE {
                    arr[at(i, j, k)] += arr[at(i - 1, j, k)];
                }
            }
        }
        // axis 1 (a)
        for i in 0..SIDE {
            for j in 1..SIDE {
                for k in 0..SIDE {
                    arr[at(i, j, k)] += arr[at(i, j - 1, k)];
                }
            }
        }
        // axis 2 (b)
        for i in 0..SIDE {
            for j in 0..SIDE {
                for k in 1..SIDE {
                    arr[at(i, j, k)] += arr[at(i, j, k - 1)];
                }
            }
        }
    }

    Moments { wt, ml, ma, mb, m2 }
}

#[inline]
fn box_sum(m: &[f64], bx: Box6) -> f64 {
    let (l0, l1, a0, a1, b0, b1) = bx;
    m[at(l1, a1, b1)] - m[at(l1, a1, b0)] - m[at(l1, a0, b1)] + m[at(l1, a0, b0)]
        - m[at(l0, a1, b1)] + m[at(l0, a1, b0)] + m[at(l0, a0, b1)] - m[at(l0, a0, b0)]
}

fn variance(bx: Box6, m: &Moments) -> f64 {
    let dw = box_sum(&m.wt, bx);
    if dw <= 1e-9 {
        return 0.0;
    }
    let dl = box_sum(&m.ml, bx);
    let da = box_sum(&m.ma, bx);
    let db = box_sum(&m.mb, bx);
    (box_sum(&m.m2, bx) - (dl * dl + da * da + db * db) / dw).max(0.0)
}

fn maximize(bx: Box6, m: &Moments, axis: usize) -> (f64, i64) {
    let (l0, l1, a0, a1, b0, b1) = bx;
    let whole_l = box_sum(&m.ml, bx);
    let whole_a = box_sum(&m.ma, bx);
    let whole_b = box_sum(&m.mb, bx);
    let whole_w = box_sum(&m.wt, bx);
    if whole_w <= 1e-9 {
        return (0.0, -1);
    }

    let (lo, hi) = match axis {
        0 => (l0 + 1, l1),
        1 => (a0 + 1, a1),
        _ => (b0 + 1, b1),
    };
    if lo >= hi {
        return (0.0, -1);
    }

    let mut max_val = 0.0f64;
    let mut best_cut = -1i64;

    for cut in lo..hi {
        let (half_l, half_a, half_b, half_w) = match axis {
            0 => {
                let sub = (l0, cut, a0, a1, b0, b1);
                (box_sum(&m.ml, sub), box_sum(&m.ma, sub), box_sum(&m.mb, sub), box_sum(&m.wt, sub))
            }
            1 => {
                let sub = (l0, l1, a0, cut, b0, b1);
                (box_sum(&m.ml, sub), box_sum(&m.ma, sub), box_sum(&m.mb, sub), box_sum(&m.wt, sub))
            }
            _ => {
                let sub = (l0, l1, a0, a1, b0, cut);
                (box_sum(&m.ml, sub), box_sum(&m.ma, sub), box_sum(&m.mb, sub), box_sum(&m.wt, sub))
            }
        };

        if half_w <= 1e-9 {
            continue;
        }
        let rest_w = whole_w - half_w;
        if rest_w <= 1e-9 {
            continue;
        }

        let rest_l = whole_l - half_l;
        let rest_a = whole_a - half_a;
        let rest_b = whole_b - half_b;

        let val = (half_l * half_l + half_a * half_a + half_b * half_b) / half_w
            + (rest_l * rest_l + rest_a * rest_a + rest_b * rest_b) / rest_w;
        if val > max_val {
            max_val = val;
            best_cut = cut as i64;
        }
    }

    (max_val, best_cut)
}

fn split_box(bx: Box6, m: &Moments) -> (Box6, Box6, f64) {
    let (mut best_val, mut best_cut, mut best_axis) = (0.0f64, -1i64, 0usize);
    for ax in 0..3 {
        let (val, cut) = maximize(bx, m, ax);
        if val > best_val {
            best_val = val;
            best_cut = cut;
            best_axis = ax;
        }
    }
    if best_cut < 0 {
        return (bx, (0, 0, 0, 0, 0, 0), 0.0);
    }

    let (l0, l1, a0, a1, b0, b1) = bx;
    let cut = best_cut as usize;
    let (b1_out, b2_out) = match best_axis {
        0 => ((l0, cut, a0, a1, b0, b1), (cut, l1, a0, a1, b0, b1)),
        1 => ((l0, l1, a0, cut, b0, b1), (l0, l1, cut, a1, b0, b1)),
        _ => ((l0, l1, a0, a1, b0, cut), (l0, l1, a0, a1, cut, b1)),
    };
    (b1_out, b2_out, best_val)
}

pub struct WuPalette {
    /// Palette centroids in OKLab space [L, a, b].
    pub oklab_palette: Vec<[f64; 3]>,
}

/// Quantizes the OKLab image into at most k_colors using weighted Wu Box-Cutting.
pub fn quantize_oklab_weighted(
    labs: &[[f64; 3]],
    weights: &[f64],
    k_colors: usize,
) -> WuPalette {
    let k = k_colors.clamp(2, 256);
    let moments = build_moments(labs, weights);

    let mut boxes = vec![(0usize, 32usize, 0usize, 32usize, 0usize, 32usize)];
    let mut variances = vec![variance(boxes[0], &moments)];

    while boxes.len() < k {
        let mut best_i = None;
        let mut max_var = 0.0f64;
        for (i, &v) in variances.iter().enumerate() {
            if v > max_var {
                max_var = v;
                best_i = Some(i);
            }
        }
        let bi = match best_i {
            Some(i) if max_var > 1e-6 => i,
            _ => break, // No more boxes can be split
        };

        let bx = boxes[bi];
        let (b1, b2, score) = split_box(bx, &moments);
        if score <= 0.0 || b2 == (0, 0, 0, 0, 0, 0) {
            variances[bi] = 0.0;
            continue;
        }

        boxes[bi] = b1;
        variances[bi] = variance(b1, &moments);
        boxes.push(b2);
        variances.push(variance(b2, &moments));
    }

    let mut oklab_palette = Vec::with_capacity(boxes.len());
    for &bx in &boxes {
        let w = box_sum(&moments.wt, bx);
        if w > 1e-9 {
            let l = box_sum(&moments.ml, bx) / w;
            let a = box_sum(&moments.ma, bx) / w;
            let b_val = box_sum(&moments.mb, bx) / w;
            oklab_palette.push([l, a, b_val]);
        } else {
            // Empty box fallback: center of box
            let (l0, l1, a0, a1, b0, b1) = bx;
            let l = ((l0 + l1) as f64 / 64.0).clamp(0.0, 1.0);
            let a = (((a0 + a1) as f64 / 64.0) * 0.8 - 0.4).clamp(-0.4, 0.4);
            let b_val = (((b0 + b1) as f64 / 64.0) * 0.8 - 0.4).clamp(-0.4, 0.4);
            oklab_palette.push([l, a, b_val]);
        }
    }

    if oklab_palette.is_empty() {
        oklab_palette.push([0.5, 0.0, 0.0]);
    }

    WuPalette { oklab_palette }
}
