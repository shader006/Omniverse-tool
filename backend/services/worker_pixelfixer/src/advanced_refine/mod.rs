//! Advanced Pixel Refine SOTA Pipeline.
//! Architecture:
//! SOURCE -> Linear RGB -> OKLab
//!        -> (Rareness + Edge + Variance)
//!        -> Weighted Wu Quantization
//!        -> Labels & Label Confidence
//!        -> Protected Detail Check
//!        -> Centre-weighted Voting (Protected Veto)
//!        -> Confident (Accept) vs Ambiguous (Local Refinement)
//!        -> Stage 2 True Color Extraction
//!        -> Native Sprite

pub mod color_stage2;
pub mod confidence;
pub mod oklab;
pub mod refinement;
pub mod saliency;
pub mod voting;
pub mod wu_oklab;

use rayon::prelude::*;

pub struct AdvancedReconOut {
    pub rgba: Vec<u8>,
    pub cols: usize,
    pub rows: usize,
    pub confident_ratio: f64,
    pub protected_count: usize,
}

/// Executes the full SOTA Advanced Pixel Refine Flow.
pub fn advanced_pixel_refine(
    raw_rgba: &[u8],
    w: usize,
    h: usize,
    cols: usize,
    rows: usize,
    k_colors: usize,
    elastic: bool,
) -> AdvancedReconOut {
    let total_px = w * h;
    assert!(total_px > 0, "Input image cannot be empty");
    assert!(cols > 0 && rows > 0, "Grid cols and rows must be positive");

    // 1. Precompute spatial grid (Uniform or Elastic cuts)
    let (ixs, wxs, iys, wys) = crate::reconstruct::compute_spatial_grid(
        raw_rgba,
        w,
        h,
        cols,
        rows,
        elastic,
    );

    // 2. SOURCE -> Linear RGB -> OKLab
    let labs: Vec<[f64; 3]> = (0..total_px)
        .into_par_iter()
        .map(|i| {
            let p = i * 4;
            let rgb = [raw_rgba[p], raw_rgba[p + 1], raw_rgba[p + 2]];
            oklab::rgb_to_oklab(rgb)
        })
        .collect();

    // 3. Tri-channel Saliency Tensor: Rareness, Edge, Variance
    let saliency_maps = saliency::compute_saliency_tensor(&labs, w, h);

    // 4. Weighted Wu Quantization in OKLab space
    // Determine K (default 32..64 based on image complexity)
    let k = if k_colors > 0 {
        k_colors.clamp(4, 128)
    } else {
        32
    };
    let wu_pal = wu_oklab::quantize_oklab_weighted(
        &labs,
        &saliency_maps.fused_weights,
        k,
    );

    // 5. Labels, Label Confidence & Protected Detail Check
    let labeled = confidence::assign_and_protect(
        &labs,
        &saliency_maps.rareness,
        &saliency_maps.edge,
        &wu_pal.oklab_palette,
        w,
        h,
    );

    let protected_count = labeled.protected_mask.iter().filter(|&&p| p).count();

    // 6. Centre-weighted Voting (with Protected Veto) & Confident/Ambiguous classification
    let mut voting_res = voting::execute_voting(
        &labeled.labels,
        &labeled.confidence,
        &labeled.protected_mask,
        w,
        h,
        cols,
        rows,
        wu_pal.oklab_palette.len(),
        ixs,
        wxs,
        iys,
        wys,
    );

    let total_cells = cols * rows;
    let confident_cells = voting_res.is_confident.iter().filter(|&&c| c).count();
    let confident_ratio = if total_cells > 0 {
        confident_cells as f64 / total_cells as f64
    } else {
        1.0
    };

    // 6. Confident (Accept) vs Ambiguous (Local Refinement)
    refinement::refine_ambiguous_cells(
        &mut voting_res.win,
        &voting_res.is_confident,
        &voting_res.is_protected,
        &labeled.labels,
        &voting_res.ixs,
        &voting_res.iys,
        w,
        h,
        cols,
        rows,
        wu_pal.oklab_palette.len(),
    );

    // 7. Stage 2: True Color Extraction from Original Raw RGBA
    let out_rgba = color_stage2::extract_true_colors(
        raw_rgba,
        w,
        h,
        cols,
        rows,
        &labeled.labels,
        &voting_res.win,
        &voting_res.ixs,
        &voting_res.wxs,
        &voting_res.iys,
        &voting_res.wys,
    );

    AdvancedReconOut {
        rgba: out_rgba,
        cols,
        rows,
        confident_ratio,
        protected_count,
    }
}
