//! OKLab Color Space conversion and perceptual distance metrics.
//! Based on Björn Ottosson's formulation (2020) and adapted from pixel-art-lab.

#[inline]
pub fn srgb_to_linear(c: u8) -> f64 {
    let v = c as f64 / 255.0;
    if v <= 0.04045 {
        v / 12.92
    } else {
        ((v + 0.055) / 1.055).powf(2.4)
    }
}

#[inline]
pub fn linear_to_srgb(v: f64) -> u8 {
    let clamped = v.clamp(0.0, 1.0);
    let s = if clamped <= 0.0031308 {
        12.92 * clamped
    } else {
        1.055 * clamped.powf(1.0 / 2.4) - 0.055
    };
    (s * 255.0).round().clamp(0.0, 255.0) as u8
}

/// Convert sRGB [r, g, b] (0..=255) to OKLab [L, a, b].
/// L: lightness [0.0, 1.0], a: green-red [-0.4, 0.4], b: blue-yellow [-0.4, 0.4].
#[inline]
pub fn rgb_to_oklab(rgb: [u8; 3]) -> [f64; 3] {
    let r = srgb_to_linear(rgb[0]);
    let g = srgb_to_linear(rgb[1]);
    let b = srgb_to_linear(rgb[2]);

    let l_cone = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
    let m_cone = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
    let s_cone = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

    let l_root = l_cone.cbrt();
    let m_root = m_cone.cbrt();
    let s_root = s_cone.cbrt();

    let l = 0.2104542553 * l_root + 0.7936177850 * m_root - 0.0040720468 * s_root;
    let a = 1.9779984951 * l_root - 2.4285922050 * m_root + 0.4505937099 * s_root;
    let b_val = 0.0259040371 * l_root + 0.7827717662 * m_root - 0.8086757660 * s_root;

    [l, a, b_val]
}

/// Convert OKLab [L, a, b] to sRGB [r, g, b].
#[inline]
pub fn oklab_to_rgb(lab: [f64; 3]) -> [u8; 3] {
    let l_val = lab[0];
    let a_val = lab[1];
    let b_val = lab[2];

    let l_root = l_val + 0.3963377774 * a_val + 0.2158037573 * b_val;
    let m_root = l_val - 0.1055613458 * a_val - 0.0638541728 * b_val;
    let s_root = l_val - 0.0894841775 * a_val - 1.2914855480 * b_val;

    let l_cone = l_root * l_root * l_root;
    let m_cone = m_root * m_root * m_root;
    let s_cone = s_root * s_root * s_root;

    let r_lin = 4.0767416621 * l_cone - 3.3077115913 * m_cone + 0.2309699292 * s_cone;
    let g_lin = -1.2684380046 * l_cone + 2.6097574011 * m_cone - 0.3413193965 * s_cone;
    let b_lin = -0.0041960863 * l_cone - 0.7034186147 * m_cone + 1.7076147010 * s_cone;

    [
        linear_to_srgb(r_lin),
        linear_to_srgb(g_lin),
        linear_to_srgb(b_lin),
    ]
}

/// Perceptual color distance squared in OKLab space.
/// Uses scaled chromatic coefficients to align closely with human threshold sensitivity.
#[inline]
pub fn oklab_distance_sq(lab1: [f64; 3], lab2: [f64; 3]) -> f64 {
    let dl = lab1[0] - lab2[0];
    let da = lab1[1] - lab2[1];
    let db = lab1[2] - lab2[2];
    dl * dl + 1.8 * da * da + 1.8 * db * db
}

/// Computes saturation metric in OKLab space: sqrt(a^2 + b^2).
#[inline]
pub fn oklab_chroma(lab: [f64; 3]) -> f64 {
    (lab[1] * lab[1] + lab[2] * lab[2]).sqrt()
}
