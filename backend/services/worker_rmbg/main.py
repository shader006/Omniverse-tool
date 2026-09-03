import os
import sys
import uuid
import io
import base64
import logging
import queue
from typing import Optional, Union
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from PIL import Image
import uvicorn

from contextlib import asynccontextmanager
import json
import urllib.request
import threading
import time

# Thêm app vào sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
from app.rmbg.remover import remove_background, get_birefnet_engine, free_system_memory

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("worker_rmbg")

_IS_WARMED_UP = False
_ACTIVE_BACKEND = "None"
_LAST_REQUEST_TIME = time.time()
_ACTIVE_REQUESTS = 0
_COMPLETED_REQUESTS = 0
_FAILED_REQUESTS = 0
_STATE_LOCK = threading.Lock()

IDLE_RECYCLE_SECONDS = int(os.getenv("IDLE_RECYCLE_SECONDS", "300"))  # 0 = Giữ thường trực trong RAM vĩnh viễn không giải phóng
DOWNLOAD_DIR = os.getenv("DOWNLOAD_DIR", "/app/downloads")

# ── TELEMETRY QUEUE & SINGLE WORKER THREAD ──
# Dùng Queue + 1 worker thread duy nhất, không tạo thread mới cho mỗi request
_TRACE_QUEUE = queue.Queue(maxsize=1000)
HIAI_OBSERVE_URL = os.environ.get("HIAI_OBSERVE_URL", "http://172.17.0.1:8001")
HIAI_OBSERVE_API_KEY = os.environ.get("HIAI_OBSERVE_API_KEY", "")  # Không hardcode secret fallback

def _send_otlp_http(payload: dict):
    if not HIAI_OBSERVE_API_KEY or not HIAI_OBSERVE_URL:
        return
    try:
        req = urllib.request.Request(
            f"{HIAI_OBSERVE_URL}/v1/traces",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {HIAI_OBSERVE_API_KEY}",
                "Content-Type": "application/json"
            },
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=2) as resp:
            pass
    except Exception:
        pass

def _telemetry_worker():
    """Luồng nền duy nhất gửi telemetry, tránh spam thread khi traffic tăng cao."""
    while True:
        try:
            payload = _TRACE_QUEUE.get()
            if payload is None:
                break
            _send_otlp_http(payload)
        except Exception:
            pass
        finally:
            _TRACE_QUEUE.task_done()

def send_otlp_trace(name: str, duration_ms: float, attributes: dict, is_error: bool = False):
    """Đẩy trace vào hàng đợi Queue để 1 worker thread duy nhất xử lý phi tập trung."""
    if not HIAI_OBSERVE_API_KEY:
        return

    now_ns = int(time.time() * 1e9)
    start_ns = now_ns - int(duration_ms * 1e6)
    trace_id = uuid.uuid4().hex
    span_id = uuid.uuid4().hex[:16]

    attrs_list = [
        {"key": "service.name", "value": {"stringValue": "worker-rmbg"}},
        {"key": "deployment.environment", "value": {"stringValue": "production"}},
    ]
    for k, v in attributes.items():
        if isinstance(v, (int, float)):
            attrs_list.append({"key": str(k), "value": {"doubleValue": float(v)}})
        else:
            attrs_list.append({"key": str(k), "value": {"stringValue": str(v)}})

    payload = {
        "resourceSpans": [
            {
                "resource": {"attributes": attrs_list[:2]},
                "scopeSpans": [
                    {
                        "scope": {"name": "birefnet-tracer", "version": "1.0.0"},
                        "spans": [
                            {
                                "traceId": trace_id,
                                "spanId": span_id,
                                "name": name,
                                "kind": 1,
                                "startTimeUnixNano": str(start_ns),
                                "endTimeUnixNano": str(now_ns),
                                "attributes": attrs_list,
                                "status": {"code": 2 if is_error else 1}
                            }
                        ]
                    }
                ]
            }
        ]
    }

    try:
        _TRACE_QUEUE.put_nowait(payload)
    except queue.Full:
        logger.warning("Telemetry queue đầy, bỏ qua trace để ưu tiên CPU.")

def _warmup_worker():
    global _IS_WARMED_UP, _ACTIVE_BACKEND
    logger.info("🚀 [WARM-UP] Nạp sẵn BiRefNet-Lite (Intel OpenVINO) vào RAM...")
    try:
        engine = get_birefnet_engine()
        if engine and engine.compiled_model is not None:
            _IS_WARMED_UP = True
            _ACTIVE_BACKEND = engine.backend
            logger.info(f"✅ [WARM-UP] BiRefNet-Lite ({engine.backend.upper()}) sẵn sàng phục vụ.")
    except Exception as e:
        logger.warning(f"⚠️ [WARM-UP] Lỗi warm-up BiRefNet-Lite: {e}")

def _idle_monitor():
    """Tự động recycle worker sau khi nhàn rỗi (idle) IDLE_RECYCLE_SECONDS để trả 4GB RAM về cho OS."""
    if IDLE_RECYCLE_SECONDS <= 0:
        logger.info("ℹ️ [IDLE MONITOR] Cơ chế tự động giải phóng RAM đang tắt (IDLE_RECYCLE_SECONDS <= 0).")
        return

    logger.info(f"🛡️ [IDLE MONITOR] Đã kích hoạt: Tự động hoàn trả RAM khi rảnh rỗi sau {IDLE_RECYCLE_SECONDS}s.")
    while True:
        time.sleep(5)
        with _STATE_LOCK:
            if _ACTIVE_REQUESTS == 0 and _COMPLETED_REQUESTS > 0:
                idle_duration = time.time() - _LAST_REQUEST_TIME
                if idle_duration >= IDLE_RECYCLE_SECONDS:
                    logger.info(f"⏰ [IDLE RECYCLE] Đã nhàn rỗi {int(idle_duration)}s (>= {IDLE_RECYCLE_SECONDS}s). Tự động tái khởi động tiến trình để giải phóng 4GB RAM về hệ điều hành...")
                    os._exit(0)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Khởi tạo thư mục download 1 lần duy nhất lúc startup
    os.makedirs(DOWNLOAD_DIR, exist_ok=True)

    # Khởi động các thread nền duy nhất
    threading.Thread(target=_telemetry_worker, daemon=True).start()
    threading.Thread(target=_warmup_worker, daemon=True).start()
    threading.Thread(target=_idle_monitor, daemon=True).start()
    yield

app = FastAPI(title="BiRefNet-Lite OpenVINO Worker", version="2.1.0", lifespan=lifespan)

@app.get("/health")
def health_check():
    """Kiểm tra tổng quan trạng thái service và tiến trình warm-up."""
    return {
        "status": "ready" if _IS_WARMED_UP else "warming",
        "service": "worker-rmbg",
        "model": "BiRefNet-Lite",
        "backend": _ACTIVE_BACKEND,
        "warmed_up": _IS_WARMED_UP,
        "completed_requests": _COMPLETED_REQUESTS,
        "failed_requests": _FAILED_REQUESTS
    }

@app.get("/ready")
def readiness_check():
    """Readiness probe chuẩn Docker Swarm: trả về 200 khi model đã nạp xong, 503 khi đang nạp."""
    if not _IS_WARMED_UP:
        raise HTTPException(status_code=503, detail="Mô hình AI BiRefNet-Lite đang nạp, chưa sẵn sàng.")
    return {"status": "ready"}

@app.get("/live")
def liveness_check():
    """Liveness probe chuẩn: tiến trình container còn sống."""
    return {"status": "alive"}

@app.post("/api/remove-bg")
async def remove_bg(
    file: UploadFile = File(...),
    model: str = Form("birefnet-lite"),
    bg_color: Optional[str] = Form(None),
    alpha_matting: Union[bool, str] = Form(False)
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Tên file không hợp lệ")

    # Validate model parameter (hỗ trợ các alias tương thích ngược như bria-rmbg, isnet-general-use)
    clean_model = str(model).strip().lower()
    allowed_models = {"birefnet-lite", "birefnet", "bria-rmbg", "isnet-general-use", "default", ""}
    if clean_model and clean_model not in allowed_models:
        raise HTTPException(status_code=400, detail=f"Mô hình '{model}' không được hỗ trợ. Các mô hình hợp lệ: birefnet-lite, bria-rmbg.")

    ext = os.path.splitext(file.filename)[1].lower()
    allowed_exts = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
    if ext not in allowed_exts:
        raise HTTPException(status_code=400, detail=f"Định dạng '{ext}' không được hỗ trợ. Vui lòng chọn ảnh PNG, JPG, WEBP hoặc BMP.")

    temp_id = uuid.uuid4().hex[:8]
    base_name = os.path.splitext(file.filename)[0]
    out_filename = f"{temp_id}_{base_name}_nobg.png"
    out_filepath = os.path.join(DOWNLOAD_DIR, out_filename)

    global _ACTIVE_REQUESTS, _COMPLETED_REQUESTS, _FAILED_REQUESTS, _LAST_REQUEST_TIME
    with _STATE_LOCK:
        _ACTIVE_REQUESTS += 1

    req_start = time.perf_counter()

    try:
        content = await file.read()

        # Parse alpha_matting an toàn (hỗ trợ cả boolean và string)
        if isinstance(alpha_matting, bool):
            is_alpha = alpha_matting
        else:
            is_alpha = str(alpha_matting).strip().lower() in {"true", "1", "yes"}

        out_img, metadata = remove_background(
            image_input=content,
            model_name="birefnet-lite",
            bg_color=bg_color,
            alpha_matting=is_alpha,
        )

        # Lưu ảnh gốc đã tách nền với độ phân giải đầy đủ
        out_img.save(out_filepath, "PNG", optimize=False)
        file_size = os.path.getsize(out_filepath)

        # Tối ưu RAM: Resize trực tiếp sang ảnh nhỏ 320px mà KHÔNG gọi out_img.copy() (tránh cấp phát thêm ~97MB RAM)
        orig_w, orig_h = out_img.size
        scale = min(320.0 / max(orig_w, 1), 320.0 / max(orig_h, 1), 1.0)
        thumb_w, thumb_h = max(1, int(orig_w * scale)), max(1, int(orig_h * scale))
        preview_img = out_img.resize((thumb_w, thumb_h), Image.Resampling.BILINEAR)

        preview_buf = io.BytesIO()
        try:
            preview_img.save(preview_buf, format="WEBP", quality=80)
            b64_mime = "image/webp"
        except Exception:
            preview_buf.seek(0)
            preview_buf.truncate(0)
            preview_img.save(preview_buf, format="PNG", optimize=True)
            b64_mime = "image/png"

        b64_str = base64.b64encode(preview_buf.getvalue()).decode("utf-8")
        b64_preview = f"data:{b64_mime};base64,{b64_str}"

        # Giải phóng biến tạm ngay lập tức
        del preview_img, preview_buf, content, out_img
        free_system_memory()

        duration_ms = (time.perf_counter() - req_start) * 1000.0
        send_otlp_trace(
            name="POST /api/remove-bg",
            duration_ms=duration_ms,
            attributes={
                "http.route": "/api/remove-bg",
                "http.method": "POST",
                "http.status_code": 200,
                "ai.model": "BiRefNet-Lite (Intel OpenVINO)",
                "ai.inference_ms": metadata.get("timing_ms", {}).get("inference", 0),
                "ai.preprocess_ms": metadata.get("timing_ms", {}).get("preprocess", 0),
                "ai.postprocess_ms": metadata.get("timing_ms", {}).get("postprocess", 0),
                "image.width": metadata.get("input_size", {}).get("width", 0),
                "image.height": metadata.get("input_size", {}).get("height", 0),
            }
        )

        with _STATE_LOCK:
            _COMPLETED_REQUESTS += 1

        return {
            "success": True,
            "filename": out_filename,
            "download_url": f"/api/file/{out_filename}",
            "original_filename": file.filename,
            "processing_time_ms": round(duration_ms, 2),
            "result_size_bytes": file_size,
            "preview_base64": b64_preview,
            "metadata": metadata
        }
    except HTTPException:
        raise
    except Exception as e:
        # Ghi log nội bộ chi tiết stack trace, KHÔNG leak exception thô ra client
        logger.exception(f"Lỗi khi tách nền: {e}")
        free_system_memory()

        duration_ms = (time.perf_counter() - req_start) * 1000.0
        send_otlp_trace(
            name="POST /api/remove-bg",
            duration_ms=duration_ms,
            attributes={"error": "internal_inference_error", "http.status_code": 500},
            is_error=True
        )

        with _STATE_LOCK:
            _FAILED_REQUESTS += 1

        raise HTTPException(
            status_code=500,
            detail="Máy chủ không thể xử lý tách nền cho bức ảnh này. Vui lòng thử lại hoặc chọn ảnh khác."
        )
    finally:
        with _STATE_LOCK:
            _ACTIVE_REQUESTS = max(0, _ACTIVE_REQUESTS - 1)
            _LAST_REQUEST_TIME = time.time()

if __name__ == "__main__":
    port = int(os.getenv("PORT", "8003"))
    uvicorn.run(app, host="0.0.0.0", port=port)
