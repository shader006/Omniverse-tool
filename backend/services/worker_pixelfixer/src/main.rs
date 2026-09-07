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

use worker_pixelfixer::{core, reconstruct};

pub struct SpanEvent {
    pub name: String,
    pub duration_ms: f64,
    pub attributes: HashMap<String, serde_json::Value>,
    pub is_error: bool,
}

static TRACE_TX: OnceLock<mpsc::Sender<SpanEvent>> = OnceLock::new();

fn send_otlp_trace(
    name: &str,
    duration_ms: f64,
    attributes: HashMap<String, serde_json::Value>,
    is_error: bool,
) {
    if let Some(tx) = TRACE_TX.get() {
        let _ = tx.try_send(SpanEvent {
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

            let trace_id = uuid::Uuid::new_v4().simple().to_string();
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
                                "spans": [
                                    {
                                        "traceId": trace_id,
                                        "spanId": span_id,
                                        "name": event.name,
                                        "kind": 1,
                                        "startTimeUnixNano": start_ns.to_string(),
                                        "endTimeUnixNano": now_ns.to_string(),
                                        "attributes": attrs_list,
                                        "status": { "code": if event.is_error { 2 } else { 1 } }
                                    }
                                ]
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
}

#[derive(Deserialize, Debug, Default)]
pub struct DetectParams {
    pub mode: Option<String>, // "full" or "fast"
}

#[derive(Deserialize, Debug, Default)]
pub struct FixParams {
    pub mode: Option<String>, // "full", "fast", or "legacy"
    pub cols: Option<u32>,
    pub rows: Option<u32>,
    pub step_x: Option<f64>,
    pub step_y: Option<f64>,
    pub auto_palette: Option<bool>,
    pub two_stage: Option<bool>,
    pub k_colors: Option<usize>,
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
    Query(query): Query<DetectParams>,
    mut multipart: Multipart,
) -> Result<Json<DetectResponse>, (StatusCode, Json<serde_json::Value>)> {
    let t0 = Instant::now();
    let mut image_bytes: Option<Vec<u8>> = None;
    let mut mode_override: Option<String> = query.mode;

    while let Ok(Some(field)) = multipart.next_field().await {
        let name = field.name().unwrap_or("").to_string();
        if name == "file" || name == "image" {
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

    let mode = mode_override.unwrap_or_else(|| "full".to_string());
    let res = if mode == "fast" {
        core::detect_fast(raw, w, h)
    } else {
        core::detect_full(raw, w, h)
    };

    let (offset_x, offset_y) = reconstruct::find_grid_phase(raw, w, h, res.step_x, res.step_y);
    let avg_step = (res.step_x + res.step_y) / 2.0;
    let confidence = if res.consensus.starts_with("fast:ac+rl") {
        98
    } else if res.consensus.starts_with("fast") {
        92
    } else if res.consensus == "arbitrated" {
        95
    } else {
        60
    };

    let candidates = collect_candidates(avg_step, confidence);
    let secs = t0.elapsed().as_secs_f64();
    let dur_ms = secs * 1000.0;

    tracing::info!(
        "🔍 [DETECT] {}x{} | mode: {} | grid: {}x{} (conf: {}%) in {:.2}ms",
        w, h, mode, res.cols, res.rows, confidence, dur_ms
    );

    let mut trace_attrs = HashMap::new();
    trace_attrs.insert("image.width".to_string(), serde_json::json!(w));
    trace_attrs.insert("image.height".to_string(), serde_json::json!(h));
    trace_attrs.insert("detect.mode".to_string(), serde_json::json!(mode));
    trace_attrs.insert("grid.cols".to_string(), serde_json::json!(res.cols));
    trace_attrs.insert("grid.rows".to_string(), serde_json::json!(res.rows));
    trace_attrs.insert("grid.confidence".to_string(), serde_json::json!(confidence));
    trace_attrs.insert("grid.consensus".to_string(), serde_json::json!(res.consensus));
    send_otlp_trace("pixelfixer.detect", dur_ms, trace_attrs, false);

    Ok(Json(DetectResponse {
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
    }))
}

async fn fix_handler(
    Query(query): Query<FixParams>,
    mut multipart: Multipart,
) -> Result<Response, (StatusCode, Json<serde_json::Value>)> {
    let t0 = Instant::now();
    let mut image_bytes: Option<Vec<u8>> = None;
    let mut req_mode = query.mode;
    let mut req_cols = query.cols;
    let mut req_rows = query.rows;
    let mut req_step_x = query.step_x;
    let mut req_step_y = query.step_y;
    let mut auto_palette = query.auto_palette.unwrap_or(true);
    let mut req_two_stage = query.two_stage;
    let mut req_k_colors = query.k_colors;

    while let Ok(Some(field)) = multipart.next_field().await {
        let name = field.name().unwrap_or("").to_string();
        if name == "file" || name == "image" {
            if let Ok(bytes) = field.bytes().await {
                image_bytes = Some(bytes.to_vec());
            }
        } else if name == "mode" {
            if let Ok(txt) = field.text().await { req_mode = Some(txt); }
        } else if name == "cols" {
            if let Ok(txt) = field.text().await { req_cols = txt.parse().ok(); }
        } else if name == "rows" {
            if let Ok(txt) = field.text().await { req_rows = txt.parse().ok(); }
        } else if name == "step_x" {
            if let Ok(txt) = field.text().await { req_step_x = txt.parse().ok(); }
        } else if name == "step_y" {
            if let Ok(txt) = field.text().await { req_step_y = txt.parse().ok(); }
        } else if name == "auto_palette" {
            if let Ok(txt) = field.text().await { auto_palette = txt == "true" || txt == "1"; }
        } else if name == "two_stage" {
            if let Ok(txt) = field.text().await { req_two_stage = Some(txt == "true" || txt == "1"); }
        } else if name == "k_colors" {
            if let Ok(txt) = field.text().await { req_k_colors = txt.parse().ok(); }
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

    // 1. Nếu chưa có cols/rows/step, tự động chạy detect
    let (step_x, step_y, cols, rows, consensus) = match (req_step_x, req_step_y, req_cols, req_rows) {
        (Some(sx), Some(sy), Some(c), Some(r)) => (sx, sy, c as usize, r as usize, "manual".to_string()),
        _ => {
            let mode = req_mode.as_deref().unwrap_or("full");
            let d = if mode == "fast" {
                core::detect_fast(raw, w, h)
            } else {
                core::detect_full(raw, w, h)
            };
            (d.step_x, d.step_y, d.cols.max(1) as usize, d.rows.max(1) as usize, d.consensus)
        }
    };

    // 2. Tái tạo sprite pixel art native (Mặc định: two_stage_pack chuẩn SOTA của Pixel Art Fixer)
    let use_two_stage = req_two_stage.unwrap_or_else(|| req_mode.as_deref() != Some("legacy"));
    let k_colors = req_k_colors.unwrap_or(0);

    let recon_out = if use_two_stage {
        reconstruct::two_stage_pack(
            raw,
            w,
            h,
            cols,
            rows,
            k_colors,
        )
    } else {
        reconstruct::reconstruct(
            raw,
            w,
            h,
            step_x,
            step_y,
            cols,
            rows,
            false,
            auto_palette,
        )
    };

    let out_img = match RgbaImage::from_raw(recon_out.cols as u32, recon_out.rows as u32, recon_out.rgba) {
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

    let mut headers = HeaderMap::new();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("image/png"));
    if let Ok(v) = HeaderValue::from_str(&cols.to_string()) {
        headers.insert("X-Grid-Cols", v);
    }
    if let Ok(v) = HeaderValue::from_str(&rows.to_string()) {
        headers.insert("X-Grid-Rows", v);
    }
    if let Ok(v) = HeaderValue::from_str(&format!("{:.2}", step_x)) {
        headers.insert("X-Grid-StepX", v);
    }
    if let Ok(v) = HeaderValue::from_str(&format!("{:.2}", step_y)) {
        headers.insert("X-Grid-StepY", v);
    }
    if let Ok(v) = HeaderValue::from_str(&consensus) {
        headers.insert("X-Grid-Consensus", v);
    }
    let candidates = collect_candidates(step_x, 95);
    if let Ok(cand_json) = serde_json::to_string(&candidates) {
        if let Ok(v) = HeaderValue::from_str(&cand_json) {
            headers.insert("X-Grid-Candidates", v);
        }
    }

    let dur_ms = t0.elapsed().as_secs_f64() * 1000.0;
    let out_bytes = png_buf.into_inner();
    let out_len = out_bytes.len();

    tracing::info!(
        "🛠️ [FIX] In: {}x{} -> Out: {}x{} ({} bytes, grid: {:.2}x{:.2}) in {:.2}ms",
        w, h, cols, rows, out_len, step_x, step_y, dur_ms
    );

    let mut trace_attrs = HashMap::new();
    trace_attrs.insert("image.in_width".to_string(), serde_json::json!(w));
    trace_attrs.insert("image.in_height".to_string(), serde_json::json!(h));
    trace_attrs.insert("image.out_cols".to_string(), serde_json::json!(cols));
    trace_attrs.insert("image.out_rows".to_string(), serde_json::json!(rows));
    trace_attrs.insert("grid.step_x".to_string(), serde_json::json!(step_x));
    trace_attrs.insert("grid.step_y".to_string(), serde_json::json!(step_y));
    trace_attrs.insert("reconstruct.two_stage".to_string(), serde_json::json!(use_two_stage));
    trace_attrs.insert("image.out_bytes".to_string(), serde_json::json!(out_len));
    send_otlp_trace("pixelfixer.fix", dur_ms, trace_attrs, false);

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
