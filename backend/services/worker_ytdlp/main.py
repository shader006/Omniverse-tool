import os
import sys
import time
import uuid
import json
import urllib.request
import threading
import logging
from typing import Optional
from fastapi import FastAPI, HTTPException, BackgroundTasks
from pydantic import BaseModel
import uvicorn

# Thêm app vào sys.path để tái sử dụng module url_conver
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
from app.url_conver.metadata import get_media_info
from app.url_conver.downloader import run_download_task, DEFAULT_DOWNLOAD_DIR

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("worker_ytdlp")

app = FastAPI(title="Worker YT-DLP Microservice", version="1.0.0")

HIAI_OBSERVE_URL = os.getenv("HIAI_OBSERVE_URL", "http://172.17.0.1:8001")
HIAI_OBSERVE_API_KEY = os.getenv("HIAI_OBSERVE_API_KEY", "ho_24c101b8a34b64f6af3f08be38a18fbb650a94af37236779")

def send_otlp_trace(name: str, duration_ms: float, attributes: dict, is_error: bool = False):
    """Gửi trace telemetry về HiAi Observe theo chuẩn OTLP/HTTP."""
    def _send():
        try:
            now_ns = int(time.time() * 1e9)
            start_ns = now_ns - int(duration_ms * 1e6)
            trace_id = uuid.uuid4().hex
            span_id = uuid.uuid4().hex[:16]

            attrs_list = [
                {"key": "service.name", "value": {"stringValue": "worker-ytdlp"}},
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
                                "scope": {"name": "ytdlp-tracer", "version": "1.0.0"},
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

    threading.Thread(target=_send, daemon=True).start()

class InfoRequest(BaseModel):
    url: str

class DownloadRequest(BaseModel):
    job_id: str
    url: str
    format: str = "mp3"
    quality: str = "320"
    download_dir: Optional[str] = None

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "worker-ytdlp"}

@app.post("/api/info")
def fetch_info(req: InfoRequest):
    if not req.url:
        raise HTTPException(status_code=400, detail="URL không được để trống")
    start = time.perf_counter()
    try:
        data = get_media_info(req.url)
        proc_ms = (time.perf_counter() - start) * 1000.0
        send_otlp_trace(
            name="POST /api/info",
            duration_ms=proc_ms,
            attributes={
                "http.route": "/api/info",
                "http.method": "POST",
                "http.status_code": 200,
                "media.url": req.url,
                "media.title": str(data.get("title", ""))[:80],
                "media.extractor": str(data.get("extractor", "unknown")),
            }
        )
        return {"success": True, "data": data}
    except Exception as e:
        logger.error(f"Error fetching info for {req.url}: {e}")
        send_otlp_trace(
            name="POST /api/info",
            duration_ms=50.0,
            attributes={"error": str(e), "http.status_code": 400},
            is_error=True
        )
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/download")
def start_download(req: DownloadRequest, background_tasks: BackgroundTasks):
    if not req.url or not req.job_id:
        raise HTTPException(status_code=400, detail="Thiếu url hoặc job_id")
    
    out_dir = req.download_dir or os.getenv("DOWNLOAD_DIR", DEFAULT_DOWNLOAD_DIR)
    os.makedirs(out_dir, exist_ok=True)

    send_otlp_trace(
        name="POST /api/download",
        duration_ms=10.0,
        attributes={
            "http.route": "/api/download",
            "http.method": "POST",
            "http.status_code": 200,
            "job.id": req.job_id,
            "media.url": req.url,
            "media.format": req.format,
            "media.quality": req.quality,
        }
    )

    # Chạy download task trong background
    background_tasks.add_task(
        run_download_task,
        url=req.url,
        media_format=req.format,
        quality=req.quality,
        output_dir=out_dir,
        job_id=req.job_id
    )
    return {"success": True, "job_id": req.job_id, "status": "queued"}

if __name__ == "__main__":
    port = int(os.getenv("PORT", "8001"))
    uvicorn.run(app, host="0.0.0.0", port=port)
