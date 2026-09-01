import os
import sys
import uuid
import io
import base64
import logging
from typing import Optional
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from PIL import Image
import uvicorn

from contextlib import asynccontextmanager
import threading

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
_PROCESSED_COUNT = 0
_STATE_LOCK = threading.Lock()

IDLE_RECYCLE_SECONDS = int(os.getenv("IDLE_RECYCLE_SECONDS", "120"))  # Mặc định 2 phút rảnh là tự giải phóng RAM

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
            if _ACTIVE_REQUESTS == 0 and _PROCESSED_COUNT > 0:
                idle_duration = time.time() - _LAST_REQUEST_TIME
                if idle_duration >= IDLE_RECYCLE_SECONDS:
                    logger.info(f"⏰ [IDLE RECYCLE] Đã nhàn rỗi {int(idle_duration)}s (>= {IDLE_RECYCLE_SECONDS}s). Tự động tái khởi động tiến trình để giải phóng 4GB RAM về hệ điều hành...")
                    # Thoát tiến trình sạch để Docker Swarm / Compose tự động nạp container tươi mới
                    os._exit(0)

@asynccontextmanager
async def lifespan(app: FastAPI):
    threading.Thread(target=_warmup_worker, daemon=True).start()
    threading.Thread(target=_idle_monitor, daemon=True).start()
    yield

app = FastAPI(title="BiRefNet-Lite OpenVINO Worker", version="2.0.0", lifespan=lifespan)

DOWNLOAD_DIR = os.getenv("DOWNLOAD_DIR", "/app/downloads")

@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "service": "worker-rmbg",
        "model": "BiRefNet-Lite",
        "backend": _ACTIVE_BACKEND,
        "warmed_up": _IS_WARMED_UP
    }

@app.post("/api/remove-bg")
async def remove_bg(
    file: UploadFile = File(...),
    model: str = Form("birefnet-lite"),
    bg_color: Optional[str] = Form(None),
    alpha_matting: Optional[str] = Form("false")
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Tên file không hợp lệ")

    ext = os.path.splitext(file.filename)[1].lower()
    allowed_exts = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
    if ext not in allowed_exts:
        raise HTTPException(status_code=400, detail=f"Định dạng '{ext}' không được hỗ trợ. Vui lòng chọn ảnh PNG, JPG, WEBP hoặc BMP.")

    os.makedirs(DOWNLOAD_DIR, exist_ok=True)
    temp_id = uuid.uuid4().hex[:8]
    base_name = os.path.splitext(file.filename)[0]
    out_filename = f"{temp_id}_{base_name}_nobg.png"
    out_filepath = os.path.join(DOWNLOAD_DIR, out_filename)

    global _ACTIVE_REQUESTS, _PROCESSED_COUNT, _LAST_REQUEST_TIME
    with _STATE_LOCK:
        _ACTIVE_REQUESTS += 1

    try:
        content = await file.read()
        is_alpha = str(alpha_matting).lower() == "true"

        out_img, metadata = remove_background(
            image_input=content,
            model_name="birefnet-lite",
            bg_color=bg_color,
            alpha_matting=is_alpha,
        )

        # Lưu ảnh gốc đã tách nền với độ phân giải đầy đủ
        out_img.save(out_filepath, "PNG", optimize=False)
        file_size = os.path.getsize(out_filepath)

        # Tạo thumbnail nhẹ cho Base64 preview (tối đa 1200px) để không làm phình RAM JSON response
        preview_img = out_img.copy()
        if preview_img.width > 1200 or preview_img.height > 1200:
            preview_img.thumbnail((1200, 1200), Image.Resampling.BILINEAR)

        preview_buf = io.BytesIO()
        preview_img.save(preview_buf, format="PNG", optimize=False)
        b64_str = base64.b64encode(preview_buf.getvalue()).decode("utf-8")
        b64_preview = f"data:image/png;base64,{b64_str}"

        # Giải phóng biến tạm
        del preview_img, preview_buf, content
        free_system_memory()

        return {
            "success": True,
            "filename": out_filename,
            "download_url": f"/api/file/{out_filename}",
            "original_filename": file.filename,
            "processing_time_ms": metadata.get("timing_ms", {}).get("total", 0),
            "result_size_bytes": file_size,
            "preview_base64": b64_preview,
            "metadata": metadata
        }
    except Exception as e:
        logger.error(f"Lỗi khi tách nền: {e}")
        free_system_memory()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        with _STATE_LOCK:
            _ACTIVE_REQUESTS -= 1
            _PROCESSED_COUNT += 1
            _LAST_REQUEST_TIME = time.time()

if __name__ == "__main__":
    port = int(os.getenv("PORT", "8003"))
    uvicorn.run(app, host="0.0.0.0", port=port)
