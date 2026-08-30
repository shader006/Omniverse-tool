import os
import sys
import time
import uuid
import shutil
import logging
import subprocess
import json
from typing import Optional
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
import uvicorn

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("worker_whisper")

app = FastAPI(title="Worker Whisper Microservice", version="1.0.0")

DOWNLOAD_DIR = os.getenv("DOWNLOAD_DIR", "/app/downloads")
WHISPER_BIN = os.getenv("WHISPER_BIN", "/usr/local/bin/whisper-cli")
WHISPER_MODEL_PATH = os.getenv("WHISPER_MODEL_PATH", "/app/models/whisper/ggml-small.bin")

@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "service": "worker-whisper",
        "model_exists": os.path.exists(WHISPER_MODEL_PATH),
        "whisper_bin_exists": os.path.exists(WHISPER_BIN)
    }

@app.post("/api/transcribe")
async def transcribe_media(
    file: UploadFile = File(...),
    language: str = Form("auto"),
    format: str = Form("txt"),
    task: str = Form("transcribe")
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Tên file không hợp lệ")

    ext = os.path.splitext(file.filename)[1].lower()
    allowed_exts = {".mp3", ".mp4", ".wav", ".m4a", ".webm", ".flac", ".ogg", ".aac", ".mov", ".avi", ".mkv"}
    if ext not in allowed_exts:
        raise HTTPException(status_code=400, detail=f"Định dạng '{ext}' không được hỗ trợ để nhận diện giọng nói.")

    os.makedirs(DOWNLOAD_DIR, exist_ok=True)
    temp_id = uuid.uuid4().hex[:8]
    temp_in_path = os.path.join(DOWNLOAD_DIR, f"whisper_in_{temp_id}{ext}")
    wav_path = os.path.join(DOWNLOAD_DIR, f"whisper_{temp_id}.wav")

    try:
        # Lưu file upload
        with open(temp_in_path, "wb") as f_out:
            shutil.copyfileobj(file.file, f_out)

        # 1. Convert media sang 16kHz 16-bit Mono WAV cho Whisper
        cmd_ffmpeg = [
            "ffmpeg", "-y", "-i", temp_in_path,
            "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le",
            wav_path
        ]
        res_ff = subprocess.run(cmd_ffmpeg, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if res_ff.returncode != 0:
            raise HTTPException(status_code=500, detail=f"FFmpeg chuyển đổi âm thanh thất bại: {res_ff.stderr}")

        # Lấy thời lượng audio
        cmd_dur = ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", wav_path]
        res_dur = subprocess.run(cmd_dur, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        duration_sec = 0.0
        try:
            duration_sec = float(res_dur.stdout.strip())
        except Exception:
            pass

        # 2. Chạy whisper-cli
        out_base = os.path.join(DOWNLOAD_DIR, f"transcript_{temp_id}")
        cmd_whisper = [
            WHISPER_BIN,
            "-m", WHISPER_MODEL_PATH,
            "-f", wav_path,
            "-t", str(min(os.cpu_count() or 4, 8)),
            "--output-json",
            "-of", out_base
        ]
        if language and language != "auto":
            cmd_whisper.extend(["-l", language])
        if task == "translate":
            cmd_whisper.append("--translate")

        start_t = time.perf_counter()
        res_wh = subprocess.run(cmd_whisper, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        proc_time = round(time.perf_counter() - start_t, 2)

        json_out_file = f"{out_base}.json"
        text_content = ""
        segments = []

        if os.path.exists(json_out_file):
            with open(json_out_file, "r", encoding="utf-8") as jf:
                wh_data = json.load(jf)
                # Parse whisper output json
                transcription = wh_data.get("transcription", [])
                for seg in transcription:
                    segments.append({
                        "id": seg.get("id", 0),
                        "start": seg.get("timestamps", {}).get("from", "00:00:00"),
                        "end": seg.get("timestamps", {}).get("to", "00:00:00"),
                        "text": seg.get("text", "").strip()
                    })
                text_content = wh_data.get("text", "") or "\n".join(s["text"] for s in segments)
        else:
            text_content = res_wh.stdout

        # Lưu file text kết quả
        final_filename = f"transcript_{temp_id}.{format}"
        final_filepath = os.path.join(DOWNLOAD_DIR, final_filename)
        with open(final_filepath, "w", encoding="utf-8") as out_f:
            if format == "srt":
                for i, seg in enumerate(segments, 1):
                    out_f.write(f"{i}\n{seg['start']} --> {seg['end']}\n{seg['text']}\n\n")
            else:
                out_f.write(text_content)

        return {
            "success": True,
            "filename": final_filename,
            "download_url": f"/api/file/{final_filename}",
            "text": text_content,
            "segments": segments,
            "audio_duration": duration_sec,
            "processing_time": proc_time,
            "detected_language": language,
            "model_used": os.path.basename(WHISPER_MODEL_PATH)
        }
    finally:
        # Dọn dẹp file tạm
        if os.path.exists(temp_in_path):
            os.remove(temp_in_path)
        if os.path.exists(wav_path):
            os.remove(wav_path)

if __name__ == "__main__":
    port = int(os.getenv("PORT", "8002"))
    uvicorn.run(app, host="0.0.0.0", port=port)
