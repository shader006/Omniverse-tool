use axum::{
    extract::{DefaultBodyLimit, Multipart, Query},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Json, Response},
    routing::{get, post},
    Router,
};
use image::{DynamicImage, ImageFormat, RgbaImage};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::Cursor,
    net::SocketAddr,
    sync::OnceLock,
    time::{Instant, SystemTime, UNIX_EPOCH},
};
use tokio::sync::mpsc;
use tower_http::cors::{Any, CorsLayer};

use worker_pixelfixer::{advanced_refine, core, reconstruct, topological_engine};

pub struct SpanEvent {
    pub trace_id: Option<String>,
    pub parent_span_id: Option<String>,
    pub name: String,
    pub duration_ms: f64,
    pub attributes: HashMap<String, serde_json::Value>,
    pub is_error: bool,
}

static TRACE_TX: OnceLock<mpsc::Sender<SpanEvent>> = OnceLock::new();

fn parse_traceparent(headers: &axum::http::HeaderMap) -> (Option<String>, Option<String>) {
    if let Some(val) = headers.get("traceparent").and_then(|v| v.to_str().ok()) {
        if val.starts_with("00-") {
            let parts: Vec<&str> = val.split('-').collect();
            if parts.len() >= 3 && parts[1].len() == 32 {
                return (Some(parts[1].to_string()), Some(parts[2].to_string()));
            }
        }
    }
    (None, None)
}

fn send_otlp_trace(
    trace_id: Option<String>,
    parent_span_id: Option<String>,
    name: &str,
    duration_ms: f64,
    attributes: HashMap<String, serde_json::Value>,
    is_error: bool,
) {
    if let Some(tx) = TRACE_TX.get() {
        let _ = tx.try_send(SpanEvent {
            trace_id,
            parent_span_id,
            name: name.to_string(),
            duration_ms,
            attributes,
            is_error,
        });
    }
}

fn init_telemetry() {
    let observe_url = std::env::var("HIAI_OBSERVE_URL")
        .unwrap_or_else(|_| "http://172.17.0.1:8001".to_string());
    let api_key = match std::env::var("HIAI_OBSERVE_API_KEY") {
        Ok(k) if !k.is_empty() => k,
        _ => {
            tracing::info!("HiAI Observe API Key not set; OTLP tracing disabled.");
            return;
        }
    };

    let (tx, mut rx) = mpsc::channel::<SpanEvent>(1000);
    let _ = TRACE_TX.set(tx);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build()
        .unwrap_or_default();

    tokio::spawn(async move {
        tracing::info!(
            "🚀 HiAi Observe OTLP Tracer initialized for worker-pixelfixer -> {}/v1/traces",
            observe_url
        );
        while let Some(event) = rx.recv().await {
            let now = SystemTime::now();
            let now_ns = now
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            let start_ns = now_ns.saturating_sub((event.duration_ms * 1_000_000.0) as u128);

            let trace_id = event
                .trace_id
                .unwrap_or_else(|| uuid::Uuid::new_v4().simple().to_string());
            let span_id = uuid::Uuid::new_v4().simple().to_string()[..16].to_string();

            let mut attrs_list = vec![
                serde_json::json!({ "key": "service.name", "value": { "stringValue": "worker-pixelfixer" } }),
                serde_json::json!({ "key": "deployment.environment", "value": { "stringValue": "production" } }),
            ];

            for (k, v) in event.attributes {
                if let Some(n) = v.as_f64() {
                    attrs_list.push(serde_json::json!({ "key": k, "value": { "doubleValue": n } }));
                } else if let Some(b) = v.as_bool() {
                    attrs_list.push(serde_json::json!({ "key": k, "value": { "boolValue": b } }));
                } else {
                    attrs_list.push(serde_json::json!({ "key": k, "value": { "stringValue": v.to_string().trim_matches('"') } }));
                }
            }

            let mut span_json = serde_json::json!({
                "traceId": trace_id,
                "spanId": span_id,
                "name": event.name,
                "kind": 1,
                "startTimeUnixNano": start_ns.to_string(),
                "endTimeUnixNano": now_ns.to_string(),
                "attributes": attrs_list,
                "status": { "code": if event.is_error { 2 } else { 1 } }
            });
            if let Some(parent) = event.parent_span_id {
                span_json["parentSpanId"] = serde_json::json!(parent);
            }

            let payload = serde_json::json!({
                "resourceSpans": [
                    {
                        "resource": {
                            "attributes": [
                                { "key": "service.name", "value": { "stringValue": "worker-pixelfixer" } },
                                { "key": "deployment.environment", "value": { "stringValue": "production" } }
                            ]
                        },
                        "scopeSpans": [
                            {
                                "scope": { "name": "pixelfixer-tracer", "version": "1.0.0" },
                                "spans": [span_json]
                            }
                        ]
                    }
                ]
            });

            let _ = client
                .post(format!("{}/v1/traces", observe_url))
                .header("Authorization", format!("Bearer {}", api_key))
                .header("Content-Type", "application/json")
                .json(&payload)
                .send()
                .await;
        }
    });
}


#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct GridCandidate {
    pub size: u32,
    pub confidence: u32,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct DetectResponse {
    pub success: bool,
    pub width: u32,
    pub height: u32,
    pub step_x: f64,
    pub step_y: f64,
    pub cols: u32,
    pub rows: u32,
    pub offset_x: f64,
    pub offset_y: f64,
    pub consensus: String,
    pub confidence: u32,
    pub candidates: Vec<GridCandidate>,
    pub secs: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cached: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_file: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub download_url: Option<String>,
}

#[derive(Deserialize, Debug, Default)]
pub struct DetectParams {
    pub mode: Option<String>,
}

#[derive(Deserialize, Debug, Default)]
pub struct FixParams {
    pub mode: Option<String>, // "advanced", "elastic", or "legacy"
    pub algo: Option<String>, // "sota" or "original"
    pub cols: Option<u32>,
    pub rows: Option<u32>,
    pub step_x: Option<f64>,
    pub step_y: Option<f64>,
    pub offset_x: Option<f64>,
    pub offset_y: Option<f64>,
    pub auto_palette: Option<bool>,
    pub two_stage: Option<bool>,
    pub k_colors: Option<usize>,
    pub max_colors: Option<usize>,
    pub palette: Option<String>,
    pub elastic: Option<bool>,
}

const PALETTE_GAMEBOY: &[[u8; 3]] = &[
    [15, 56, 15],
    [48, 98, 48],
    [139, 172, 15],
    [155, 188, 15],
];

const PALETTE_PICO8: &[[u8; 3]] = &[
    [0, 0, 0], [29, 43, 83], [126, 37, 83], [0, 135, 81],
    [171, 82, 54], [95, 87, 79], [194, 195, 199], [255, 241, 232],
    [255, 0, 77], [255, 163, 0], [255, 236, 39], [0, 228, 54],
    [41, 173, 255], [131, 118, 156], [255, 119, 168], [255, 204, 170],
];

const PALETTE_NES: &[[u8; 3]] = &[
    [124, 124, 124], [0, 0, 252], [0, 0, 188], [68, 40, 188], [148, 0, 132], [168, 0, 32],
    [168, 16, 0], [136, 20, 0], [80, 48, 0], [0, 120, 0], [0, 104, 0], [0, 88, 0],
    [0, 64, 88], [0, 0, 0], [188, 188, 188], [0, 120, 248], [0, 88, 248], [104, 68, 252],
    [216, 0, 204], [228, 0, 88], [248, 56, 0], [228, 92, 16], [172, 124, 0], [0, 184, 0],
    [0, 168, 0], [0, 168, 68], [0, 136, 136], [248, 248, 248], [60, 188, 252], [104, 136, 252],
    [152, 120, 248], [248, 120, 248], [248, 88, 152], [248, 120, 88], [252, 160, 68], [248, 184, 0],
    [184, 248, 24], [88, 216, 84], [88, 248, 152], [0, 232, 216], [120, 120, 120], [252, 252, 252],
    [164, 228, 252], [184, 184, 248], [216, 184, 248], [248, 184, 248], [248, 164, 192], [240, 208, 176],
    [252, 224, 168], [248, 216, 120], [216, 248, 120], [184, 248, 184], [184, 248, 216], [0, 252, 252],
];

fn snap_to_palette(rgba: &mut [u8], palette: &[[u8; 3]]) {
    for chunk in rgba.chunks_exact_mut(4) {
        if chunk[3] < 32 {
            chunk[3] = 0;
            continue;
        }
        let r = chunk[0] as f64;
        let g = chunk[1] as f64;
        let b = chunk[2] as f64;
        let mut min_d = f64::MAX;
        let mut best = palette[0];
        for &p in palette {
            let dr = r - p[0] as f64;
            let dg = g - p[1] as f64;
            let db = b - p[2] as f64;
            let d = dr * dr * 0.299 + dg * dg * 0.587 + db * db * 0.114;
            if d < min_d {
                min_d = d;
                best = p;
            }
        }
        chunk[0] = best[0];
        chunk[1] = best[1];
        chunk[2] = best[2];
        chunk[3] = 255;
    }
}

fn sha256_hex(data: &[u8]) -> String {
    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ];
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    let bit_len = (data.len() as u64) * 8;
    let mut msg = data.to_vec();
    msg.push(0x80);
    while (msg.len() + 8) % 64 != 0 {
        msg.push(0x00);
    }
    msg.extend_from_slice(&bit_len.to_be_bytes());

    for chunk in msg.chunks_exact(64) {
        let mut w = [0u32; 64];
        for i in 0..16 {
            w[i] = u32::from_be_bytes([chunk[4 * i], chunk[4 * i + 1], chunk[4 * i + 2], chunk[4 * i + 3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16].wrapping_add(s0).wrapping_add(w[i - 7]).wrapping_add(s1);
        }
        let (mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut h_val) =
            (h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7]);
        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ (!e & g);
            let temp1 = h_val.wrapping_add(s1).wrapping_add(ch).wrapping_add(K[i]).wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(maj);
            h_val = g; g = f; f = e; e = d.wrapping_add(temp1);
            d = c; c = b; b = a; a = temp1.wrapping_add(temp2);
        }
        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
        h[5] = h[5].wrapping_add(f);
        h[6] = h[6].wrapping_add(g);
        h[7] = h[7].wrapping_add(h_val);
    }
    format!("{:08x}{:08x}{:08x}{:08x}{:08x}{:08x}{:08x}{:08x}",
        h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7])
}

fn compute_hash_16(data: &[u8]) -> String {
    sha256_hex(data)[..16].to_string()
}

fn sanitize_filename(name: &str) -> String {
    let base = std::path::Path::new(name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("image");
    let sanitized: String = base
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '_' })
        .collect();
    if sanitized.is_empty() {
        "image".to_string()
    } else {
        sanitized
    }
}

fn get_download_dir() -> std::path::PathBuf {
    let dir = std::env::var("DOWNLOAD_DIR").unwrap_or_else(|_| "/app/downloads".to_string());
    let path = std::path::PathBuf::from(dir);
    let _ = std::fs::create_dir_all(&path);
    path
}

#[derive(Serialize, Deserialize)]
struct CachedFixMeta {
    cols: usize,
    rows: usize,
    step_x: f64,
    step_y: f64,
    #[serde(default)]
    offset_x: f64,
    #[serde(default)]
    offset_y: f64,
    consensus: String,
    topology: String,
    candidates_json: String,
}

fn collect_candidates(primary_step: f64, consensus_conf: u32) -> Vec<GridCandidate> {
    let mut scores: HashMap<u32, f64> = HashMap::new();
    let primary_int = primary_step.round() as u32;
    if primary_int >= 1 {
        scores.insert(primary_int, 100.0);
    }

    // Gợi ý thêm các ước số và bội số chuẩn pixel art
    for &candidate in &[1u32, 2, 3, 4, 6, 8, 12, 16] {
        if candidate != primary_int {
            let ratio = primary_step / (candidate as f64);
            let diff = (ratio.round() - ratio).abs();
            if diff < 0.15 {
                let conf = (70.0 - diff * 150.0).max(20.0);
                scores.entry(candidate).or_insert(conf);
            }
        }
    }

    let mut list: Vec<GridCandidate> = scores
        .into_iter()
        .map(|(size, raw)| {
            let conf = if size == primary_int {
                consensus_conf
            } else {
                (raw as u32).min(consensus_conf.saturating_sub(10)).max(15)
            };
            GridCandidate { size, confidence: conf }
        })
        .collect();

    list.sort_by(|a, b| b.confidence.cmp(&a.confidence).then_with(|| a.size.cmp(&b.size)));
    list.truncate(5);
    list
}

async fn health_handler() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "ok",
        "service": "worker-pixelfixer",
        "engine": "Pixel Art Fixer Native Rust (Rayon Multi-threaded)"
    }))
}

async fn detect_handler(
    headers: axum::http::HeaderMap,
    Query(query): Query<DetectParams>,
    mut multipart: Multipart,
) -> Result<Json<DetectResponse>, (StatusCode, Json<serde_json::Value>)> {
    let (trace_id, parent_span_id) = parse_traceparent(&headers);
    let t0 = Instant::now();
    let mut image_bytes: Option<Vec<u8>> = None;
    let mut original_filename = "source.png".to_string();
    let mut mode_override: Option<String> = query.mode;

    while let Ok(Some(field)) = multipart.next_field().await {
        let name = field.name().unwrap_or("").to_string();
        if name == "file" || name == "image" {
            if let Some(fname) = field.file_name() {
                if !fname.is_empty() {
                    original_filename = fname.to_string();
                }
            }
            if let Ok(bytes) = field.bytes().await {
                image_bytes = Some(bytes.to_vec());
            }
        } else if name == "mode" {
            if let Ok(txt) = field.text().await {
                mode_override = Some(txt);
            }
        }
    }

    let bytes = match image_bytes {
        Some(b) if !b.is_empty() => b,
        _ => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "success": false, "error": "Missing 'file' multipart field" })),
            ));
        }
    };

    let base_name = sanitize_filename(&original_filename);
    let in_hash = compute_hash_16(&bytes);
    let in_filename = format!("{}_{}_input.png", in_hash, base_name);

    let download_dir = get_download_dir();
    let in_filepath = download_dir.join(&in_filename);
    if !in_filepath.exists() {
        let _ = std::fs::write(&in_filepath, &bytes);
    }

    let detect_cache_filename = format!("{}_{}_detect_advanced.json", in_hash, base_name);
    let detect_cache_filepath = download_dir.join(&detect_cache_filename);

    if detect_cache_filepath.exists() {
        if let Ok(cached_str) = std::fs::read_to_string(&detect_cache_filepath) {
            if let Ok(mut resp) = serde_json::from_str::<DetectResponse>(&cached_str) {
                if resp.confidence >= 70 {
                    let dur_ms = t0.elapsed().as_secs_f64() * 1000.0;
                    tracing::info!(
                        "⚡ [DETECT CACHE HIT] {} | mode: advanced in {:.2}ms",
                        in_filename, dur_ms
                    );
                    resp.cached = Some(true);
                    resp.input_file = Some(in_filename.clone());
                    resp.download_url = Some(format!("/api/file/{}", in_filename));
                    resp.secs = dur_ms / 1000.0;
                    return Ok(Json(resp));
                }
            }
        }
    }

    let dyn_img = match image::load_from_memory(&bytes) {
        Ok(img) => img,
        Err(e) => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "success": false, "error": format!("Cannot decode image: {}", e) })),
            ));
        }
    };

    let rgba = dyn_img.to_rgba8();
    let (w, h) = (rgba.width() as usize, rgba.height() as usize);
    let raw = rgba.as_raw();

    let res = core::detect_full(raw, w, h);

    let (offset_x, offset_y) = reconstruct::find_grid_phase(raw, w, h, res.step_x, res.step_y);
    let avg_step = (res.step_x + res.step_y) / 2.0;
    let confidence = if res.consensus == "arbitrated" {
        98
    } else if res.consensus.contains("consensus") {
        95
    } else {
        85
    };

    let candidates = collect_candidates(avg_step, confidence);
    let secs = t0.elapsed().as_secs_f64();
    let dur_ms = secs * 1000.0;

    tracing::info!(
        "🔍 [DETECT ADVANCED] {}x{} | grid: {}x{} (conf: {}%) in {:.2}ms",
        w, h, res.cols, res.rows, confidence, dur_ms
    );

    let mut trace_attrs = HashMap::new();
    trace_attrs.insert("image.width".to_string(), serde_json::json!(w));
    trace_attrs.insert("image.height".to_string(), serde_json::json!(h));
    trace_attrs.insert("detect.mode".to_string(), serde_json::json!("advanced"));
    trace_attrs.insert("grid.cols".to_string(), serde_json::json!(res.cols));
    trace_attrs.insert("grid.rows".to_string(), serde_json::json!(res.rows));
    trace_attrs.insert("grid.confidence".to_string(), serde_json::json!(confidence));
    trace_attrs.insert("grid.consensus".to_string(), serde_json::json!(res.consensus));
    send_otlp_trace(
        trace_id,
        parent_span_id,
        " └─ 👾 [Xử lý Rust] Nhận diện lưới pixel (Detect Grid - Advanced)",
        dur_ms,
        trace_attrs,
        false,
    );

    let resp = DetectResponse {
        success: true,
        width: w as u32,
        height: h as u32,
        step_x: res.step_x,
        step_y: res.step_y,
        cols: res.cols.max(1) as u32,
        rows: res.rows.max(1) as u32,
        offset_x,
        offset_y,
        consensus: res.consensus,
        confidence,
        candidates,
        secs,
        error: None,
        cached: Some(false),
        input_file: Some(in_filename.clone()),
        download_url: Some(format!("/api/file/{}", in_filename)),
    };

    if resp.confidence >= 70 {
        if let Ok(resp_json) = serde_json::to_string(&resp) {
            let _ = std::fs::write(&detect_cache_filepath, resp_json);
        }
    }

    Ok(Json(resp))
}

async fn fix_handler(
    headers: axum::http::HeaderMap,
    Query(query): Query<FixParams>,
    mut multipart: Multipart,
) -> Result<Response, (StatusCode, Json<serde_json::Value>)> {
    let (trace_id, parent_span_id) = parse_traceparent(&headers);
    let t0 = Instant::now();
    let mut image_bytes: Option<Vec<u8>> = None;
    let mut original_filename = "source.png".to_string();
    let mut req_mode = query.mode;
    let mut req_algo = query.algo;
    let mut req_cols = query.cols;
    let mut req_rows = query.rows;
    let mut req_step_x = query.step_x;
    let mut req_step_y = query.step_y;
    let mut req_offset_x = query.offset_x;
    let mut req_offset_y = query.offset_y;
    let mut _auto_palette = query.auto_palette.unwrap_or(true);
    let mut _req_two_stage = query.two_stage;
    let mut req_k_colors = query.k_colors.or(query.max_colors);
    let mut req_palette = query.palette;
    let mut req_elastic = query.elastic;

    while let Ok(Some(field)) = multipart.next_field().await {
        let name = field.name().unwrap_or("").to_string();
        if name == "file" || name == "image" {
            if let Some(fname) = field.file_name() {
                if !fname.is_empty() {
                    original_filename = fname.to_string();
                }
            }
            if let Ok(bytes) = field.bytes().await {
                image_bytes = Some(bytes.to_vec());
            }
        } else if name == "mode" {
            if let Ok(txt) = field.text().await { req_mode = Some(txt); }
        } else if name == "algo" {
            if let Ok(txt) = field.text().await { req_algo = Some(txt); }
        } else if name == "cols" {
            if let Ok(txt) = field.text().await { req_cols = txt.parse().ok(); }
        } else if name == "rows" {
            if let Ok(txt) = field.text().await { req_rows = txt.parse().ok(); }
        } else if name == "step_x" {
            if let Ok(txt) = field.text().await { req_step_x = txt.parse().ok(); }
        } else if name == "step_y" {
            if let Ok(txt) = field.text().await { req_step_y = txt.parse().ok(); }
        } else if name == "offset_x" {
            if let Ok(txt) = field.text().await { req_offset_x = txt.parse().ok(); }
        } else if name == "offset_y" {
            if let Ok(txt) = field.text().await { req_offset_y = txt.parse().ok(); }
        } else if name == "auto_palette" {
            if let Ok(txt) = field.text().await { _auto_palette = txt == "true" || txt == "1"; }
        } else if name == "two_stage" {
            if let Ok(txt) = field.text().await { _req_two_stage = Some(txt == "true" || txt == "1"); }
        } else if name == "k_colors" || name == "max_colors" {
            if let Ok(txt) = field.text().await { req_k_colors = txt.parse().ok(); }
        } else if name == "palette" {
            if let Ok(txt) = field.text().await { req_palette = Some(txt); }
        } else if name == "elastic" {
            if let Ok(txt) = field.text().await { req_elastic = Some(txt == "true" || txt == "1"); }
        }
    }

    let bytes = match image_bytes {
        Some(b) if !b.is_empty() => b,
        _ => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "success": false, "error": "Missing 'file' field" })),
            ));
        }
    };

    let base_name = sanitize_filename(&original_filename);
    let in_hash = compute_hash_16(&bytes);
    let in_filename = format!("{}_{}_input.png", in_hash, base_name);

    let download_dir = get_download_dir();
    let in_filepath = download_dir.join(&in_filename);
    if !in_filepath.exists() {
        let _ = std::fs::write(&in_filepath, &bytes);
    }

    // 1. Phân tích tham số phục chế (Cố định thuật toán Gốc của Pixel Art Fixer)
    let algo_choice = "original";
    let is_elastic = req_elastic.unwrap_or_else(|| req_mode.as_deref() == Some("elastic") || req_mode.as_deref() == Some("elastic_sota"));
    let k_colors = req_k_colors.unwrap_or(0);

    // 2. Tính toán Cache Key phân tách độc lập (kèm palette)
    let pal_str = req_palette.as_deref().unwrap_or("auto");
    let param_key = format!(
        "{}_cols{:?}_rows{:?}_sx{:?}_sy{:?}_ox{:?}_oy{:?}_k{}_pal{}_el{}",
        in_hash, req_cols, req_rows, req_step_x, req_step_y, req_offset_x, req_offset_y, k_colors, pal_str, is_elastic
    );
    let cache_key = compute_hash_16(param_key.as_bytes());
    let out_filename = format!("{}_{}_pixel.png", cache_key, base_name);
    let meta_filename = format!("{}_{}_pixel.meta.json", cache_key, base_name);
    let out_filepath = download_dir.join(&out_filename);
    let meta_filepath = download_dir.join(&meta_filename);

    // 3. Kiểm tra CACHE HIT
    if out_filepath.exists() && meta_filepath.exists() {
        if let (Ok(out_bytes), Ok(meta_str)) = (std::fs::read(&out_filepath), std::fs::read_to_string(&meta_filepath)) {
            if let Ok(meta) = serde_json::from_str::<CachedFixMeta>(&meta_str) {
                let dur_ms = t0.elapsed().as_secs_f64() * 1000.0;
                tracing::info!(
                    "⚡ [FIX CACHE HIT] In: {} -> Out: {} ({} bytes, {}x{}, algo: original) in {:.2}ms",
                    in_filename, out_filename, out_bytes.len(), meta.cols, meta.rows, dur_ms
                );

                let mut headers = HeaderMap::new();
                headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("image/png"));
                headers.insert("X-Cache", HeaderValue::from_static("HIT"));
                headers.insert("X-Reconstruct-Algo", HeaderValue::from_static("original"));
                if let Ok(v) = HeaderValue::from_str(&format!("/api/file/{}", out_filename)) {
                    headers.insert("X-Download-Url", v);
                }
                if let Ok(v) = HeaderValue::from_str(&out_filename) {
                    headers.insert("X-Filename", v);
                }
                if let Ok(v) = HeaderValue::from_str(&in_filename) {
                    headers.insert("X-Input-Filename", v);
                }
                if let Ok(v) = HeaderValue::from_str(&meta.cols.to_string()) {
                    headers.insert("X-Grid-Cols", v);
                }
                if let Ok(v) = HeaderValue::from_str(&meta.rows.to_string()) {
                    headers.insert("X-Grid-Rows", v);
                }
                if let Ok(v) = HeaderValue::from_str(&format!("{:.2}", meta.step_x)) {
                    headers.insert("X-Grid-StepX", v);
                }
                if let Ok(v) = HeaderValue::from_str(&format!("{:.2}", meta.step_y)) {
                    headers.insert("X-Grid-StepY", v);
                }
                if let Ok(v) = HeaderValue::from_str(&format!("{:.2}", meta.offset_x)) {
                    headers.insert("X-Grid-OffsetX", v);
                }
                if let Ok(v) = HeaderValue::from_str(&format!("{:.2}", meta.offset_y)) {
                    headers.insert("X-Grid-OffsetY", v);
                }
                if let Ok(v) = HeaderValue::from_str(&meta.consensus) {
                    headers.insert("X-Grid-Consensus", v);
                }
                if let Ok(v) = HeaderValue::from_str(&meta.topology) {
                    headers.insert("X-Grid-Topology", v);
                }
                if let Ok(v) = HeaderValue::from_str(&meta.candidates_json) {
                    headers.insert("X-Grid-Candidates", v);
                }

                let mut trace_attrs = HashMap::new();
                trace_attrs.insert("cache.hit".to_string(), serde_json::json!(true));
                trace_attrs.insert("image.out_bytes".to_string(), serde_json::json!(out_bytes.len()));
                send_otlp_trace(
                    trace_id.clone(),
                    parent_span_id.clone(),
                    " └─ ✨ [Xử lý Rust] Tái tạo Sprite Pixel Art (Cache Hit)",
                    dur_ms,
                    trace_attrs,
                    false,
                );

                return Ok((headers, out_bytes).into_response());
            }
        }
    }

    // 4. CACHE MISS -> Tái tạo sprite pixel art
    let dyn_img = match image::load_from_memory(&bytes) {
        Ok(img) => img,
        Err(e) => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "success": false, "error": format!("Cannot decode image: {}", e) })),
            ));
        }
    };

    let rgba = dyn_img.to_rgba8();
    let (w, h) = (rgba.width() as usize, rgba.height() as usize);
    let raw = rgba.as_raw();

    // 5. Nếu chưa có cols/rows/step, tự động chạy detect (hỗ trợ nhập step_x/step_y số thập phân)
    let (step_x, step_y, cols, rows, consensus, auto_offset_x, auto_offset_y) = match (req_step_x, req_step_y, req_cols, req_rows) {
        (Some(sx), Some(sy), Some(c), Some(r)) => (sx, sy, c as usize, r as usize, "manual".to_string(), 0.0, 0.0),
        (Some(sx), Some(sy), None, None) => {
            let c = ((w as f64) / sx).round().max(1.0) as usize;
            let r = ((h as f64) / sy).round().max(1.0) as usize;
            (sx, sy, c, r, "manual_step".to_string(), 0.0, 0.0)
        }
        (Some(sx), None, None, None) => {
            let c = ((w as f64) / sx).round().max(1.0) as usize;
            let r = ((h as f64) / sx).round().max(1.0) as usize;
            (sx, sx, c, r, "manual_step".to_string(), 0.0, 0.0)
        }
        (None, None, Some(c), Some(r)) => {
            let sx = (w as f64) / (c as f64);
            let sy = (h as f64) / (r as f64);
            (sx, sy, c as usize, r as usize, "manual_cols_rows".to_string(), 0.0, 0.0)
        }
        _ => {
            let d = core::detect_full(raw, w, h);
            (d.step_x, d.step_y, d.cols.max(1) as usize, d.rows.max(1) as usize, d.consensus, d.offset_x, d.offset_y)
        }
    };

    let offset_x = req_offset_x.unwrap_or_else(|| {
        if auto_offset_x != 0.0 {
            auto_offset_x
        } else {
            reconstruct::find_grid_phase(raw, w, h, step_x, step_y).0
        }
    });
    let offset_y = req_offset_y.unwrap_or_else(|| {
        if auto_offset_y != 0.0 {
            auto_offset_y
        } else {
            reconstruct::find_grid_phase(raw, w, h, step_x, step_y).1
        }
    });

    // 6. Tái tạo sprite pixel art bằng Thuật toán Gốc (Two-Stage K-Means của Pixel Art Fixer)
    let out = reconstruct::two_stage_pack(
        raw,
        w,
        h,
        cols,
        rows,
        k_colors,
        is_elastic,
        offset_x,
        offset_y,
    );
    let (mut recon_rgba, recon_cols, recon_rows, topology_label) = (
        out.rgba,
        out.cols,
        out.rows,
        if is_elastic { "elastic_original" } else { "uniform_original" }
    );

    match pal_str {
        "gameboy" => snap_to_palette(&mut recon_rgba, PALETTE_GAMEBOY),
        "pico8" => snap_to_palette(&mut recon_rgba, PALETTE_PICO8),
        "nes" => snap_to_palette(&mut recon_rgba, PALETTE_NES),
        _ => {}
    }

    let out_img = match RgbaImage::from_raw(recon_cols as u32, recon_rows as u32, recon_rgba) {
        Some(img) => DynamicImage::ImageRgba8(img),
        None => {
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "success": false, "error": "Failed to create RGBA sprite buffer" })),
            ));
        }
    };

    let mut png_buf = Cursor::new(Vec::new());
    if let Err(e) = out_img.write_to(&mut png_buf, ImageFormat::Png) {
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "success": false, "error": format!("Failed to encode PNG: {}", e) })),
        ));
    }

    let out_bytes = png_buf.into_inner();
    let out_len = out_bytes.len();

    // 7. Lưu file kết quả và metadata vào DOWNLOAD_DIR (dùng chung với Gateway và dọn dẹp bởi Pogocache)
    let _ = std::fs::write(&out_filepath, &out_bytes);

    let candidates = collect_candidates(step_x, 95);
    let cand_json = serde_json::to_string(&candidates).unwrap_or_else(|_| "[]".to_string());

    let meta = CachedFixMeta {
        cols: recon_cols,
        rows: recon_rows,
        step_x,
        step_y,
        offset_x,
        offset_y,
        consensus: consensus.clone(),
        topology: topology_label.to_string(),
        candidates_json: cand_json.clone(),
    };
    if let Ok(meta_str) = serde_json::to_string(&meta) {
        let _ = std::fs::write(&meta_filepath, meta_str);
    }

    let mut headers = HeaderMap::new();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("image/png"));
    headers.insert("X-Cache", HeaderValue::from_static("MISS"));
    if let Ok(v) = HeaderValue::from_str(&format!("/api/file/{}", out_filename)) {
        headers.insert("X-Download-Url", v);
    }
    if let Ok(v) = HeaderValue::from_str(&out_filename) {
        headers.insert("X-Filename", v);
    }
    if let Ok(v) = HeaderValue::from_str(&in_filename) {
        headers.insert("X-Input-Filename", v);
    }
    if let Ok(v) = HeaderValue::from_str(&recon_cols.to_string()) {
        headers.insert("X-Grid-Cols", v);
    }
    if let Ok(v) = HeaderValue::from_str(&recon_rows.to_string()) {
        headers.insert("X-Grid-Rows", v);
    }
    if let Ok(v) = HeaderValue::from_str(&format!("{:.2}", step_x)) {
        headers.insert("X-Grid-StepX", v);
    }
    if let Ok(v) = HeaderValue::from_str(&format!("{:.2}", step_y)) {
        headers.insert("X-Grid-StepY", v);
    }
    if let Ok(v) = HeaderValue::from_str(&format!("{:.2}", offset_x)) {
        headers.insert("X-Grid-OffsetX", v);
    }
    if let Ok(v) = HeaderValue::from_str(&format!("{:.2}", offset_y)) {
        headers.insert("X-Grid-OffsetY", v);
    }
    if let Ok(v) = HeaderValue::from_str(&consensus) {
        headers.insert("X-Grid-Consensus", v);
    }
    if let Ok(v) = HeaderValue::from_str(&cand_json) {
        headers.insert("X-Grid-Candidates", v);
    }
    headers.insert(
        "X-Grid-Topology",
        HeaderValue::from_static(topology_label),
    );
    headers.insert(
        "X-Reconstruct-Algo",
        HeaderValue::from_static("original"),
    );

    let dur_ms = t0.elapsed().as_secs_f64() * 1000.0;

    tracing::info!(
        "🛠️ [FIX] In: {}x{} -> Out: {}x{} ({} bytes, grid: {:.2}x{:.2}, offset: {:.2}x{:.2}, topology: {}, algo: original) in {:.2}ms [File: {}]",
        w, h, recon_cols, recon_rows, out_len, step_x, step_y, offset_x, offset_y, if is_elastic { "elastic" } else { "uniform" }, dur_ms, out_filename
    );

    let mut trace_attrs = HashMap::new();
    trace_attrs.insert("image.in_width".to_string(), serde_json::json!(w));
    trace_attrs.insert("image.in_height".to_string(), serde_json::json!(h));
    trace_attrs.insert("image.out_cols".to_string(), serde_json::json!(recon_cols));
    trace_attrs.insert("image.out_rows".to_string(), serde_json::json!(recon_rows));
    trace_attrs.insert("grid.step_x".to_string(), serde_json::json!(step_x));
    trace_attrs.insert("grid.offset_x".to_string(), serde_json::json!(offset_x));
    trace_attrs.insert("grid.offset_y".to_string(), serde_json::json!(offset_y));
    trace_attrs.insert("reconstruct.algo".to_string(), serde_json::json!("original"));
    trace_attrs.insert("reconstruct.elastic".to_string(), serde_json::json!(is_elastic));
    trace_attrs.insert("image.out_bytes".to_string(), serde_json::json!(out_len));
    trace_attrs.insert("out.filename".to_string(), serde_json::json!(out_filename));
    send_otlp_trace(
        trace_id,
        parent_span_id,
        " └─ ✨ [Xử lý Rust] Tái tạo Sprite Pixel Art (Reconstruct)",
        dur_ms,
        trace_attrs,
        false,
    );

    Ok((headers, out_bytes).into_response())
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    init_telemetry();

    let app = Router::new()
        .route("/health", get(health_handler))
        .route("/detect", post(detect_handler))
        .route("/api/pixel/detect", post(detect_handler))
        .route("/fix", post(fix_handler))
        .route("/api/pixel/fix", post(fix_handler))
        .layer(DefaultBodyLimit::max(50 * 1024 * 1024))
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        );

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8004);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    println!("🦀 [worker-pixelfixer] Native Rust Engine running on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.expect("Failed to bind port");
    axum::serve(listener, app).await.expect("Server error");
}
