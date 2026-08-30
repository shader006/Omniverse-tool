import os
import sys
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
    try:
        data = get_media_info(req.url)
        return {"success": True, "data": data}
    except Exception as e:
        logger.error(f"Error fetching info for {req.url}: {e}")
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/download")
def start_download(req: DownloadRequest, background_tasks: BackgroundTasks):
    if not req.url or not req.job_id:
        raise HTTPException(status_code=400, detail="Thiếu url hoặc job_id")
    
    out_dir = req.download_dir or os.getenv("DOWNLOAD_DIR", DEFAULT_DOWNLOAD_DIR)
    os.makedirs(out_dir, exist_ok=True)

    # Chạy download task trong background
    background_tasks.add_task(
        run_download_task,
        job_id=req.job_id,
        url=req.url,
        media_format=req.format,
        quality=req.quality,
        download_dir=out_dir
    )
    return {"success": True, "job_id": req.job_id, "status": "queued"}

if __name__ == "__main__":
    port = int(os.getenv("PORT", "8001"))
    uvicorn.run(app, host="0.0.0.0", port=port)
