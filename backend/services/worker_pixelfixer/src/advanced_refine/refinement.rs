//! Local Refinement for Ambiguous cells.
//! Resolves tight 50/50 boundary ties, sub-pixel phase shifts, and boundary noise
//! using Bilateral Neighbor Consensus and Edge Orientation within the cell.

/// Refines ambiguous cells using Softmax Relaxation Labeling and Spatial Total Variation Regularization.
pub fn refine_ambiguous_cells(
    win: &mut [u32],
    is_confident: &[bool],
    is_protected: &[bool],
    labels: &[u32],
    _ixs: &[usize],
    _iys: &[usize],
    w: usize,
    h: usize,
    cols: usize,
    rows: usize,
    k_colors: usize,
) {
    let n_cells = cols * rows;
    if n_cells == 0 || k_colors == 0 {
        return;
    }

    // 1. Initialize soft probability distributions per cell (logits from subpixel votes)
    let mut probs = vec![0.0f64; n_cells * k_colors];

    for cy in 0..rows {
        for cx in 0..cols {
            let cell = cy * cols + cx;
            let base = cell * k_colors;

            if is_confident[cell] || is_protected[cell] {
                let lbl = win[cell] as usize;
                if lbl < k_colors {
                    probs[base + lbl] = 1.0;
                }
                continue;
            }

            // Sub-pixel Central Core & Edge Vote within ambiguous cell
            let x_start = (cx * w) / cols;
            let x_end = (((cx + 1) * w) / cols).min(w);
            let y_start = (cy * h) / rows;
            let y_end = (((cy + 1) * h) / rows).min(h);

            let cell_w = (x_end - x_start).max(1);
            let cell_h = (y_end - y_start).max(1);

            let core_x0 = x_start + cell_w / 4;
            let core_x1 = x_end - cell_w / 4;
            let core_y0 = y_start + cell_h / 4;
            let core_y1 = y_end - cell_h / 4;

            let mut total_w = 0.0f64;
            for py in y_start..y_end {
                for px in x_start..x_end {
                    let lbl = labels[py * w + px] as usize;
                    if lbl >= k_colors {
                        continue;
                    }
                    let is_core = px >= core_x0 && px < core_x1 && py >= core_y0 && py < core_y1;
                    let w_px = if is_core { 2.0 } else { 0.5 };
                    probs[base + lbl] += w_px;
                    total_w += w_px;
                }
            }

            if total_w > 1e-9 {
                for l in 0..k_colors {
                    probs[base + l] /= total_w;
                }
            } else {
                let current_winner = win[cell] as usize;
                if current_winner < k_colors {
                    probs[base + current_winner] = 1.0;
                }
            }
        }
    }

    // 2. Iterative Relaxation Labeling with Temperature Annealing (2 passes)
    // Pass 0: tau = 0.7 (explore/smooth), Pass 1: tau = 0.4 (sharpen/crisp)
    let temps = [0.70f64, 0.40f64];
    for &tau in &temps {
        let mut next_probs = probs.clone();

        for cy in 0..rows {
            for cx in 0..cols {
                let cell = cy * cols + cx;
                if is_confident[cell] || is_protected[cell] {
                    continue;
                }

                let base = cell * k_colors;
                let mut neighbor_support = vec![0.0f64; k_colors];
                let mut neighbor_w_sum = 0.0f64;

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
                        let n_base = nc * k_colors;
                        // Orthogonal neighbors have higher coupling weight than diagonals
                        let w_coupling = if ny == cy || nx == cx { 1.0 } else { 0.707 };

                        for l in 0..k_colors {
                            neighbor_support[l] += probs[n_base + l] * w_coupling;
                        }
                        neighbor_w_sum += w_coupling;
                    }
                }

                if neighbor_w_sum > 1e-9 {
                    // Softmax with temperature scaling: P(l) ~ exp( (logit_prior + context) / tau )
                    let mut max_logit = -1e9f64;
                    let mut logits = vec![0.0f64; k_colors];
                    for l in 0..k_colors {
                        let prior = probs[base + l];
                        let ctx = neighbor_support[l] / neighbor_w_sum;
                        let logit = (prior * 1.5 + ctx * 1.2) / tau;
                        logits[l] = logit;
                        if logit > max_logit {
                            max_logit = logit;
                        }
                    }

                    let mut sum_exp = 0.0f64;
                    for l in 0..k_colors {
                        let e = (logits[l] - max_logit).exp();
                        logits[l] = e;
                        sum_exp += e;
                    }

                    if sum_exp > 1e-9 {
                        for l in 0..k_colors {
                            next_probs[base + l] = logits[l] / sum_exp;
                        }
                    }
                }
            }
        }
        probs = next_probs;
    }

    // 3. Assign optimal discrete label for ambiguous cells
    for cell in 0..n_cells {
        if is_confident[cell] || is_protected[cell] {
            continue;
        }
        let base = cell * k_colors;
        let mut best_lbl = win[cell] as usize;
        let mut best_p = -1.0f64;
        for l in 0..k_colors {
            if probs[base + l] > best_p {
                best_p = probs[base + l];
                best_lbl = l;
            }
        }
        win[cell] = best_lbl as u32;
    }

    // 4. Spatial TV Regularization on non-protected cells
    // Smooth out orphan 1-pixel boundary noise surrounded by a unified majority
    if cols >= 3 && rows >= 3 {
        let win_snapshot = win.to_vec();
        for cy in 1..rows - 1 {
            for cx in 1..cols - 1 {
                let cell = cy * cols + cx;
                if is_protected[cell] {
                    continue;
                }

                let cur_l = win_snapshot[cell];
                let up = win_snapshot[(cy - 1) * cols + cx];
                let down = win_snapshot[(cy + 1) * cols + cx];
                let left = win_snapshot[cy * cols + (cx - 1)];
                let right = win_snapshot[cy * cols + (cx + 1)];

                let neighbors = [up, down, left, right];
                let mut counts = [0usize; 4];
                for i in 0..4 {
                    for j in 0..4 {
                        if neighbors[i] == neighbors[j] {
                            counts[i] += 1;
                        }
                    }
                }

                // If 3 or 4 cardinal neighbors share the exact same label
                let mut majority_label = None;
                for i in 0..4 {
                    if counts[i] >= 3 && neighbors[i] != cur_l {
                        majority_label = Some(neighbors[i]);
                        break;
                    }
                }

                if let Some(maj_l) = majority_label {
                    // If this cell was ambiguous or weak confidence, absorb into majority cluster
                    if !is_confident[cell] || probs[cell * k_colors + cur_l as usize] < 0.70 {
                        win[cell] = maj_l;
                    }
                }
            }
        }
    }
}
