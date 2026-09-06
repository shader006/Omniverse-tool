//! Module nhận diện kích thước ô lưới bằng Ensemble Consensus chuẩn của pixel-art-fixer:
//! - Autocorrelation (ACF + Cepstrum + Drift-aware counting)
//! - Run-Lengths (Boundary-run comb peak + soft-GCD)
//! - Self-Similarity (Shift plane difference)
//! - Consensus & Arbitration Core (Fast & Full Mode)
//! - Native Resolution Reconstruction (Snapped cuts + Phase search + Modal/Wu/KMeans color extraction)

pub mod acf;
pub mod autocorr;
pub mod consensus;
pub mod gray;
pub mod kmeans;
pub mod reconstruct;
pub mod runlengths;
pub mod selfsim;
pub mod sigproc;
pub mod types;
pub mod wu;

pub use consensus::detect_consensus;
pub use reconstruct::{reconstruct, two_stage_pack, ReconOut};
pub use types::{AutocorrCandidate, ConsensusResult, GridCandidate, NativeSpriteResult};

pub fn detect_autocorr_subpixel(data: &[u8], width: u32, height: u32) -> Vec<AutocorrCandidate> {
    let res = detect_consensus(data, width as usize, height as usize);
    let avg_step = (res.step_x + res.step_y) / 2.0;
    vec![AutocorrCandidate {
        step_x: res.step_x as f32,
        step_y: res.step_y as f32,
        offset_x: res.offset_x as f32,
        offset_y: res.offset_y as f32,
        integer_size: avg_step.round() as u32,
        confidence: res.confidence,
    }]
}

pub fn detect_autocorr_candidates(data: &[u8], width: u32, height: u32) -> Vec<GridCandidate> {
    let res = detect_consensus(data, width as usize, height as usize);
    res.candidates
}

/// Phân tích và trích xuất danh sách ứng viên kích thước ô lưới trực tiếp bằng Ensemble Consensus
pub fn analyze_grid_candidates(data: &[u8], width: u32, height: u32) -> Vec<GridCandidate> {
    if width < 4 || height < 4 {
        return vec![GridCandidate { size: 1, confidence: 100 }];
    }
    let res = detect_consensus(data, width as usize, height as usize);
    if !res.candidates.is_empty() {
        res.candidates
    } else {
        vec![GridCandidate { size: 1, confidence: 10 }]
    }
}
