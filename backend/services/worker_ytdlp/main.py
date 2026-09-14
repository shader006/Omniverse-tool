import os
import sys
import time
import uuid
import json
import urllib.request
import threading
import queue
import logging
from typing import Optional
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import uvicorn

# Thêm app vào sys.path để tái sử dụng module url_conver
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
from app.url_conver.metadata import get_media_info
from app.url_conver.downloader import run_download_task, DEFAULT_DOWNLOAD_DIR
from app.url_conver.utils import clean_url_key

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("worker_ytdlp")

app = FastAPI(title="Worker YT-DLP Microservice", version="1.0.0")

# ── TELEMETRY QUEUE & SINGLE WORKER THREAD ──
_TRACE_QUEUE = queue.Queue(maxsize=1000)
HIAI_OBSERVE_URL = os.getenv("HIAI_OBSERVE_URL", "http://172.17.0.1:8001")
HIAI_OBSERVE_API_KEY = os.getenv("HIAI_OBSERVE_API_KEY", "")  # Không hardcode secret fallback

def _send_otlp_http(payload: dict):
    if not HIAI_OBSERVE_API_KEY or not HIAI_OBSERVE_URL:
        return
    url = f"{HIAI_OBSERVE_URL.rstrip('/')}/v1/traces"
    if not url.startswith(("http://", "https://")):
        return
    try:
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {HIAI_OBSERVE_API_KEY}",
                "Content-Type": "application/json"
            },
            method="POST"
        )
        # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected - URL scheme validated to http/https
        with urllib.request.urlopen(req, timeout=2) as resp:
            pass
    except Exception:
        pass

def _telemetry_worker():
    """Worker duy nhất gửi telemetry, tránh tạo thread vô hạn theo từng request."""
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

threading.Thread(target=_telemetry_worker, daemon=True).start()

def parse_traceparent(tp_header: Optional[str]):
    """Phân tích header W3C traceparent (00-{trace_id}-{span_id}-01)."""
    if tp_header and tp_header.startswith("00-"):
        parts = tp_header.split("-")
        if len(parts) >= 3 and len(parts[1]) == 32:
            return parts[1], parts[2]
    return uuid.uuid4().hex, None

def send_otlp_trace(
    name: str,
    duration_ms: float,
    attributes: dict,
    trace_id: Optional[str] = None,
    parent_span_id: Optional[str] = None,
    is_error: bool = False
):
    """Đẩy trace vào hàng đợi để thread duy nhất gửi đi theo cây phân tán."""
    if not HIAI_OBSERVE_API_KEY:
        return

    try:
        now_ns = int(time.time() * 1e9)
        start_ns = now_ns - int(duration_ms * 1e6)
        span_id = uuid.uuid4().hex[:16]

        attrs_list = [
            {"key": "service.name", "value": {"stringValue": "worker-ytdlp"}},
            {"key": "deployment.environment", "value": {"stringValue": "production"}},
        ]
        for k, v in attributes.items():
            if isinstance(v, (int, float)):
                attrs_list.append({"key": str(k), "value": {"doubleValue": float(v)}})
            elif isinstance(v, bool):
                attrs_list.append({"key": str(k), "value": {"boolValue": v}})
            else:
                attrs_list.append({"key": str(k), "value": {"stringValue": str(v)}})

        span_obj = {
            "traceId": trace_id or uuid.uuid4().hex,
            "spanId": span_id,
            "name": name,
            "kind": 1,
            "startTimeUnixNano": str(start_ns),
            "endTimeUnixNano": str(now_ns),
            "attributes": attrs_list,
            "status": {"code": 2 if is_error else 1}
        }
        if parent_span_id:
            span_obj["parentSpanId"] = parent_span_id

        payload = {
            "resourceSpans": [
                {
                    "resource": {"attributes": attrs_list[:2]},
                    "scopeSpans": [
                        {
                            "scope": {"name": "ytdlp-tracer", "version": "1.0.0"},
                            "spans": [span_obj]
                        }
                    ]
                }
            ]
        }
        _TRACE_QUEUE.put_nowait(payload)
    except Exception:
        pass

class InfoRequest(BaseModel):
    url: str

class DownloadRequest(BaseModel):
    job_id: str
    url: str
    format: str = "mp3"
    quality: str = "320"
    download_dir: Optional[str] = None

# In-memory metadata cache (1 giờ TTL, tối đa 500 mục)
_INFO_CACHE: dict = {}
_INFO_CACHE_LOCK = threading.Lock()
_CACHE_TTL = 3600

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "worker-ytdlp"}

@app.post("/api/info")
def fetch_info(req: InfoRequest, request: Request):
    if not req.url:
        raise HTTPException(status_code=400, detail="URL không được để trống")
    
    trace_id, parent_span_id = parse_traceparent(request.headers.get("traceparent"))
    now = time.time()

    cache_key = clean_url_key(req.url)

    # 1. Kiểm tra cache trong RAM (0.01 ms)
    with _INFO_CACHE_LOCK:
        if cache_key in _INFO_CACHE:
            cached_data, exp = _INFO_CACHE[cache_key]
            if now < exp:
                send_otlp_trace(
                    name=" └─ 🎬 [Xử lý (RAM Cache)] Trích xuất metadata video",
                    duration_ms=0.5,
                    attributes={
                        "http.route": "/api/info",
                        "http.method": "POST",
                        "http.status_code": 200,
                        "media.url": req.url,
                        "cache.hit": True
                    },
                    trace_id=trace_id,
                    parent_span_id=parent_span_id,
                )
                return {"success": True, "data": cached_data, "cached": True}

    start = time.perf_counter()
    try:
        data = get_media_info(req.url)
        proc_ms = (time.perf_counter() - start) * 1000.0

        # Lưu cache trong bộ nhớ theo cache_key chuẩn hoá
        with _INFO_CACHE_LOCK:
            if len(_INFO_CACHE) > 500:
                _INFO_CACHE.clear()
            _INFO_CACHE[cache_key] = (data, now + _CACHE_TTL)

        send_otlp_trace(
            name=" └─ 🎬 [Xử lý] Trích xuất metadata video",
            duration_ms=proc_ms,
            attributes={
                "http.route": "/api/info",
                "http.method": "POST",
                "http.status_code": 200,
                "media.url": req.url,
                "media.title": str(data.get("title", ""))[:80],
                "media.extractor": str(data.get("extractor", "unknown")),
            },
            trace_id=trace_id,
            parent_span_id=parent_span_id,
        )
        return {"success": True, "data": data}
    except Exception as e:
        logger.error(f"Error fetching info for {req.url}: {e}")
        send_otlp_trace(
            name=" └─ 🎬 [Xử lý] Trích xuất metadata video",
            duration_ms=50.0,
            attributes={"error": str(e), "http.status_code": 400},
            trace_id=trace_id,
            parent_span_id=parent_span_id,
            is_error=True
        )
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/download")
def start_download(req: DownloadRequest, request: Request):
    if not req.url or not req.job_id:
        raise HTTPException(status_code=400, detail="Thiếu url hoặc job_id")
    
    trace_id, parent_span_id = parse_traceparent(request.headers.get("traceparent"))
    out_dir = req.download_dir or os.getenv("DOWNLOAD_DIR", DEFAULT_DOWNLOAD_DIR)
    os.makedirs(out_dir, exist_ok=True)

    def event_generator():
        q = queue.Queue()

        def progress_cb(pct: float, msg: str):
            q.put({
                "status": "downloading",
                "percent": round(pct, 1),
                "speed": msg,
                "eta": "-"
            })

        def run_task():
            start_t = time.perf_counter()
            try:
                final_filename = run_download_task(
                    url=req.url,
                    media_format=req.format,
                    quality=req.quality,
                    progress_callback=progress_cb,
                    output_dir=out_dir,
                    job_id=req.job_id
                )
                duration_ms = (time.perf_counter() - start_t) * 1000.0
                if final_filename:
                    q.put({
                        "status": "completed",
                        "percent": 100.0,
                        "filename": final_filename,
                        "download_url": f"/api/file/{final_filename}"
                    })
                    send_otlp_trace(
                        name=" └─ ⬇️ [Xử lý] Tải file & Gộp luồng media",
                        duration_ms=duration_ms,
                        attributes={
                            "http.route": "/api/download",
                            "http.method": "POST",
                            "http.status_code": 200,
                            "job.id": req.job_id,
                            "media.url": req.url,
                            "media.format": req.format,
                            "media.quality": req.quality,
                            "media.filename": final_filename
                        },
                        trace_id=trace_id,
                        parent_span_id=parent_span_id,
                    )
                else:
                    q.put({
                        "status": "error",
                        "error": "Không thể tải hoặc chuyển đổi file media từ liên kết."
                    })
                    send_otlp_trace(
                        name=" └─ ⬇️ [Xử lý] Tải file & Gộp luồng media",
                        duration_ms=duration_ms,
                        attributes={"http.route": "/api/download", "http.status_code": 500, "error": "Download returned None"},
                        trace_id=trace_id,
                        parent_span_id=parent_span_id,
                        is_error=True
                    )
            except Exception as e:
                duration_ms = (time.perf_counter() - start_t) * 1000.0
                q.put({
                    "status": "error",
                    "error": str(e)
                })
                send_otlp_trace(
                    name=" └─ ⬇️ [Xử lý] Tải file & Gộp luồng media",
                    duration_ms=duration_ms,
                    attributes={"http.route": "/api/download", "http.status_code": 500, "error": str(e)},
                    trace_id=trace_id,
                    parent_span_id=parent_span_id,
                    is_error=True
                )
            finally:
                q.put(None)

        worker_thread = threading.Thread(target=run_task, daemon=True)
        worker_thread.start()

        while True:
            item = q.get()
            if item is None:
                break
            yield json.dumps(item) + "\n"

    return StreamingResponse(event_generator(), media_type="application/x-ndjson")

if __name__ == "__main__":
    port = int(os.getenv("PORT", "8001"))
    uvicorn.run(app, host="0.0.0.0", port=port)
