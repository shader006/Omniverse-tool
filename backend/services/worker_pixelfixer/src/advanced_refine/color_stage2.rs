//! Stage 2: True Color Extraction from Original Un-quantized Pixels.
//! Reconstructs crisp, un-clamped native sprite colors and enforces binary alpha.

use rayon::prelude::*;

fn pyround(v: f64) -> f64 {
    v.round_ties_even()
}

/// Reconstructs the native resolution sprite from original RGBA bytes.
///
/// Each cell receives the center-weighted mean of original pixels carrying the winning label.
/// This prevents color clamping and preserves subtle gradients while delivering clean outlines.
pub fn extract_true_colors(
    raw_rgba: &[u8],
    w: usize,
    h: usize,
    cols: usize,
    rows: usize,
    labels: &[u32],
    win: &[u32],
    ixs: &[usize],
    wxs: &[f64],
    iys: &[usize],
    wys: &[f64],
) -> Vec<u8> {
    let n_cells = cols * rows;

    let mut csum = vec![[0.0f64; 3]; n_cells];
    let mut wden = vec![0.0f64; n_cells];
    let mut selcnt = vec![0.0f64; n_cells];
    let mut msum = vec![[0.0f64; 3]; n_cells];
    let mut cnt = vec![0.0f64; n_cells];
    let mut asum = vec![0.0f64; n_cells];

    for y in 0..h {
        let iy = iys[y];
        let wy = wys[y];
        for x in 0..w {
            let ix = ixs[x];
            let wx = wxs[x];
            let cell = iy * cols + ix;
            let i = y * w + x;
            let p = i * 4;

            let wgt = wy * wx + 1e-4;
            let rgb = [
                raw_rgba[p] as f64 / 255.0,
                raw_rgba[p + 1] as f64 / 255.0,
                raw_rgba[p + 2] as f64 / 255.0,
            ];

            cnt[cell] += 1.0;
            for c in 0..3 {
                msum[cell][c] += rgb[c];
            }
            if raw_rgba[p + 3] > 127 {
                asum[cell] += 1.0;
            }

            // Only accumulate if pixel carries the cell's winning label
            if labels[i] == win[cell] {
                selcnt[cell] += 1.0;
                wden[cell] += wgt;
                for c in 0..3 {
                    csum[cell][c] += rgb[c] * wgt;
                }
            }
        }
    }

    let mut out_rgba = vec![0u8; n_cells * 4];
    for c in 0..n_cells {
        let color = if selcnt[c] >= 0.5 && wden[c] > 1e-9 {
            [csum[c][0] / wden[c], csum[c][1] / wden[c], csum[c][2] / wden[c]]
        } else {
            let cc = cnt[c].max(1.0);
            [msum[c][0] / cc, msum[c][1] / cc, msum[c][2] / cc]
        };

        for ch in 0..3 {
            out_rgba[c * 4 + ch] = pyround(color[ch] * 255.0).clamp(0.0, 255.0) as u8;
        }

        // Binary alpha threshold: solid if > 50% of subpixels are opaque
        out_rgba[c * 4 + 3] = if (asum[c] / cnt[c].max(1.0)) > 0.5 {
            255
        } else {
            0
        };
    }

    out_rgba
}
