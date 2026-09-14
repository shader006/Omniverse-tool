//! Reconstruction: detected grid -> native-resolution pixel art.
//! Mirrors detector/reconstruct.py (color="mode" path; palette_snap is not
//! ported - the server API default is palette_snap=False).

use rayon::prelude::*;
use crate::advanced_refine::oklab::{oklab_distance_sq, rgb_to_oklab};

/// python/np.round banker's rounding
fn pyround(v: f64) -> f64 {
    v.round_ties_even()
}

/// |d1| of luminance (alpha-weighted) summed across the perpendicular axis.
/// axis=0: diff along x, sum over rows -> length w-1 (values f32-rounded).
pub fn axis_profile(rgba: &[u8], w: usize, h: usize, axis: usize) -> Vec<f64> {
    let mut g = vec![0f32; w * h];
    for i in 0..w * h {
        let p = i * 4;
        let a = rgba[p + 3] as f32 / 255.0;
        g[i] = (0.299 * rgba[p] as f32
            + 0.587 * rgba[p + 1] as f32
            + 0.114 * rgba[p + 2] as f32)
            * a;
    }
    if axis == 0 {
        // diff along x, sum over rows (f64 accumulate, f32-rounded like numpy)
        let mut acc = vec![0f64; w - 1];
        for y in 0..h {
            let r = y * w;
            for x in 0..w - 1 {
                acc[x] += (g[r + x + 1] - g[r + x]).abs() as f64;
            }
        }
        acc.iter().map(|&v| v as f32 as f64).collect()
    } else {
        let mut acc = vec![0f64; h - 1];
        for y in 0..h - 1 {
            let r0 = y * w;
            let r1 = (y + 1) * w;
            let mut s = 0f64;
            for x in 0..w {
                s += (g[r1 + x] - g[r0 + x]).abs() as f64;
            }
            acc[y] = s as f32 as f64;
        }
        acc
    }
}

/// Integral images for within-cell variance of arbitrary cut sets.
struct Sat {
    s1: Vec<[f64; 3]>, // (h+1)*(w+1)
    s2: Vec<f64>,
    w: usize,
    h: usize,
}

impl Sat {
    fn new(rgba: &[u8], w: usize, h: usize) -> Sat {
        let stride = w + 1;
        let mut s1 = vec![[0f64; 3]; (h + 1) * stride];
        let mut s2 = vec![0f64; (h + 1) * stride];
        for y in 0..h {
            let mut row1 = [0f64; 3];
            let mut row2 = 0f64;
            for x in 0..w {
                let p = (y * w + x) * 4;
                let r = rgba[p] as f64;
                let g = rgba[p + 1] as f64;
                let b = rgba[p + 2] as f64;
                row1[0] += r;
                row1[1] += g;
                row1[2] += b;
                row2 += r * r + g * g + b * b;
                let up = (y) * stride + (x + 1);
                let cur = (y + 1) * stride + (x + 1);
                s1[cur] = [
                    s1[up][0] + row1[0],
                    s1[up][1] + row1[1],
                    s1[up][2] + row1[2],
                ];
                s2[cur] = s2[up] + row2;
            }
        }
        Sat { s1, s2, w, h }
    }

    fn cell_var(&self, xs: &[i64], ys: &[i64]) -> f64 {
        let stride = self.w + 1;
        let mut num = 0f64;
        let mut den = 0f64;
        for yi in 0..ys.len() - 1 {
            let (y0, y1) = (ys[yi] as usize, ys[yi + 1] as usize);
            for xi in 0..xs.len() - 1 {
                let (x0, x1) = (xs[xi] as usize, xs[xi + 1] as usize);
                let idx = |y: usize, x: usize| y * stride + x;
                let a = idx(y0, x0);
                let b = idx(y0, x1);
                let c = idx(y1, x0);
                let d = idx(y1, x1);
                let s2 = self.s2[d] - self.s2[b] - self.s2[c] + self.s2[a];
                let area = (((y1 - y0) * (x1 - x0)) as f64).max(1.0);
                let mut m2 = 0f64;
                for ch in 0..3 {
                    let s1 = self.s1[d][ch] - self.s1[b][ch] - self.s1[c][ch]
                        + self.s1[a][ch];
                    let m = s1 / area;
                    m2 += m * m;
                }
                let v = s2 / area - m2;
                num += v * area;
                den += area;
            }
        }
        num / den.max(1e-12)
    }
}

/// unique(clip(round(arange(phase, extent+step, step)),0,extent)) with 0 front
fn phase_cuts(phase: f64, extent: usize, step: f64) -> Vec<i64> {
    let stop = extent as f64 + step;
    let n = ((stop - phase) / step).ceil().max(0.0) as usize;
    let mut v: Vec<i64> = (0..n)
        .map(|i| pyround(phase + i as f64 * step).clamp(0.0, extent as f64) as i64)
        .collect();
    v.sort_unstable();
    v.dedup();
    if v.first() != Some(&0) {
        v.insert(0, 0);
    }
    v
}

/// Grid phase minimizing within-cell variance (coarse 5x5 SAT sweep).
fn best_phase(sat: &Sat, step_x: f64, step_y: f64) -> (f64, f64) {
    let n = 5;
    let mut best = (0f64, 0f64, f64::INFINITY);
    for iy in 0..n {
        let py = iy as f64 * (step_y / n as f64);
        let ys = phase_cuts(py, sat.h, step_y);
        for ix in 0..n {
            let px = ix as f64 * (step_x / n as f64);
            let xs = phase_cuts(px, sat.w, step_x);
            let v = sat.cell_var(&xs, &ys);
            if v < best.2 {
                best = (px, py, v);
            }
        }
    }
    (best.0, best.1)
}

/// (phase, strength): sub-pixel comb phase of the cut-energy profile.
pub fn comb_phase(profile: &[f64], step: f64) -> (f64, f64) {
    let n = profile.len();
    if step < 1.5 || (n as f64) < 3.0 * step {
        return (0.0, 0.0);
    }
    let n_ph = std::cmp::max(8, pyround(step * 4.0) as usize);
    let kmax = ((n as f64 - 2.0) / step) as usize; // ks = 0..=kmax
    let mut resp = vec![0f64; n_ph];
    for b in 0..n_ph {
        let phase = b as f64 * (step / n_ph as f64);
        let mut acc = 0f64;
        let mut cnt = 0usize;
        for k in 0..=kmax {
            let pos = phase + k as f64 * step;
            if pos <= n as f64 - 2.0 {
                let i0 = (pos as i64).clamp(0, n as i64 - 2) as usize;
                let f = pos - i0 as f64;
                acc += profile[i0] * (1.0 - f) + profile[i0 + 1] * f;
                cnt += 1;
            }
        }
        resp[b] = acc / cnt.max(1) as f64;
    }
    let mut b = 0;
    for i in 0..n_ph {
        if resp[i] > resp[b] {
            b = i;
        }
    }
    let mean = resp.iter().sum::<f64>() / n_ph as f64;
    let strength = resp[b] / (mean + 1e-9);
    let lo = resp[(b + n_ph - 1) % n_ph];
    let hi = resp[(b + 1) % n_ph];
    let denom = lo - 2.0 * resp[b] + hi;
    let d = if denom.abs() > 1e-12 {
        (0.5 * (lo - hi) / denom).clamp(-1.0, 1.0)
    } else {
        0.0
    };
    let ph = (b as f64 * (step / n_ph as f64) + d * (step / n_ph as f64)).rem_euclid(step);
    (ph, strength)
}

/// Exactly n_cells+1 cuts: lattice targets phase+k*step, interior cuts
/// snapped to the local |d1| max, sliver-guarded (min gap 55% of step).
fn snapped_cuts(profile: &[f64], step: f64, phase: f64, extent: usize, n_cells: usize) -> Vec<i64> {
    let mut cuts = vec![0i64; n_cells + 1];
    cuts[n_cells] = extent as i64;
    let rad = std::cmp::max(1, pyround(step * 0.30) as i64);
    let prof_mean = if profile.is_empty() {
        0.0
    } else {
        profile.iter().sum::<f64>() / profile.len() as f64
    };
    let min_gap = std::cmp::max(1, (0.55 * step).floor() as i64);
    let first = phase.rem_euclid(step);
    let base = if first >= 0.5 * step { first } else { first + step };
    let mut prev = 0i64;
    for j in 1..n_cells {
        let t = base + (j as f64 - 1.0) * step;
        let mut c = pyround(t.max(1.0).min(extent as f64 - 1.0)) as i64;
        let lo = std::cmp::max(prev + min_gap, c - rad);
        let hi = *[
            extent as i64 - 1,
            c + rad,
            extent as i64 - (n_cells - j) as i64 * min_gap,
        ]
        .iter()
        .min()
        .unwrap();
        if hi < lo {
            c = std::cmp::min(prev + min_gap, extent as i64 - (n_cells - j) as i64);
        } else {
            let seg = &profile[lo as usize..=(hi as usize)];
            let smax = seg.iter().cloned().fold(f64::MIN, f64::max);
            if !seg.is_empty() && smax >= 0.5 * prof_mean && smax > 1e-9 {
                let mut am = 0;
                for i in 0..seg.len() {
                    if seg[i] > seg[am] {
                        am = i;
                    }
                }
                c = lo + am as i64;
            } else {
                c = c.clamp(lo, hi);
            }
        }
        c = std::cmp::max(
            std::cmp::min(c, extent as i64 - (n_cells - j) as i64),
            prev + 1,
        );
        cuts[j] = c;
        prev = c;
    }
    cuts
}

/// Bend global cut lines into per-band polylines.
/// Returns (band_edges, cuts[n_bands][n_cuts] as f64).
fn banded_cuts(
    rgba: &[u8],
    w: usize,
    h: usize,
    base_cuts: &[i64],
    step: f64,
    axis: usize,
) -> (Vec<usize>, Vec<Vec<f64>>) {
    let perp = if axis == 0 { h } else { w };
    let extent = if axis == 0 { w } else { h };
    let n_bands = ((perp as f64 / (step * 7.0)).clamp(1.0, 12.0)) as usize;
    let bstep = perp as f64 / n_bands as f64;
    let edges: Vec<usize> = (0..=n_bands)
        .map(|i| (i as f64 * bstep) as usize)
        .collect();
    if n_bands <= 1 {
        return (edges, vec![base_cuts.iter().map(|&c| c as f64).collect()]);
    }

    let mut g = vec![0f32; w * h];
    for i in 0..w * h {
        let p = i * 4;
        let a = rgba[p + 3] as f32 / 255.0;
        g[i] = (0.299 * rgba[p] as f32
            + 0.587 * rgba[p + 1] as f32
            + 0.114 * rgba[p + 2] as f32)
            * a;
    }

    let rad = std::cmp::max(1, pyround(step * 0.3) as i64);
    let min_gap = std::cmp::max(1, (0.55 * step).floor() as i64) as f64;
    let n_cuts = base_cuts.len();
    let mut cuts: Vec<Vec<f64>> = (0..n_bands)
        .map(|_| base_cuts.iter().map(|&c| c as f64).collect())
        .collect();

    let profs: Vec<Vec<f64>> = (0..n_bands)
        .into_par_iter()
        .map(|b| {
            // prof[c] = |d1| energy of a cut between positions c-1 and c
            let mut prof = vec![0f64; extent];
            if axis == 0 {
                for y in edges[b]..edges[b + 1] {
                    let r = y * w;
                    for x in 0..w - 1 {
                        prof[x + 1] += (g[r + x + 1] - g[r + x]).abs() as f64;
                    }
                }
            } else {
                for y in 0..h - 1 {
                    let r0 = y * w;
                    let r1 = (y + 1) * w;
                    let mut s = 0f64;
                    for x in edges[b]..edges[b + 1] {
                        s += (g[r1 + x] - g[r0 + x]).abs() as f64;
                    }
                    prof[y + 1] = s as f32 as f64;
                }
            }
            if axis == 0 {
                // f32-round the row-summed profile like numpy
                for v in prof.iter_mut() {
                    *v = *v as f32 as f64;
                }
            }
            prof
        })
        .collect();

    for b in 0..n_bands {
        let prof = &profs[b];
        let pmean = prof.iter().sum::<f64>() / prof.len() as f64;
        for j in 1..n_cuts - 1 {
            let c = base_cuts[j];
            let lo = std::cmp::max(cuts[b][j - 1] as i64 + min_gap as i64, c - rad);
            let hi = *[extent as i64 - 1, c + rad, base_cuts[j + 1] - 1]
                .iter()
                .min()
                .unwrap();
            if hi <= lo {
                cuts[b][j] = (cuts[b][j - 1] + min_gap).max((c as f64).min(extent as f64 - 1.0));
                continue;
            }
            let sl = &prof[lo as usize..=(hi as usize)];
            let smax = sl.iter().cloned().fold(f64::MIN, f64::max);
            if !sl.is_empty() && smax >= 0.5 * pmean && smax > 1e-9 {
                let mut am = 0;
                for i in 0..sl.len() {
                    if sl[i] > sl[am] {
                        am = i;
                    }
                }
                cuts[b][j] = (lo + am as i64) as f64;
            } else {
                cuts[b][j] = (c as f64).clamp(lo as f64, hi as f64);
            }
        }
    }
    if n_bands >= 3 {
        let orig = cuts.clone();
        for b in 1..n_bands - 1 {
            for j in 0..n_cuts {
                cuts[b][j] = 0.5 * orig[b][j] + 0.25 * (orig[b - 1][j] + orig[b + 1][j]);
            }
        }
    }
    for b in 0..n_bands {
        for j in 1..n_cuts {
            if cuts[b][j] < cuts[b][j - 1] {
                cuts[b][j] = cuts[b][j - 1];
            }
        }
        cuts[b][0] = 0.0;
        cuts[b][n_cuts - 1] = extent as f64;
    }
    (edges, cuts)
}

/// searchsorted(a, v, side="right") - 1
fn cell_of(a: &[f64], v: f64) -> i64 {
    let mut lo = 0usize;
    let mut hi = a.len();
    while lo < hi {
        let mid = (lo + hi) / 2;
        if a[mid] <= v {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    lo as i64 - 1
}

/// Per-pixel warped cell index along one axis from banded cut polylines.
/// Returns (perp_len x extent) row-major.
fn warped_index(
    bands: &[Vec<f64>],
    edges: &[usize],
    perp_len: usize,
    extent: usize,
    n_cells: usize,
) -> Vec<i64> {
    let n_b = bands.len();
    let n_cuts = bands[0].len();
    let mut out = vec![0i64; perp_len * extent];
    if n_b == 1 {
        let row: Vec<i64> = (0..extent)
            .map(|x| cell_of(&bands[0], x as f64 + 0.5).clamp(0, n_cells as i64 - 1))
            .collect();
        for r in 0..perp_len {
            out[r * extent..(r + 1) * extent].copy_from_slice(&row);
        }
        return out;
    }
    let centers: Vec<f64> = (0..n_b)
        .map(|i| (edges[i] + edges[i + 1]) as f64 / 2.0)
        .collect();
    out.par_chunks_mut(extent).enumerate().for_each(|(r, orow)| {
        let t = r as f64;
        // continuous polyline positions at this scanline (monotone-forced)
        let mut line = vec![0f64; n_cuts];
        // np.interp over band centers with clamped extrapolation
        let seg = if t <= centers[0] {
            0
        } else if t >= centers[n_b - 1] {
            n_b - 1
        } else {
            let mut s = 0;
            while s + 1 < n_b && centers[s + 1] < t {
                s += 1;
            }
            s
        };
        for j in 0..n_cuts {
            let v = if t <= centers[0] {
                bands[0][j]
            } else if t >= centers[n_b - 1] {
                bands[n_b - 1][j]
            } else {
                let f = (t - centers[seg]) / (centers[seg + 1] - centers[seg]);
                bands[seg][j] * (1.0 - f) + bands[seg + 1][j] * f
            };
            line[j] = if j > 0 && v < line[j - 1] { line[j - 1] } else { v };
        }
        for x in 0..extent {
            orow[x] = cell_of(&line, x as f64 + 0.5).clamp(0, n_cells as i64 - 1);
        }
    });
    out
}

pub struct ReconOut {
    pub rgba: Vec<u8>, // ncx * ncy * 4
    pub cols: usize,
    pub rows: usize,
}

pub fn reconstruct(
    rgba: &[u8],
    w: usize,
    h: usize,
    step_x: f64,
    step_y: f64,
    cols: usize,
    rows: usize,
    dark_stroke: bool,
    auto_palette: bool,
) -> ReconOut {
    let sat = Sat::new(rgba, w, h);

    // profile[c] = |d1| energy of a cut between columns c-1 and c
    let mut prof_x = vec![0f64];
    prof_x.extend(axis_profile(rgba, w, h, 0));
    let mut prof_y = vec![0f64];
    prof_y.extend(axis_profile(rgba, w, h, 1));

    let (mut px, sx_str) = comb_phase(&prof_x, step_x);
    let (mut py, sy_str) = comb_phase(&prof_y, step_y);
    if sx_str.min(sy_str) < 1.35 {
        let bp = best_phase(&sat, step_x, step_y);
        px = bp.0;
        py = bp.1;
    }

    // candidate cut sets: snapped / phase lattice / phase-0 lattice
    let flat_x = vec![0f64; prof_x.len()];
    let flat_y = vec![0f64; prof_y.len()];
    let cand_x = [
        snapped_cuts(&prof_x, step_x, px, w, cols),
        snapped_cuts(&flat_x, step_x, px, w, cols),
        snapped_cuts(&flat_x, step_x, 0.0, w, cols),
    ];
    let cand_y = [
        snapped_cuts(&prof_y, step_y, py, h, rows),
        snapped_cuts(&flat_y, step_y, py, h, rows),
        snapped_cuts(&flat_y, step_y, 0.0, h, rows),
    ];
    let mut xs = &cand_x[0];
    {
        let mut best = f64::INFINITY;
        for c in cand_x.iter() {
            let v = sat.cell_var(c, &cand_y[2]);
            if v < best {
                best = v;
                xs = c;
            }
        }
    }
    let mut ys = &cand_y[0];
    {
        let mut best = f64::INFINITY;
        for c in cand_y.iter() {
            let v = sat.cell_var(xs, c);
            if v < best {
                best = v;
                ys = c;
            }
        }
    }
    let xs = xs.clone();
    let ys = ys.clone();

    let ncx = xs.len() - 1;
    let ncy = ys.len() - 1;
    let n = ncx * ncy;
    let xsf: Vec<f64> = xs.iter().map(|&v| v as f64).collect();
    let ysf: Vec<f64> = ys.iter().map(|&v| v as f64).collect();
    let ix: Vec<i64> = (0..w)
        .map(|x| cell_of(&xsf, x as f64).clamp(0, ncx as i64 - 1))
        .collect();
    let iy: Vec<i64> = (0..h)
        .map(|y| cell_of(&ysf, y as f64).clamp(0, ncy as i64 - 1))
        .collect();
    let mut cell: Vec<i64> = Vec::with_capacity(w * h);
    for y in 0..h {
        for x in 0..w {
            cell.push(iy[y] * ncx as i64 + ix[x]);
        }
    }

    // rgb in [0,1]
    let rgb: Vec<[f64; 3]> = (0..w * h)
        .map(|i| {
            let p = i * 4;
            [
                rgba[p] as f64 / 255.0,
                rgba[p + 1] as f64 / 255.0,
                rgba[p + 2] as f64 / 255.0,
            ]
        })
        .collect();

    let pooled_var = |cell_idx: &[i64]| -> f64 {
        let mut c1 = vec![0f64; n];
        let mut m = vec![[0f64; 3]; n];
        let mut q = vec![[0f64; 3]; n];
        for (i, &ci) in cell_idx.iter().enumerate() {
            let ci = ci as usize;
            c1[ci] += 1.0;
            for ch in 0..3 {
                m[ci][ch] += rgb[i][ch];
                q[ci][ch] += rgb[i][ch] * rgb[i][ch];
            }
        }
        let mut num = 0f64;
        let mut den = 0f64;
        for ci in 0..n {
            let c = c1[ci].max(1.0);
            let mut v = 0f64;
            for ch in 0..3 {
                let mm = m[ci][ch] / c;
                let qq = q[ci][ch] / c;
                v += (qq - mm * mm).max(0.0);
            }
            num += v * c;
            den += c;
        }
        num / den.max(1e-12)
    };

    // banded (warped) refinement, adopted only when variance drops >= 0.5%
    {
        let ((x_edges, xs_b), (y_edges, ys_b)) = rayon::join(
            || banded_cuts(rgba, w, h, &xs, step_x, 0),
            || banded_cuts(rgba, w, h, &ys, step_y, 1),
        );
        if xs_b.len() > 1 || ys_b.len() > 1 {
            let (ixw, iyw) = rayon::join(
                || warped_index(&xs_b, &x_edges, h, w, ncx),
                || warped_index(&ys_b, &y_edges, w, h, ncy),
            );
            // iyw is (w, h) row-major; transpose access
            let mut cell_w: Vec<i64> = Vec::with_capacity(w * h);
            for y in 0..h {
                for x in 0..w {
                    cell_w.push(iyw[x * h + y] * ncx as i64 + ixw[y * w + x]);
                }
            }
            if pooled_var(&cell_w) < 0.995 * pooled_var(&cell) {
                cell = cell_w;
            }
        }
    }

    // center weights: triangular within each straight-cut cell span
    let mut wx = vec![0f64; w];
    for x in 0..w {
        let i = ix[x] as usize;
        let lo = xs[i] as f64;
        let hi = xs[i + 1] as f64;
        let f = (x as f64 + 0.5 - lo) / (hi - lo).max(1.0);
        wx[x] = 1.0 - 2.0 * (f - 0.5).abs();
    }
    let mut wy = vec![0f64; h];
    for y in 0..h {
        let i = iy[y] as usize;
        let lo = ys[i] as f64;
        let hi = ys[i + 1] as f64;
        let f = (y as f64 + 0.5 - lo) / (hi - lo).max(1.0);
        wy[y] = 1.0 - 2.0 * (f - 0.5).abs();
    }
    let wgt: Vec<f64> = (0..w * h)
        .map(|i| wy[i / w] * wx[i % w] + 1e-4)
        .collect();

    let mut cnt = vec![0f64; n];
    let mut mean = vec![[0f64; 3]; n];
    for (i, &ci) in cell.iter().enumerate() {
        let ci = ci as usize;
        cnt[ci] += 1.0;
        for ch in 0..3 {
            mean[ci][ch] += rgb[i][ch];
        }
    }
    let cnt: Vec<f64> = cnt.iter().map(|&c| c.max(1.0)).collect();
    for ci in 0..n {
        for ch in 0..3 {
            mean[ci][ch] /= cnt[ci];
        }
    }

    // ---- 5-bit binned local mode with center-weighted votes
    let key: Vec<u32> = (0..w * h)
        .map(|i| {
            let p = i * 4;
            (((rgba[p] as u32) >> 3) << 10)
                | (((rgba[p + 1] as u32) >> 3) << 5)
                | ((rgba[p + 2] as u32) >> 3)
        })
        .collect();
    // global per-bin mean colors
    let mut gcnt = vec![0f64; 32768];
    let mut gmean = vec![[0f64; 3]; 32768];
    for i in 0..w * h {
        let k = key[i] as usize;
        gcnt[k] += 1.0;
        for ch in 0..3 {
            gmean[k][ch] += rgb[i][ch];
        }
    }
    for k in 0..32768 {
        let c = gcnt[k].max(1.0);
        for ch in 0..3 {
            gmean[k][ch] /= c;
        }
    }

    // per-cell winning bin: max weighted vote, ties -> larger bin key
    let binned_mode = |sel: &dyn Fn(usize) -> bool| -> Vec<Option<u32>> {
        use std::collections::HashMap;
        let mut votes: HashMap<u64, f64> = HashMap::new();
        for i in 0..w * h {
            if sel(i) {
                let comp = (cell[i] as u64) * 32768 + key[i] as u64;
                *votes.entry(comp).or_insert(0.0) += wgt[i];
            }
        }
        let mut win: Vec<Option<(f64, u32)>> = vec![None; n];
        let mut comps: Vec<(&u64, &f64)> = votes.iter().collect();
        comps.sort_by_key(|(c, _)| **c); // ascending comp = lexsort tiebreak
        for (&comp, &v) in comps {
            let ci = (comp / 32768) as usize;
            let k = (comp % 32768) as u32;
            match win[ci] {
                Some((bv, _)) if v < bv => {}
                Some((bv, _)) if v == bv => win[ci] = Some((v, k)), // last wins
                _ if win[ci].is_some() && win[ci].unwrap().0 > v => {}
                _ => win[ci] = Some((v, k)),
            }
        }
        win.iter().map(|o| o.map(|(_, k)| k)).collect()
    };

    let all_win = binned_mode(&|_| true);
    let mut out: Vec<[f64; 3]> = (0..n)
        .map(|ci| match all_win[ci] {
            Some(k) => gmean[k as usize],
            None => mean[ci],
        })
        .collect();

    if dark_stroke {
        let t_thr = 38.0 / 255.0;
        let luma_px: Vec<f64> = rgb
            .iter()
            .map(|c| 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2])
            .collect();
        let mut min_luma = vec![2.0f64; n];
        for i in 0..w * h {
            let ci = cell[i] as usize;
            if luma_px[i] < min_luma[ci] {
                min_luma[ci] = luma_px[i];
            }
        }
        let dark_px: Vec<bool> = (0..w * h)
            .map(|i| {
                let ci = cell[i] as usize;
                luma_px[i] <= min_luma[ci] + (8.0 / 255.0f64).max(0.35 * t_thr)
            })
            .collect();
        let mut dark_cnt = vec![0f64; n];
        for i in 0..w * h {
            if dark_px[i] {
                dark_cnt[cell[i] as usize] += 1.0;
            }
        }
        let need: Vec<bool> = (0..n)
            .map(|ci| {
                let out_luma = 0.299 * out[ci][0] + 0.587 * out[ci][1] + 0.114 * out[ci][2];
                out_luma - min_luma[ci] >= t_thr
                    && dark_cnt[ci] >= (2.0f64).max(0.08 * cnt[ci])
                    && dark_cnt[ci] <= (0.42 * cnt[ci]).ceil()
            })
            .collect();
        let any_sel = (0..w * h).any(|i| need[cell[i] as usize] && dark_px[i]);
        if any_sel {
            let dark_win = binned_mode(&|i| need[cell[i] as usize] && dark_px[i]);
            for ci in 0..n {
                if need[ci] {
                    if let Some(k) = dark_win[ci] {
                        out[ci] = gmean[k as usize];
                    }
                }
            }
        }
    }

    // OPTIMAL PALETTE: snap the (structurally correct but color-muddy) mode
    // output onto a small Wu palette. K is detected on this already-denoised
    // 1x output (reliable), so soft AA boundary cells collapse onto real
    // pixel-art colors: crisp detail + a flat palette. See detector/wu.py.
    if auto_palette {
        let wpx: Vec<[u8; 3]> = (0..n)
            .map(|ci| {
                [
                    pyround(out[ci][0] * 255.0).clamp(0.0, 255.0) as u8,
                    pyround(out[ci][1] * 255.0).clamp(0.0, 255.0) as u8,
                    pyround(out[ci][2] * 255.0).clamp(0.0, 255.0) as u8,
                ]
            })
            .collect();
        let k = crate::wu::elbow_color_count(&wpx, 64);
        let (pal, labels) = crate::wu::quantize(&wpx, k);
        for ci in 0..n {
            out[ci] = pal[labels[ci]];
        }
    }

    // alpha: majority of pixels with a > 127
    let mut asum = vec![0f64; n];
    for i in 0..w * h {
        if rgba[i * 4 + 3] > 127 {
            asum[cell[i] as usize] += 1.0;
        }
    }

    let mut out_rgba = vec![0u8; n * 4];
    for ci in 0..n {
        for ch in 0..3 {
            // np.rint = banker's rounding
            out_rgba[ci * 4 + ch] = pyround(out[ci][ch] * 255.0).clamp(0.0, 255.0) as u8;
        }
        out_rgba[ci * 4 + 3] = if asum[ci] / cnt[ci] > 0.5 { 255 } else { 0 };
    }
    ReconOut { rgba: out_rgba, cols: ncx, rows: ncy }
}

/// Two-stage packing on a regular even grid (mirrors
/// Uniform grid cuts: divides limit into cells segments.
pub fn uniform_grid_cuts(limit: usize, cells: usize) -> Vec<usize> {
    if cells == 0 || limit == 0 {
        return vec![0];
    }
    let mut cuts = Vec::with_capacity(cells + 1);
    for i in 0..=cells {
        let pos = (i as f64 * limit as f64 / cells as f64).round() as usize;
        cuts.push(pos.min(limit));
    }
    cuts
}

/// Ensures cuts are monotonically strictly increasing, with cut[0] = 0 and cut[cells] = limit.
pub fn sanitize_grid_cuts(cuts: &mut [usize], limit: usize, cells: usize) {
    if cuts.len() != cells + 1 || cells == 0 {
        return;
    }
    cuts[0] = 0;
    cuts[cells] = limit;
    for index in 1..cells {
        let minimum = cuts[index - 1] + 1;
        let maximum = limit.saturating_sub(cells - index);
        if cuts[index] < minimum {
            cuts[index] = minimum;
        } else if cuts[index] > maximum {
            cuts[index] = maximum;
        }
    }
}

/// Computes elastic grid cuts by searching for local gradient/edge peaks around expected cell boundaries.
pub fn elastic_grid_cuts(
    profile: &[f64],
    limit: usize,
    cells: usize,
    origin: f64,
    cell_size: f64,
) -> Vec<usize> {
    if cells == 0 || limit == 0 {
        return vec![0];
    }
    let mut cuts = uniform_grid_cuts(limit, cells);
    if profile.is_empty() {
        return cuts;
    }

    let search_ratio = 0.35f64;
    let min_window = 2.0f64;
    let window = (cell_size * search_ratio).max(min_window);
    let mean_strength = profile.iter().sum::<f64>() / profile.len() as f64;
    let strength_gate = mean_strength * 0.50;

    for index in 1..cells {
        let target = origin + index as f64 * cell_size;
        let fallback = (target.round() as usize).clamp(index, limit.saturating_sub(cells - index));
        let start_cut = ((target - window).floor() as isize).max(index as isize) as usize;
        let end_cut = ((target + window).ceil() as isize).min(limit.saturating_sub(cells - index) as isize) as usize;

        if end_cut < start_cut {
            cuts[index] = fallback;
            continue;
        }

        let start_profile = start_cut.saturating_sub(1);
        let end_profile = (end_cut.saturating_sub(1)).min(profile.len().saturating_sub(1));
        if end_profile < start_profile {
            cuts[index] = fallback;
            continue;
        }

        let span = &profile[start_profile..=end_profile];
        if span.is_empty() {
            cuts[index] = fallback;
            continue;
        }

        let mut best_offset = 0;
        let mut best_value = span[0];
        for (offset, &val) in span.iter().enumerate() {
            if val > best_value {
                best_value = val;
                best_offset = offset;
            }
        }

        cuts[index] = if best_value >= strength_gate {
            start_profile + best_offset + 1
        } else {
            fallback
        };
    }

    sanitize_grid_cuts(&mut cuts, limit, cells);
    cuts
}

/// Stabilizes elastic grid cuts to prevent excessive cell size distortion.
pub fn stabilize_grid_cuts(mut cuts: Vec<usize>, limit: usize, cells: usize) -> Vec<usize> {
    sanitize_grid_cuts(&mut cuts, limit, cells);
    if cells <= 1 {
        return cuts;
    }

    let mut widths = Vec::with_capacity(cells);
    for i in 0..cells {
        widths.push((cuts[i + 1].saturating_sub(cuts[i])).max(1) as f64);
    }

    let min_w = widths.iter().cloned().fold(f64::INFINITY, f64::min);
    let max_w = widths.iter().cloned().fold(0.0f64, f64::max);
    let expected = limit as f64 / cells as f64;

    let max_deviation = widths
        .iter()
        .map(|&w| (w - expected).abs() / expected.max(1.0))
        .fold(0.0f64, f64::max);
    let ratio = max_w / min_w.max(1.0);

    // Conservative bounds (matching pixel-art-lab)
    if ratio <= 1.80 && max_deviation <= 0.62 {
        return cuts;
    }

    // Blend elastic with uniform if deviation is moderate, or fallback to uniform
    let uniform = uniform_grid_cuts(limit, cells);
    if ratio <= 2.25 && max_deviation <= 0.90 {
        let mut blended = Vec::with_capacity(cells + 1);
        for i in 0..=cells {
            let b = (cuts[i] as f64 * 0.60 + uniform[i] as f64 * 0.40).round() as usize;
            blended.push(b);
        }
        sanitize_grid_cuts(&mut blended, limit, cells);
        return blended;
    }

    uniform
}

/// Computes horizontal and vertical cell indices and triangular center-weights
/// for either a standard uniform grid or an elastic data-driven cut grid.
pub fn compute_spatial_grid(
    rgba: &[u8],
    w: usize,
    h: usize,
    cols: usize,
    rows: usize,
    elastic: bool,
    offset_x: f64,
    offset_y: f64,
) -> (Vec<usize>, Vec<f64>, Vec<usize>, Vec<f64>) {
    if elastic {
        let prof_x = axis_profile(rgba, w, h, 0);
        let prof_y = axis_profile(rgba, w, h, 1);
        let cell_w = w as f64 / cols as f64;
        let cell_h = h as f64 / rows as f64;
        let origin_x = if offset_x.abs() > 1e-4 { offset_x } else { comb_phase(&prof_x, cell_w).0 };
        let origin_y = if offset_y.abs() > 1e-4 { offset_y } else { comb_phase(&prof_y, cell_h).0 };

        let col_cuts = stabilize_grid_cuts(
            elastic_grid_cuts(&prof_x, w, cols, origin_x, cell_w),
            w,
            cols,
        );
        let row_cuts = stabilize_grid_cuts(
            elastic_grid_cuts(&prof_y, h, rows, origin_y, cell_h),
            h,
            rows,
        );

        let mut ixs = vec![0usize; w];
        let mut wxs = vec![0f64; w];
        for x in 0..w {
            let mut ix = cols - 1;
            for i in 0..cols {
                if x < col_cuts[i + 1] {
                    ix = i;
                    break;
                }
            }
            ixs[x] = ix;
            let c0 = col_cuts[ix] as f64;
            let c1 = col_cuts[ix + 1] as f64;
            let span = (c1 - c0).max(1.0);
            let fx = (x as f64 + 0.5 - c0) / span;
            wxs[x] = 1.0 - 2.0 * (fx - 0.5).abs();
        }

        let mut iys = vec![0usize; h];
        let mut wys = vec![0f64; h];
        for y in 0..h {
            let mut iy = rows - 1;
            for i in 0..rows {
                if y < row_cuts[i + 1] {
                    iy = i;
                    break;
                }
            }
            iys[y] = iy;
            let r0 = row_cuts[iy] as f64;
            let r1 = row_cuts[iy + 1] as f64;
            let span = (r1 - r0).max(1.0);
            let fy = (y as f64 + 0.5 - r0) / span;
            wys[y] = 1.0 - 2.0 * (fy - 0.5).abs();
        }

        (ixs, wxs, iys, wys)
    } else {
        let cw = w as f64 / cols as f64;
        let ch = h as f64 / rows as f64;
        let off_x = offset_x.rem_euclid(cw);
        let off_y = offset_y.rem_euclid(ch);

        let mut ixs = vec![0usize; w];
        let mut wxs = vec![0f64; w];
        for x in 0..w {
            let fx_coord = (x as f64 - off_x) / cw;
            let ix = (fx_coord.floor() as isize).clamp(0, (cols - 1) as isize) as usize;
            ixs[x] = ix;
            let center_x = off_x + (ix as f64 + 0.5) * cw;
            let fx = 0.5 + (x as f64 + 0.5 - center_x) / cw;
            wxs[x] = (1.0 - 2.0 * (fx - 0.5).abs()).max(0.0);
        }
        let mut iys = vec![0usize; h];
        let mut wys = vec![0f64; h];
        for y in 0..h {
            let fy_coord = (y as f64 - off_y) / ch;
            let iy = (fy_coord.floor() as isize).clamp(0, (rows - 1) as isize) as usize;
            iys[y] = iy;
            let center_y = off_y + (iy as f64 + 0.5) * ch;
            let fy = 0.5 + (y as f64 + 0.5 - center_y) / ch;
            wys[y] = (1.0 - 2.0 * (fy - 0.5).abs()).max(0.0);
        }

        (ixs, wxs, iys, wys)
    }
}

/// detector.reconstruct.two_stage_pack).
///
/// Cell features computed from raw spatial sampling.
#[derive(Clone, Debug)]
pub struct CellFeatures {
    pub cell_lab: Vec<[f64; 3]>,
    pub probs: Vec<f64>,
    pub confidences: Vec<f64>,
}

/// Precomputed directional edge gates between neighboring cells.
#[derive(Clone, Debug)]
pub struct DirectionalEdgeGates {
    pub h_gates: Vec<f64>,
    pub v_gates: Vec<f64>,
    pub cols: usize,
    pub rows: usize,
}

impl DirectionalEdgeGates {
    #[inline]
    pub fn get_h(&self, cx: usize, cy: usize) -> f64 {
        if cx + 1 < self.cols && cy < self.rows {
            self.h_gates[cy * (self.cols - 1) + cx]
        } else {
            0.0
        }
    }

    #[inline]
    pub fn get_v(&self, cx: usize, cy: usize) -> f64 {
        if cx < self.cols && cy + 1 < self.rows {
            self.v_gates[cy * self.cols + cx]
        } else {
            0.0
        }
    }

    #[inline]
    pub fn get_gate(
        &self,
        cx: usize,
        cy: usize,
        nx: usize,
        ny: usize,
        cell_lab: &[[f64; 3]],
        edge_k: f64,
    ) -> f64 {
        if cx == nx && cy == ny {
            return 1.0;
        }
        if cy == ny {
            let x_left = cx.min(nx);
            self.get_h(x_left, cy)
        } else if cx == nx {
            let y_top = cy.min(ny);
            self.get_v(cx, y_top)
        } else {
            let c_idx = cy * self.cols + cx;
            let n_idx = ny * self.cols + nx;
            let d_direct = oklab_distance_sq(cell_lab[c_idx], cell_lab[n_idx]).sqrt();
            let g_direct = (-edge_k * d_direct).exp();

            let g_ortho1 = if nx > cx {
                self.get_h(cx, cy)
            } else {
                self.get_h(nx, cy)
            };
            let g_ortho2 = if ny > cy {
                self.get_v(cx, cy)
            } else {
                self.get_v(cx, ny)
            };

            g_direct * g_ortho1.max(g_ortho2)
        }
    }
}

pub fn compute_cell_features(
    rgba: &[u8],
    w: usize,
    h: usize,
    cols: usize,
    rows: usize,
    labels: &[u32],
    kc: usize,
    ixs: &[usize],
    wxs: &[f64],
    iys: &[usize],
    wys: &[f64],
) -> CellFeatures {
    let n = cols * rows;
    let mut wsum = vec![0f64; n * kc];
    let mut lab_sum = vec![[0f64; 3]; n];
    let mut lab_wsum = vec![0f64; n];

    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            let p = i * 4;
            let cell = iys[y] * cols + ixs[x];
            let wgt = wys[y] * wxs[x];

            if wgt > 0.0 {
                wsum[cell * kc + labels[i] as usize] += wgt;
                if rgba[p + 3] > 10 {
                    let lab = rgb_to_oklab([rgba[p], rgba[p + 1], rgba[p + 2]]);
                    lab_sum[cell][0] += lab[0] * wgt;
                    lab_sum[cell][1] += lab[1] * wgt;
                    lab_sum[cell][2] += lab[2] * wgt;
                    lab_wsum[cell] += wgt;
                }
            }
        }
    }

    let mut cell_lab = vec![[0.0, 0.0, 0.0]; n];
    for c in 0..n {
        if lab_wsum[c] > 1e-6 {
            cell_lab[c] = [
                lab_sum[c][0] / lab_wsum[c],
                lab_sum[c][1] / lab_wsum[c],
                lab_sum[c][2] / lab_wsum[c],
            ];
        }
    }

    let mut probs = vec![0.0f64; n * kc];
    let mut confidences = vec![0.0f64; n];

    for c in 0..n {
        let base = c * kc;
        let mut total_w = 0.0f64;
        for l in 0..kc {
            total_w += wsum[base + l];
        }

        if total_w > 1e-6 {
            for l in 0..kc {
                probs[base + l] = wsum[base + l] / total_w;
            }
            let mut p1 = 0.0f64;
            let mut p2 = 0.0f64;
            for l in 0..kc {
                let p = probs[base + l];
                if p > p1 {
                    p2 = p1;
                    p1 = p;
                } else if p > p2 {
                    p2 = p;
                }
            }
            confidences[c] = (p1 - p2).clamp(0.0, 1.0);
        } else {
            for l in 0..kc {
                probs[base + l] = 1.0 / (kc as f64);
            }
            confidences[c] = 0.0;
        }
    }

    CellFeatures {
        cell_lab,
        probs,
        confidences,
    }
}

pub fn compute_edge_gates(
    cell_lab: &[[f64; 3]],
    cols: usize,
    rows: usize,
    edge_k: f64,
) -> DirectionalEdgeGates {
    let h_len = cols.saturating_sub(1) * rows;
    let v_len = cols * rows.saturating_sub(1);
    let mut h_gates = vec![1.0f64; h_len];
    let mut v_gates = vec![1.0f64; v_len];

    if cols > 1 {
        for cy in 0..rows {
            for cx in 0..cols - 1 {
                let c1 = cy * cols + cx;
                let c2 = cy * cols + (cx + 1);
                let d = oklab_distance_sq(cell_lab[c1], cell_lab[c2]).sqrt();
                h_gates[cy * (cols - 1) + cx] = (-edge_k * d).exp();
            }
        }
    }

    if rows > 1 {
        for cy in 0..rows - 1 {
            for cx in 0..cols {
                let c1 = cy * cols + cx;
                let c2 = (cy + 1) * cols + cx;
                let d = oklab_distance_sq(cell_lab[c1], cell_lab[c2]).sqrt();
                v_gates[cy * cols + cx] = (-edge_k * d).exp();
            }
        }
    }

    DirectionalEdgeGates {
        h_gates,
        v_gates,
        cols,
        rows,
    }
}

pub fn edge_aware_relaxation(
    mut probs: Vec<f64>,
    mut confidences: Vec<f64>,
    cell_lab: &[[f64; 3]],
    gates: &DirectionalEdgeGates,
    cols: usize,
    rows: usize,
    kc: usize,
    iterations: usize,
    lambda_max: f64,
    gamma: f64,
    edge_k: f64,
) -> (Vec<f64>, Vec<f64>) {
    let n = cols * rows;

    for _iter in 0..iterations {
        let mut next_probs = probs.clone();

        for cy in 0..rows {
            for cx in 0..cols {
                let c = cy * cols + cx;
                let base = c * kc;
                let conf = confidences[c];

                let lambda_i = lambda_max * (1.0 - conf).powf(gamma);

                let mut s_sum = vec![0.0f64; kc];
                let mut s_weight = 0.0f64;

                let y_min = cy.saturating_sub(1);
                let y_max = (cy + 1).min(rows - 1);
                let x_min = cx.saturating_sub(1);
                let x_max = (cx + 1).min(cols - 1);

                for ny in y_min..=y_max {
                    for nx in x_min..=x_max {
                        if ny == cy && nx == cx {
                            continue;
                        }
                        let nc = ny * cols + nx;
                        let n_base = nc * kc;

                        let base_w = if ny == cy || nx == cx { 1.0 } else { 0.707 };
                        let gate = gates.get_gate(cx, cy, nx, ny, cell_lab, edge_k);
                        let w_eff = base_w * gate;

                        if w_eff > 1e-6 {
                            for l in 0..kc {
                                s_sum[l] += probs[n_base + l] * w_eff;
                            }
                            s_weight += w_eff;
                        }
                    }
                }

                if s_weight > 1e-6 {
                    for l in 0..kc {
                        let s_i = s_sum[l] / s_weight;
                        next_probs[base + l] = (1.0 - lambda_i) * probs[base + l] + lambda_i * s_i;
                    }
                }
            }
        }

        probs = next_probs;
        for c in 0..n {
            let base = c * kc;
            let mut p1 = 0.0f64;
            let mut p2 = 0.0f64;
            for l in 0..kc {
                let p = probs[base + l];
                if p > p1 {
                    p2 = p1;
                    p1 = p;
                } else if p > p2 {
                    p2 = p;
                }
            }
            confidences[c] = (p1 - p2).clamp(0.0, 1.0);
        }
    }

    (probs, confidences)
}

pub fn edge_aware_tv(
    win: &mut [u32],
    probs: &[f64],
    confidences: &[f64],
    cell_lab: &[[f64; 3]],
    cols: usize,
    rows: usize,
    kc: usize,
) {
    if cols < 3 || rows < 3 {
        return;
    }

    let win_snapshot = win.to_vec();
    for cy in 1..rows - 1 {
        for cx in 1..cols - 1 {
            let c = cy * cols + cx;
            let cur_l = win_snapshot[c];

            let up_idx = (cy - 1) * cols + cx;
            let down_idx = (cy + 1) * cols + cx;
            let left_idx = cy * cols + (cx - 1);
            let right_idx = cy * cols + (cx + 1);

            let neighbors = [
                win_snapshot[up_idx],
                win_snapshot[down_idx],
                win_snapshot[left_idx],
                win_snapshot[right_idx],
            ];
            let neighbor_indices = [up_idx, down_idx, left_idx, right_idx];

            let mut counts = [0usize; 4];
            for i in 0..4 {
                for j in 0..4 {
                    if neighbors[i] == neighbors[j] {
                        counts[i] += 1;
                    }
                }
            }

            let mut dominant_label = None;
            for i in 0..4 {
                if counts[i] >= 3 && neighbors[i] != cur_l {
                    dominant_label = Some(neighbors[i]);
                    break;
                }
            }

            if let Some(dom_l) = dominant_label {
                let cur_p = probs[c * kc + cur_l as usize];
                let dom_p = probs[c * kc + dom_l as usize];
                let conf = confidences[c];

                let mut var_lab = 0.0f64;
                let mut agree_count = 0usize;
                for i in 0..4 {
                    if neighbors[i] == dom_l {
                        for j in (i + 1)..4 {
                            if neighbors[j] == dom_l {
                                var_lab += oklab_distance_sq(
                                    cell_lab[neighbor_indices[i]],
                                    cell_lab[neighbor_indices[j]],
                                );
                                agree_count += 1;
                            }
                        }
                    }
                }
                let avg_dist = if agree_count > 0 {
                    (var_lab / agree_count as f64).sqrt()
                } else {
                    0.0
                };

                let is_flat_surrounding = avg_dist < 0.15;
                let is_weak_current = cur_p < 0.70 || conf < 0.45 || (dom_p / cur_p.max(1e-4)) > 0.35;

                if is_flat_surrounding && is_weak_current {
                    win[c] = dom_l;
                }
            }
        }
    }
}

/// Stage 1 (STRUCTURE): quantise to a small palette (adaptive K) and let each
/// cell vote among the clean quantised labels -> crisp placement.
/// Stage 2 (COLOUR): colour each cell from the ORIGINAL pixels carrying the
/// winning label -> crisp lines AND accurate, un-clamped colours.
pub fn two_stage_pack(
    rgba: &[u8],
    w: usize,
    h: usize,
    cols: usize,
    rows: usize,
    k_colors: usize,
    elastic: bool,
    offset_x: f64,
    offset_y: f64,
) -> ReconOut {
    let k_req = if k_colors > 0 {
        k_colors
    } else {
        crate::kmeans::adaptive_k(rgba, w, h, 16, 48, 0.003)
    };
    let (labels, kc) = crate::kmeans::kmeans_labels(rgba, w, h, k_req);
    let kc = kc.max(1);
    let n = cols * rows;

    let (ixs, wxs, iys, wys) = compute_spatial_grid(rgba, w, h, cols, rows, elastic, offset_x, offset_y);

    // stage 1: compute cell features (OKLab mean, soft votes without +1e-4, margin confidence)
    let features = compute_cell_features(
        rgba, w, h, cols, rows, &labels, kc, &ixs, &wxs, &iys, &wys,
    );

    // 1.1 Precompute Directional Edge Gates in OKLab space
    let edge_k = 5.0f64;
    let gates = compute_edge_gates(&features.cell_lab, cols, rows, edge_k);

    // 1.2 Edge-Aware Relaxation Labeling (2 iterations)
    let (probs, confidences) = edge_aware_relaxation(
        features.probs,
        features.confidences,
        &features.cell_lab,
        &gates,
        cols,
        rows,
        kc,
        2,
        0.35,
        2.0,
        edge_k,
    );

    // 1.3 Determine winning label per cell
    let mut win = vec![0u32; n];
    for c in 0..n {
        let base = c * kc;
        let mut bi = 0usize;
        let mut bv = probs[base];
        for l in 1..kc {
            if probs[base + l] > bv {
                bv = probs[base + l];
                bi = l;
            }
        }
        win[c] = bi as u32;
    }

    // 1.4 Edge-Aware Spatial Total Variation (TV) Regularization
    edge_aware_tv(&mut win, &probs, &confidences, &features.cell_lab, cols, rows, kc);

    // stage 2: colour from original pixels carrying the winning label
    let mut csum = vec![[0f64; 3]; n];
    let mut wden = vec![0f64; n];
    let mut selcnt = vec![0f64; n];
    let mut cnt = vec![0f64; n];
    let mut msum = vec![[0f64; 3]; n];
    let mut asum = vec![0f64; n];
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            let p = i * 4;
            let cell = iys[y] * cols + ixs[x];
            let wgt = wys[y] * wxs[x] + 1e-4;
            let rgb = [
                rgba[p] as f64 / 255.0,
                rgba[p + 1] as f64 / 255.0,
                rgba[p + 2] as f64 / 255.0,
            ];
            cnt[cell] += 1.0;
            for c in 0..3 {
                msum[cell][c] += rgb[c];
            }
            if rgba[p + 3] > 127 {
                asum[cell] += 1.0;
            }
            if labels[i] == win[cell] {
                selcnt[cell] += 1.0;
                wden[cell] += wgt;
                for c in 0..3 {
                    csum[cell][c] += rgb[c] * wgt;
                }
            }
        }
    }

    let mut out_rgba = vec![0u8; n * 4];
    for c in 0..n {
        let color = if selcnt[c] >= 0.5 && wden[c] > 1e-9 {
            [csum[c][0] / wden[c], csum[c][1] / wden[c], csum[c][2] / wden[c]]
        } else {
            let cc = cnt[c].max(1.0);
            [msum[c][0] / cc, msum[c][1] / cc, msum[c][2] / cc]
        };
        for ch in 0..3 {
            out_rgba[c * 4 + ch] = pyround(color[ch] * 255.0).clamp(0.0, 255.0) as u8;
        }
        out_rgba[c * 4 + 3] = if asum[c] / cnt[c].max(1.0) > 0.5 { 255 } else { 0 };
    }
    ReconOut { rgba: out_rgba, cols, rows }
}

/// Find grid phase (offset_x, offset_y) using comb phase of edge luminance profiles.
pub fn find_grid_phase(rgba: &[u8], w: usize, h: usize, step_x: f64, step_y: f64) -> (f64, f64) {
    let mut prof_x = vec![0f64];
    prof_x.extend(axis_profile(rgba, w, h, 0));
    let mut prof_y = vec![0f64];
    prof_y.extend(axis_profile(rgba, w, h, 1));
    let (px, _) = comb_phase(&prof_x, step_x);
    let (py, _) = comb_phase(&prof_y, step_y);
    (px, py)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_edge_gates_preserves_sharp_boundary() {
        // Black: [0.0, 0.0, 0.0], White: [1.0, 0.0, 0.0] in OKLab
        let black = [0.0, 0.0, 0.0];
        let white = [1.0, 0.0, 0.0];
        let cell_lab = vec![black, white];
        let gates = compute_edge_gates(&cell_lab, 2, 1, 5.0);

        let g = gates.get_gate(0, 0, 1, 0, &cell_lab, 5.0);
        // exp(-5.0 * 1.0) = exp(-5) ≈ 0.006738 -> very small gate blocking diffusion
        assert!(g < 0.01, "Gate between black and white should be < 0.01, got {}", g);

        // Two identical cells
        let cell_lab_same = vec![white, white];
        let gates_same = compute_edge_gates(&cell_lab_same, 2, 1, 5.0);
        let g_same = gates_same.get_gate(0, 0, 1, 0, &cell_lab_same, 5.0);
        assert!((g_same - 1.0).abs() < 1e-6, "Gate between same colors should be 1.0");
    }

    #[test]
    fn test_edge_relaxation_no_bleed_across_edge() {
        // 2x2 grid:
        // Col 0: black (label 0)
        // Col 1: cyan/blue (label 1)
        let black = rgb_to_oklab([0, 0, 0]);
        let blue = rgb_to_oklab([0, 200, 255]);
        let cell_lab = vec![black, blue, black, blue];
        let cols = 2;
        let rows = 2;
        let kc = 2;
        let edge_k = 5.0;

        let gates = compute_edge_gates(&cell_lab, cols, rows, edge_k);

        // Initial probs: Col 0 has label 0 with 90%, Col 1 has label 1 with 90%
        let probs = vec![
            0.9, 0.1, // (0, 0)
            0.1, 0.9, // (1, 0)
            0.9, 0.1, // (0, 1)
            0.1, 0.9, // (1, 1)
        ];
        let confidences = vec![0.8, 0.8, 0.8, 0.8];

        let (next_probs, _) = edge_aware_relaxation(
            probs,
            confidences,
            &cell_lab,
            &gates,
            cols,
            rows,
            kc,
            2,
            0.35,
            2.0,
            edge_k,
        );

        // Ensure col 0 (cells 0 and 2) didn't get corrupted by col 1
        assert!(next_probs[0 * kc + 0] > 0.85, "Cell (0,0) label 0 prob should remain high");
        assert!(next_probs[2 * kc + 0] > 0.85, "Cell (0,1) label 0 prob should remain high");
        // Ensure col 1 (cells 1 and 3) didn't get corrupted by col 0
        assert!(next_probs[1 * kc + 1] > 0.85, "Cell (1,0) label 1 prob should remain high");
        assert!(next_probs[3 * kc + 1] > 0.85, "Cell (1,1) label 1 prob should remain high");
    }

    #[test]
    fn test_edge_aware_tv_noise_removal() {
        // 3x3 grid: surrounding cells all label 0 (white), center is label 1 (black) with weak prob
        let white = rgb_to_oklab([255, 255, 255]);
        let black = rgb_to_oklab([0, 0, 0]);
        let mut cell_lab = vec![white; 9];
        cell_lab[4] = black; // center

        let mut win = vec![0u32; 9];
        win[4] = 1; // noisy center

        let mut probs = vec![0.0f64; 18];
        for c in 0..9 {
            if c == 4 {
                probs[c * 2] = 0.45;     // dom label prob
                probs[c * 2 + 1] = 0.55; // weak cur label prob
            } else {
                probs[c * 2] = 0.95;
                probs[c * 2 + 1] = 0.05;
            }
        }
        let mut confidences = vec![0.9f64; 9];
        confidences[4] = 0.1; // weak margin confidence

        edge_aware_tv(&mut win, &probs, &confidences, &cell_lab, 3, 3, 2);

        assert_eq!(win[4], 0, "Noisy weak center cell should be regularized to dominant label 0");
    }

    #[test]
    fn test_edge_aware_tv_preserves_strong_detail() {
        // 3x3 grid: center is a strong intentional 1px dot (e.g. eye)
        let white = rgb_to_oklab([255, 255, 255]);
        let black = rgb_to_oklab([0, 0, 0]);
        let mut cell_lab = vec![white; 9];
        cell_lab[4] = black;

        let mut win = vec![0u32; 9];
        win[4] = 1; // intentional dot

        let mut probs = vec![0.0f64; 18];
        for c in 0..9 {
            if c == 4 {
                probs[c * 2] = 0.1;
                probs[c * 2 + 1] = 0.90; // strong confidence
            } else {
                probs[c * 2] = 0.95;
                probs[c * 2 + 1] = 0.05;
            }
        }
        let mut confidences = vec![0.9f64; 9];
        confidences[4] = 0.8; // strong margin confidence

        edge_aware_tv(&mut win, &probs, &confidences, &cell_lab, 3, 3, 2);

        assert_eq!(win[4], 1, "Intentional high-confidence dot should NOT be overwritten by TV");
    }
}

