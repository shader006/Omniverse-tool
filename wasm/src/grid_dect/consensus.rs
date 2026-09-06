//! Multi-detector Consensus & Arbitration Engine (Direction A: Full Pixel Art Fixer Client-side Port).
//! Combines Autocorrelation (ACF + cepstrum), Run-Lengths (comb peak soft-GCD),
//! and Self-Similarity (shift plane comparison) with calibrated early exit.

use super::autocorr;
use super::reconstruct;
use super::runlengths;
use super::selfsim;
use super::types::{ConsensusResult, GridCandidate};

struct Prop {
    step_x: f64,
    step_y: f64,
    cols: i64,
    rows: i64,
}

fn size_close(a: &Prop, b: &Prop) -> bool {
    let tol_c = std::cmp::max(1, (0.01 * b.cols as f64).round_ties_even() as i64);
    let tol_r = std::cmp::max(1, (0.01 * b.rows as f64).round_ties_even() as i64);
    (a.cols - b.cols).abs() <= tol_c && (a.rows - b.rows).abs() <= tol_r
}

/// Helper to build a sorted list of candidate integer sizes with confidence scores
fn collect_candidates(
    primary_step: f64,
    consensus_conf: u32,
    cands_ac: &[(f64, f64)],
    cands_rl: &[(f64, f64)],
) -> Vec<GridCandidate> {
    use std::collections::HashMap;
    let mut scores: HashMap<u32, f64> = HashMap::new();

    let primary_int = primary_step.round() as u32;
    if primary_int >= 1 {
        scores.insert(primary_int, 100.0);
    }

    for &(s, z) in cands_ac.iter().take(6) {
        let size = s.round() as u32;
        if size >= 1 && size <= 64 {
            let entry = scores.entry(size).or_insert(0.0);
            *entry = entry.max(z.max(0.0) * 80.0);
        }
    }

    for &(s, z) in cands_rl.iter().take(6) {
        let size = s.round() as u32;
        if size >= 1 && size <= 64 {
            let entry = scores.entry(size).or_insert(0.0);
            *entry = entry.max(z.max(0.0) * 85.0);
        }
    }

    let mut list: Vec<GridCandidate> = scores
        .into_iter()
        .map(|(size, raw)| {
            let conf = if size == primary_int {
                consensus_conf
            } else {
                (raw.min(95.0) as u32).min(consensus_conf.saturating_sub(5)).max(10)
            };
            GridCandidate { size, confidence: conf }
        })
        .collect();

    list.sort_by(|a, b| {
        b.confidence.cmp(&a.confidence).then_with(|| a.size.cmp(&b.size))
    });
    list.truncate(5);
    list
}

/// Nhận diện đồng thuận đa detector (Multi-detector Consensus)
pub fn detect_consensus(rgba: &[u8], w: usize, h: usize) -> ConsensusResult {
    let ac = autocorr::detect(rgba, w, h);
    let rl = runlengths::detect(rgba, w, h);

    let p_ac = Prop {
        step_x: ac.step_x,
        step_y: ac.step_y,
        cols: ac.cols as i64,
        rows: ac.rows as i64,
    };
    let p_rl = Prop {
        step_x: rl.step_x,
        step_y: rl.step_y,
        cols: rl.cols,
        rows: rl.rows,
    };

    // 1. Calibrated early exit: RL comb score S >= 0.30 & size_close với AC
    if size_close(&p_ac, &p_rl) && rl.score_x.min(rl.score_y) >= 0.30 {
        let cols = ((p_ac.cols + p_rl.cols) as f64 / 2.0).round_ties_even() as usize;
        let rows = ((p_ac.rows + p_rl.rows) as f64 / 2.0).round_ties_even() as usize;
        let step_x = w as f64 / cols.max(1) as f64;
        let step_y = h as f64 / rows.max(1) as f64;
        let (offset_x, offset_y) = reconstruct::find_grid_phase(rgba, w, h, step_x, step_y);
        let candidates = collect_candidates(
            (step_x + step_y) / 2.0,
            98,
            &ac.candidates,
            &rl.candidates,
        );

        return ConsensusResult {
            step_x,
            step_y,
            cols,
            rows,
            offset_x,
            offset_y,
            consensus: "fast:ac+rl(S)".into(),
            confidence: 98,
            candidates,
        };
    }

    // 2. Chạy Self-Similarity detector khi có sự phân vân giữa AC và RL
    let ss = selfsim::detect(rgba, w, h);
    let p_ss = Prop {
        step_x: ss.step_x,
        step_y: ss.step_y,
        cols: ss.cols,
        rows: ss.rows,
    };

    let named: [(&str, &Prop); 3] = [("ac", &p_ac), ("rl", &p_rl), ("ss", &p_ss)];
    for i in 0..named.len() {
        for j in i + 1..named.len() {
            let (na, a) = named[i];
            let (nb, b) = named[j];
            if size_close(a, b) {
                let cols = a.cols.max(1) as usize;
                let rows = a.rows.max(1) as usize;
                let step_x = a.step_x;
                let step_y = a.step_y;
                let (offset_x, offset_y) = reconstruct::find_grid_phase(rgba, w, h, step_x, step_y);
                let candidates = collect_candidates(
                    (step_x + step_y) / 2.0,
                    92,
                    &ac.candidates,
                    &rl.candidates,
                );

                return ConsensusResult {
                    step_x,
                    step_y,
                    cols,
                    rows,
                    offset_x,
                    offset_y,
                    consensus: format!("fastmode:{}+{}", na, nb),
                    confidence: 92,
                    candidates,
                };
            }
        }
    }

    // 3. Fallback: Autocorr flagged low-confidence
    let cols = p_ac.cols.max(1) as usize;
    let rows = p_ac.rows.max(1) as usize;
    let step_x = p_ac.step_x;
    let step_y = p_ac.step_y;
    let (offset_x, offset_y) = reconstruct::find_grid_phase(rgba, w, h, step_x, step_y);
    let candidates = collect_candidates(
        (step_x + step_y) / 2.0,
        55,
        &ac.candidates,
        &rl.candidates,
    );

    ConsensusResult {
        step_x,
        step_y,
        cols,
        rows,
        offset_x,
        offset_y,
        consensus: "fastmode:lowconf".into(),
        confidence: 55,
        candidates,
    }
}
