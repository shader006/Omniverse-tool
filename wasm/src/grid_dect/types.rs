use serde::{Deserialize, Serialize};

/// Cấu trúc đại diện cho một ứng viên kích thước lưới pixel (Grid Candidate)
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct GridCandidate {
    /// Kích thước cạnh ô pixel logic làm tròn về số nguyên (ví dụ: 1, 2, 4, 8, 16...)
    pub size: u32,
    /// Độ tin cậy tính theo phần trăm (0..=100%)
    pub confidence: u32,
}

/// Cấu trúc đại diện cho kết quả nhận diện lưới số thực chi tiết (Sub-pixel Grid Estimate)
/// Đạt độ chính xác cao tương đương pixel-art-fixer
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct AutocorrCandidate {
    /// Kích thước bước lưới số thực trục ngang (Sub-pixel Step X, ví dụ: 8.34)
    pub step_x: f32,
    /// Kích thước bước lưới số thực trục dọc (Sub-pixel Step Y, ví dụ: 8.41)
    pub step_y: f32,
    /// Độ lệch pha điểm cắt trục ngang (Offset X, ví dụ: 1.72)
    pub offset_x: f32,
    /// Độ lệch pha điểm cắt trục dọc (Offset Y, ví dụ: 2.10)
    pub offset_y: f32,
    /// Kích thước số nguyên tương đương (ví dụ: 8)
    pub integer_size: u32,
    /// Độ tin cậy tính theo phần trăm (0..=100%)
    pub confidence: u32,
}

/// Cấu trúc kết quả Ensemble Consensus đa detector theo chuẩn Pixel Art Fixer Core
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct ConsensusResult {
    /// Bước lưới trục ngang (Sub-pixel Step X)
    pub step_x: f64,
    /// Bước lưới trục dọc (Sub-pixel Step Y)
    pub step_y: f64,
    /// Số cột pixel gốc (Native Cols)
    pub cols: usize,
    /// Số hàng pixel gốc (Native Rows)
    pub rows: usize,
    /// Độ lệch pha trục ngang (Phase Offset X)
    pub offset_x: f64,
    /// Độ lệch pha trục dọc (Phase Offset Y)
    pub offset_y: f64,
    /// Tên loại đồng thuận (e.g. "fast:ac+rl(S)", "fastmode:ac+rl", "fastmode:lowconf")
    pub consensus: String,
    /// Độ tin cậy tính theo phần trăm (0..=100%)
    pub confidence: u32,
    /// Danh sách kích thước ứng viên cho UI
    pub candidates: Vec<GridCandidate>,
}

/// Kết quả tái tạo sprite ở độ phân giải gốc chuẩn (Native Resolution Sprite)
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct NativeSpriteResult {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

/// Tính khoảng cách khác biệt màu sắc RGBA có hỗ trợ kênh Alpha:
/// - Xử lý đúng cho ảnh PNG trong suốt (trong suốt xem như cùng màu)
/// - Phát hiện ranh giới hình thể đối tượng (silhouette edges)
#[inline(always)]
pub fn color_diff_rgba(c1: &[u8], c2: &[u8]) -> u32 {
    if c1[3] < 16 && c2[3] < 16 {
        return 0;
    }

    if (c1[3] < 16) != (c2[3] < 16) {
        return 255;
    }

    let dr = (c1[0] as i32 - c2[0] as i32).unsigned_abs();
    let dg = (c1[1] as i32 - c2[1] as i32).unsigned_abs();
    let db = (c1[2] as i32 - c2[2] as i32).unsigned_abs();
    let da = (c1[3] as i32 - c2[3] as i32).unsigned_abs();

    dr + dg + db + da
}

/// Tính độ sáng (Luminance) theo chuẩn Rec. 601 (0..=255)
#[inline(always)]
pub fn pixel_luminance(c: &[u8]) -> f32 {
    if c[3] < 16 {
        0.0
    } else {
        0.299 * (c[0] as f32) + 0.587 * (c[1] as f32) + 0.114 * (c[2] as f32)
    }
}
