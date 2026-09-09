//! Centre-weighted voting with Protected Detail Veto and Confident vs Ambiguous Classification.

pub struct VotingResult {
    /// Winning label for each of the (cols * rows) cells.
    pub win: Vec<u32>,
    /// Confident flags for each cell (true = confident accept, false = ambiguous, needs local refinement).
    pub is_confident: Vec<bool>,
    /// Flags indicating whether the cell contains an explicitly protected micro-feature.
    pub is_protected: Vec<bool>,
    /// Cell vote margins (0.0 to 1.0) indicating decision clarity.
    pub margins: Vec<f64>,
    /// Precomputed horizontal cell indices for each input pixel x.
    pub ixs: Vec<usize>,
    /// Precomputed horizontal spatial weights for each input pixel x.
    pub wxs: Vec<f64>,
    /// Precomputed vertical cell indices for each input pixel y.
    pub iys: Vec<usize>,
    /// Precomputed vertical spatial weights for each input pixel y.
    pub wys: Vec<f64>,
}

/// Executes centre-weighted voting with protected detail priorities.
pub fn execute_voting(
    labels: &[u32],
    confidences: &[f64],
    protected_mask: &[bool],
    w: usize,
    h: usize,
    cols: usize,
    rows: usize,
    k_colors: usize,
    ixs: Vec<usize>,
    wxs: Vec<f64>,
    iys: Vec<usize>,
    wys: Vec<f64>,
) -> VotingResult {
    let n_cells = cols * rows;

    // 2. Accumulate votes per cell
    let mut vote_sums = vec![0.0f64; n_cells * k_colors];
    let mut protected_labels = vec![None; n_cells];

    for y in 0..h {
        let iy = iys[y];
        let wy = wys[y];
        for x in 0..w {
            let ix = ixs[x];
            let wx = wxs[x];
            let cell = iy * cols + ix;
            let p_idx = y * w + x;

            let lbl = labels[p_idx] as usize;
            if lbl >= k_colors {
                continue;
            }

            let conf = confidences[p_idx];
            let is_prot = protected_mask[p_idx];

            if is_prot {
                protected_labels[cell] = Some(lbl as u32);
            }

            // Vote weight combines spatial center proximity, label confidence, and protection boost
            let base_w = wy * wx + 1e-4;
            let conf_w = 0.5 + conf * 0.5;
            let prot_mult = if is_prot { 2.5 } else { 1.0 };

            let vote = base_w * conf_w * prot_mult;
            vote_sums[cell * k_colors + lbl] += vote;
        }
    }

    // 3. Find winner, runner-up, and classify into Confident vs Ambiguous
    let mut win = vec![0u32; n_cells];
    let mut is_confident = vec![true; n_cells];
    let mut is_protected = vec![false; n_cells];
    let mut margins = vec![1.0f64; n_cells];

    for c in 0..n_cells {
        let base = c * k_colors;
        let mut top1_val = -1.0f64;
        let mut top1_lbl = 0usize;
        let mut top2_val = -1.0f64;
        let mut total_vote = 0.0f64;

        for l in 0..k_colors {
            let v = vote_sums[base + l];
            total_vote += v;
            if v > top1_val {
                top2_val = top1_val;
                top1_val = v;
                top1_lbl = l;
            } else if v > top2_val {
                top2_val = v;
            }
        }

        let mut is_cell_protected = false;
        // If a protected detail was flagged in this cell and holds a presence,
        // it overrides the winner (Protected Detail Veto).
        // An isolated 1px detail in a 3x3 or 4x4 cell accounts for 6% to 12% of cell votes.
        if let Some(prot_lbl) = protected_labels[c] {
            let prot_vote = vote_sums[base + prot_lbl as usize];
            if total_vote > 1e-6 && prot_vote >= 0.08 * total_vote {
                top1_lbl = prot_lbl as usize;
                top1_val = prot_vote;
                is_cell_protected = true;
            }
        }

        win[c] = top1_lbl as u32;

        let margin = if total_vote > 1e-6 && top1_val > 0.0 {
            let runner_up = top2_val.max(0.0);
            (top1_val - runner_up) / total_vote
        } else {
            0.0
        };
        margins[c] = margin;

        // Classification Rule:
        // Confident if margin >= 0.35 and top1 holds at least 48% of total vote,
        // or if protected detail explicitly vetoed.
        // Ambiguous otherwise (typically ties, tight 50/50 borders, sub-pixel phase shifts).
        let confident = if is_cell_protected {
            true
        } else {
            margin >= 0.35 && (top1_val / total_vote.max(1e-6)) >= 0.48
        };

        is_confident[c] = confident;
        is_protected[c] = is_cell_protected;
    }

    VotingResult {
        win,
        is_confident,
        is_protected,
        margins,
        ixs,
        wxs,
        iys,
        wys,
    }
}
