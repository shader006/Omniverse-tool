pub mod grid_dect;
pub use grid_dect as grid_detect;

use wasm_bindgen::prelude::*;
pub use grid_dect::{
    analyze_grid_candidates, detect_autocorr_subpixel, detect_consensus,
    reconstruct, two_stage_pack, AutocorrCandidate, ConsensusResult,
    GridCandidate, NativeSpriteResult,
};

#[wasm_bindgen(start)]
pub fn main_js() -> Result<(), JsValue> {
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();

    Ok(())
}

/// [Hướng A]: Nhận diện đồng thuận toàn diện bằng Ensemble Multi-Detector (ACF + Run-Lengths + Self-Similarity)
/// Trả về đối tượng ConsensusResult chi tiết: step_x, step_y, cols, rows, offset_x, offset_y, consensus, confidence, candidates
#[wasm_bindgen]
pub fn detect_grid_ensemble(data: &[u8], width: u32, height: u32) -> Result<JsValue, JsValue> {
    let consensus = detect_consensus(data, width as usize, height as usize);
    serde_wasm_bindgen::to_value(&consensus).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// [Hướng A]: Tái tạo sprite pixel art ở độ phân giải gốc siêu nét bằng Snapped Cuts + Phase Alignment + Palette Extraction
/// Trả về NativeSpriteResult: { width: u32, height: u32, rgba: Uint8Array }
#[wasm_bindgen]
pub fn reconstruct_native_sprite(
    data: &[u8],
    width: u32,
    height: u32,
    step_x: f64,
    step_y: f64,
    cols: u32,
    rows: u32,
    auto_palette: bool,
) -> Result<JsValue, JsValue> {
    let out = reconstruct(
        data,
        width as usize,
        height as usize,
        step_x,
        step_y,
        cols as usize,
        rows as usize,
        false,
        auto_palette,
    );

    let result = NativeSpriteResult {
        width: out.cols as u32,
        height: out.rows as u32,
        rgba: out.rgba,
    };

    serde_wasm_bindgen::to_value(&result).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Tái tạo nhanh bằng Two-Stage Packing (K-means Structure + Original Color Extraction)
#[wasm_bindgen]
pub fn pack_native_sprite(
    data: &[u8],
    width: u32,
    height: u32,
    cols: u32,
    rows: u32,
    k_colors: u32,
) -> Result<JsValue, JsValue> {
    let out = two_stage_pack(
        data,
        width as usize,
        height as usize,
        cols as usize,
        rows as usize,
        k_colors as usize,
    );

    let result = NativeSpriteResult {
        width: out.cols as u32,
        height: out.rows as u32,
        rgba: out.rgba,
    };

    serde_wasm_bindgen::to_value(&result).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Nhận diện danh sách các kích thước lưới ứng viên từ Ensemble Consensus của pixel-art-fixer
/// Trả về đối tượng JavaScript Array: `[{ size: 4, confidence: 98 }, ...]`
#[wasm_bindgen]
pub fn detect_grid_candidates(data: &[u8], width: u32, height: u32) -> Result<JsValue, JsValue> {
    let candidates = analyze_grid_candidates(data, width, height);
    serde_wasm_bindgen::to_value(&candidates).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Nhận diện kích thước ô lưới tốt nhất (Best Grid Size) từ Ensemble Consensus
#[wasm_bindgen]
pub fn detect_best_grid_size(data: &[u8], width: u32, height: u32) -> u32 {
    let consensus = detect_consensus(data, width as usize, height as usize);
    let avg_step = (consensus.step_x + consensus.step_y) / 2.0;
    let int_step = avg_step.round() as u32;
    if int_step >= 1 && consensus.confidence >= 25 {
        return int_step;
    }
    let candidates = analyze_grid_candidates(data, width, height);
    candidates.first().map(|c| c.size).unwrap_or(1)
}

/// Nhận diện lưới Sub-pixel chi tiết đạt độ chính xác cao từ ACF của pixel-art-fixer
#[wasm_bindgen]
pub fn detect_subpixel_grid(data: &[u8], width: u32, height: u32) -> Result<JsValue, JsValue> {
    let subpixel = detect_autocorr_subpixel(data, width, height);
    serde_wasm_bindgen::to_value(&subpixel).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Tương thích ngược: Cho phép gọi detect_grid_candidates kèm tham số mở rộng
#[wasm_bindgen]
pub fn detect_grid_candidates_with_filter_and_mode(
    data: &[u8],
    width: u32,
    height: u32,
    _color_mode: &str,
    _filter_mode: &str,
) -> Result<JsValue, JsValue> {
    detect_grid_candidates(data, width, height)
}

/// Tương thích ngược: Cho phép gọi detect_grid_candidates kèm color_mode
#[wasm_bindgen]
pub fn detect_grid_candidates_with_mode(
    data: &[u8],
    width: u32,
    height: u32,
    _color_mode: &str,
) -> Result<JsValue, JsValue> {
    detect_grid_candidates(data, width, height)
}

/// Tương thích ngược: Cho phép gọi detect_subpixel_grid kèm tham số mở rộng
#[wasm_bindgen]
pub fn detect_subpixel_grid_with_filter_and_mode(
    data: &[u8],
    width: u32,
    height: u32,
    _color_mode: &str,
    _filter_mode: &str,
) -> Result<JsValue, JsValue> {
    detect_subpixel_grid(data, width, height)
}

/// Tương thích ngược: Cho phép gọi detect_subpixel_grid kèm color_mode
#[wasm_bindgen]
pub fn detect_subpixel_grid_with_mode(
    data: &[u8],
    width: u32,
    height: u32,
    _color_mode: &str,
) -> Result<JsValue, JsValue> {
    detect_subpixel_grid(data, width, height)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_grid_detection_on_synthetic_sprite() {
        let w = 64;
        let h = 64;
        let mut data = vec![255u8; w * h * 4];
        for y in 0..h {
            for x in 0..w {
                let idx = (y * w + x) * 4;
                let is_even = ((x / 4) + (y / 4)) % 2 == 0;
                if is_even {
                    data[idx] = 200;
                    data[idx + 1] = 50;
                    data[idx + 2] = 50;
                } else {
                    data[idx] = 50;
                    data[idx + 1] = 100;
                    data[idx + 2] = 200;
                }
            }
        }

        let candidates = analyze_grid_candidates(&data, w as u32, h as u32);
        println!("Candidates from analyze_grid_candidates: {:?}", candidates);
        assert!(!candidates.is_empty());
        assert_eq!(candidates[0].size, 4);

        let consensus = detect_consensus(&data, w, h);
        println!("Consensus result: {:?}", consensus);
        assert!((consensus.step_x - 4.0).abs() < 0.2);
        assert!((consensus.step_y - 4.0).abs() < 0.2);
        assert_eq!(consensus.cols, 16);
        assert_eq!(consensus.rows, 16);

        let recon = reconstruct(&data, w, h, consensus.step_x, consensus.step_y, consensus.cols, consensus.rows, false, false);
        assert_eq!(recon.cols, 16);
        assert_eq!(recon.rows, 16);
        assert_eq!(recon.rgba.len(), 16 * 16 * 4);
    }
}
