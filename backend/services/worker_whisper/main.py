import os
import sys
import time
import uuid
import json
import shutil
import logging
import subprocess
import urllib.request
import threading
import queue
import wave
import struct
from contextlib import asynccontextmanager
from typing import Optional
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
import uvicorn

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("worker_whisper")

DOWNLOAD_DIR = os.getenv("DOWNLOAD_DIR", "/app/downloads")
TMP_DIR = os.path.join(DOWNLOAD_DIR, "tmp")
WHISPER_BIN = os.getenv("WHISPER_BIN", "/usr/local/bin/whisper-cli")
WHISPER_MODEL_PATH = os.getenv("WHISPER_MODEL_PATH", "/app/models/whisper/ggml-small.bin")
HIAI_OBSERVE_URL = os.getenv("HIAI_OBSERVE_URL", "http://172.17.0.1:8001")
HIAI_OBSERVE_API_KEY = os.getenv("HIAI_OBSERVE_API_KEY", "")  # Không hardcode secret fallback

# ── TELEMETRY QUEUE & SINGLE WORKER THREAD ──
_TRACE_QUEUE = queue.Queue(maxsize=1000)

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
    """Worker duy nhất gửi telemetry, không tạo thread mới theo từng request."""
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

def send_otlp_trace(name: str, duration_ms: float, attributes: dict, is_error: bool = False):
    if not HIAI_OBSERVE_API_KEY:
        return
    try:
        now_ns = int(time.time() * 1e9)
        start_ns = now_ns - int(duration_ms * 1e6)
        trace_id = uuid.uuid4().hex
        span_id = uuid.uuid4().hex[:16]

        attrs_list = [
            {"key": "service.name", "value": {"stringValue": "worker-whisper"}},
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
                            "scope": {"name": "whisper-tracer", "version": "1.0.0"},
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
        _TRACE_QUEUE.put_nowait(payload)
    except Exception:
        pass

def _warmup_whisper():
    """Nạp sẵn mô hình Whisper GGML (465MB) vào RAM và kích hoạt sẵn C++ inference pipeline."""
    logger.info("🚀 [WARM-UP] Nạp sẵn mô hình Whisper GGML vào RAM...")
    try:
        if os.path.exists(WHISPER_MODEL_PATH):
            with open(WHISPER_MODEL_PATH, "rb") as f:
                _ = f.read()
            
            dummy_wav = "/tmp/warmup_sine.wav"
            with wave.open(dummy_wav, "w") as wf:
                wf.setnchannels(1)
                wf.setsampwidth(2)
                wf.setframerate(16000)
                wf.writeframes(struct.pack('<1600h', *([0] * 1600)))
            
            if os.path.exists(WHISPER_BIN):
                subprocess.run(
                    [WHISPER_BIN, "-m", WHISPER_MODEL_PATH, "-f", dummy_wav, "-t", "4", "--output-txt", "-of", "/tmp/warmup_out"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    timeout=10
                )
            logger.info("✅ [WARM-UP] Whisper GGML C++ Engine đã được nạp sẵn vào RAM và sẵn sàng xử lý tức thì.")
    except Exception as e:
        logger.warning(f"⚠️ [WARM-UP] Whisper warm-up warning: {e}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    threading.Thread(target=_warmup_whisper, daemon=True).start()
    yield

app = FastAPI(title="Worker Whisper Microservice", version="1.0.0", lifespan=lifespan)

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

    clean_format = format.lower().lstrip(".")
    allowed_formats = {"txt", "srt", "vtt", "json"}
    if clean_format not in allowed_formats:
        raise HTTPException(
            status_code=400,
            detail=f"Định dạng xuất '{format}' không được hỗ trợ. Các định dạng hợp lệ: txt, srt, vtt, json."
        )

    clean_task = task.lower().strip()
    if clean_task not in {"transcribe", "translate"}:
        raise HTTPException(
            status_code=400,
            detail=f"Tác vụ '{task}' không hợp lệ. Các tác vụ hợp lệ: transcribe, translate."
        )

    ext = os.path.splitext(file.filename)[1].lower()
    allowed_exts = {".mp3", ".mp4", ".wav", ".m4a", ".webm", ".flac", ".ogg", ".aac", ".mov", ".avi", ".mkv"}
    if ext not in allowed_exts:
        raise HTTPException(status_code=400, detail=f"Định dạng '{ext}' không được hỗ trợ để nhận diện giọng nói.")

    os.makedirs(DOWNLOAD_DIR, exist_ok=True)
    os.makedirs(TMP_DIR, exist_ok=True)
    temp_id = uuid.uuid4().hex[:8]
    temp_in_path = os.path.join(TMP_DIR, f"whisper_in_{temp_id}{ext}")
    wav_path = os.path.join(TMP_DIR, f"whisper_{temp_id}.wav")
    out_base = os.path.join(TMP_DIR, f"transcript_{temp_id}")
    json_out_file = f"{out_base}.json"

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

        # [Issue 4] Giới hạn thời lượng tối đa 10 phút (600s)
        if duration_sec > 600.0:
            mins = int(duration_sec // 60)
            secs = int(duration_sec % 60)
            raise HTTPException(
                status_code=400,
                detail=f"Thời lượng audio ({mins} phút {secs} giây) vượt quá giới hạn tối đa cho phép là 10 phút. Vui lòng chọn file ngắn hơn."
            )

        # 2. Chạy whisper-cli tối ưu tốc độ, phân bổ 12 core và chống nuốt lời khi nhạc to
        cmd_whisper = [
            WHISPER_BIN,
            "-m", WHISPER_MODEL_PATH,
            "-f", wav_path,
            "-t", str(min(os.cpu_count() or 12, 12)),
            "-bs", "1",
            "-bo", "1",
            "-nf",
            "-sns",
            "-nth", "0.35",
            "--output-json",
            "-of", out_base
        ]
        if language and language != "auto":
            cmd_whisper.extend(["-l", language])
        if clean_task == "translate":
            cmd_whisper.append("--translate")

        start_t = time.perf_counter()
        res_wh = subprocess.run(cmd_whisper, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        proc_time = round(time.perf_counter() - start_t, 2)

        # [Issue 4] Kiểm tra returncode của whisper-cli
        if res_wh.returncode != 0:
            logger.error(f"Whisper-cli exit code {res_wh.returncode}: {res_wh.stderr}")
            raise HTTPException(
                status_code=500,
                detail=f"Whisper engine gặp sự cố khi nhận diện âm thanh: {res_wh.stderr or 'Lỗi tiến trình whisper'}"
            )

        text_content = ""
        segments = []

        if os.path.exists(json_out_file):
            with open(json_out_file, "r", encoding="utf-8") as jf:
                wh_data = json.load(jf)
                transcription = wh_data.get("transcription", [])
                for idx, seg in enumerate(transcription):
                    from_ms = seg.get("offsets", {}).get("from", 0)
                    to_ms = seg.get("offsets", {}).get("to", 0)
                    start_sec = round(float(from_ms) / 1000.0, 2)
                    end_sec = round(float(to_ms) / 1000.0, 2)

                    ts_from = seg.get("timestamps", {}).get("from", "00:00:00,000")
                    ts_to = seg.get("timestamps", {}).get("to", "00:00:00,000")

                    segments.append({
                        "id": idx + 1,
                        "start": start_sec,
                        "end": end_sec,
                        "timestamp_from": ts_from,
                        "timestamp_to": ts_to,
                        "text": seg.get("text", "").strip()
                    })
                text_content = wh_data.get("text", "") or "\n".join(s["text"] for s in segments)
        else:
            text_content = res_wh.stdout

        # [Issue 5] Lưu file kết quả đúng định dạng (txt, srt, vtt, json)
        final_filename = f"transcript_{temp_id}.{clean_format}"
        final_filepath = os.path.join(DOWNLOAD_DIR, final_filename)
        with open(final_filepath, "w", encoding="utf-8") as out_f:
            if clean_format == "vtt":
                out_f.write("WEBVTT\n\n")
                for seg in segments:
                    vtt_from = seg["timestamp_from"].replace(",", ".")
                    vtt_to = seg["timestamp_to"].replace(",", ".")
                    out_f.write(f"{vtt_from} --> {vtt_to}\n{seg['text']}\n\n")
            elif clean_format == "srt":
                for i, seg in enumerate(segments, 1):
                    out_f.write(f"{i}\n{seg['timestamp_from']} --> {seg['timestamp_to']}\n{seg['text']}\n\n")
            elif clean_format == "json":
                export_json = {
                    "text": text_content,
                    "segments": segments,
                    "audio_duration": duration_sec,
                    "detected_language": language,
                    "task": clean_task,
                    "model": os.path.basename(WHISPER_MODEL_PATH)
                }
                json.dump(export_json, out_f, ensure_ascii=False, indent=2)
            else:
                out_f.write(text_content)

        send_otlp_trace(
            name="POST /api/transcribe",
            duration_ms=proc_time * 1000.0,
            attributes={
                "http.route": "/api/transcribe",
                "http.method": "POST",
                "http.status_code": 200,
                "ai.model": "Whisper (GGML C++ Engine)",
                "ai.audio_duration_sec": duration_sec,
                "ai.detected_language": language,
                "ai.output_format": clean_format,
            }
        )

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
    except HTTPException:
        raise
    except Exception as e:
        send_otlp_trace(
            name="POST /api/transcribe",
            duration_ms=50.0,
            attributes={"error": str(e), "http.status_code": 500},
            is_error=True
        )
        raise e
    finally:
        # Dọn dẹp file tạm
        if os.path.exists(temp_in_path):
            os.remove(temp_in_path)
        if os.path.exists(wav_path):
            os.remove(wav_path)
        if os.path.exists(json_out_file):
            os.remove(json_out_file)

if __name__ == "__main__":
    port = int(os.getenv("PORT", "8002"))
    uvicorn.run(app, host="0.0.0.0", port=port)
