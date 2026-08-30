import os
import sys
import uuid
import base64
import logging
from typing import Optional
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
import uvicorn

from contextlib import asynccontextmanager
import threading

# Thêm app vào sys.path để tái sử dụng module rmbg
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
from app.rmbg.remover import remove_background, get_rembg_session

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("worker_rmbg")

_IS_WARMED_UP = False

def _warmup_worker():
    global _IS_WARMED_UP
    logger.info("🚀 [WARM-UP] Bắt đầu nạp sẵn BRIA RMBG-1.4 vào RAM trong background...")
    try:
        session = get_rembg_session("bria-rmbg")
        if session:
            from PIL import Image
            import io
            dummy_img = Image.new("RGB", (64, 64), color="blue")
            dummy_bio = io.BytesIO()
            dummy_img.save(dummy_bio, format="PNG")
            remove_background(dummy_bio.getvalue(), model_name="bria-rmbg")
            _IS_WARMED_UP = True
            logger.info("✅ [WARM-UP] BRIA RMBG-1.4 đã nạp sẵn vào RAM hoàn tất! Sẵn sàng phục vụ tức thì.")
    except Exception as e:
        logger.warning(f"⚠️ [WARM-UP] Lỗi khi warm-up model: {e}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Khởi chạy warm-up ngầm để không chặn cổng HTTP
    threading.Thread(target=_warmup_worker, daemon=True).start()
    yield

app = FastAPI(title="Worker RMBG Microservice", version="1.0.0", lifespan=lifespan)

DOWNLOAD_DIR = os.getenv("DOWNLOAD_DIR", "/app/downloads")

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "worker-rmbg", "warmed_up": _IS_WARMED_UP}

@app.post("/api/remove-bg")
async def remove_bg(
    file: UploadFile = File(...),
    model: str = Form("bria-rmbg"),
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

    try:
        content = await file.read()
        is_alpha = str(alpha_matting).lower() == "true"
        
        out_img, metadata = remove_background(
            image_input=content,
            model_name=model,
            bg_color=bg_color,
            alpha_matting=is_alpha,
        )

        out_img.save(out_filepath, "PNG")
        file_size = os.path.getsize(out_filepath)

        # Tạo base64 preview
        with open(out_filepath, "rb") as img_f:
            b64_str = base64.b64encode(img_f.read()).decode("utf-8")
            b64_preview = f"data:image/png;base64,{b64_str}"

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
        logger.error(f"Error removing background: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    port = int(os.getenv("PORT", "8003"))
    uvicorn.run(app, host="0.0.0.0", port=port)
