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
from typing import Optional, Tuple
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request
from fastapi.responses import JSONResponse
import uvicorn

# Tự động nạp cấu hình từ .env nếu có
try:
    from dotenv import load_dotenv
    _env_paths = [
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".env")),
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".env")),
        os.path.abspath(".env")
    ]
    for _p in _env_paths:
        if os.path.exists(_p):
            load_dotenv(_p)
            break
except ImportError:
    pass

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("worker_whisper")

def _get_download_dir():
    env_dir = os.getenv("DOWNLOAD_DIR")
    if env_dir:
        return env_dir
    if os.path.exists("/app") and os.access("/app", os.W_OK):
        return "/app/downloads"
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "downloads"))

def _get_whisper_bin():
    env_bin = os.getenv("WHISPER_BIN")
    if env_bin and os.path.exists(env_bin):
        return env_bin
    candidates = [
        "/usr/local/bin/whisper-cli",
        os.path.expanduser("~/whisper.cpp/build/bin/whisper-cli"),
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "whisper.cpp", "build", "bin", "whisper-cli")),
    ]
    for c in candidates:
        if os.path.exists(c):
            return c
    return env_bin or "/usr/local/bin/whisper-cli"

def _get_whisper_model():
    env_model = os.getenv("WHISPER_MODEL_PATH")
    if env_model and os.path.exists(env_model):
        return env_model
    candidates = [
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "models", "whisper", "ggml-small.bin")),
        os.path.expanduser("~/whisper.cpp/models/ggml-small.bin"),
        "/app/models/whisper/ggml-small.bin",
    ]
    for c in candidates:
        if os.path.exists(c):
            return c
    return env_model or "/app/models/whisper/ggml-small.bin"

DOWNLOAD_DIR = _get_download_dir()
TMP_DIR = os.path.join(DOWNLOAD_DIR, "tmp")
WHISPER_BIN = _get_whisper_bin()
WHISPER_MODEL_PATH = _get_whisper_model()
HIAI_OBSERVE_URL = os.getenv("HIAI_OBSERVE_URL", "http://172.17.0.1:8001")
HIAI_OBSERVE_API_KEY = os.getenv("HIAI_OBSERVE_API_KEY", "")

# ── TELEMETRY QUEUE & SINGLE WORKER THREAD ──
_TRACE_QUEUE = queue.Queue(maxsize=1000)

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

def parse_traceparent(tp_header: Optional[str]) -> Tuple[str, Optional[str]]:
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
    if not HIAI_OBSERVE_API_KEY:
        return
    try:
        now_ns = int(time.time() * 1e9)
        start_ns = now_ns - int(duration_ms * 1e6)
        span_id = uuid.uuid4().hex[:16]

        attrs_list = [
            {"key": "service.name", "value": {"stringValue": "worker-whisper"}},
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
                            "scope": {"name": "whisper-tracer", "version": "1.0.0"},
                            "spans": [span_obj]
                        }
                    ]
                }
            ]
        }
        _TRACE_QUEUE.put_nowait(payload)
    except Exception:
        pass

_USE_GPU = False
_GPU_CHECKED = False
_GPU_DEVICE_NAME = "CPU"

def _detect_and_warmup_whisper():
    """Tự động kiểm tra khả năng hỗ trợ NVIDIA GPU (CUDA) và nạp sẵn mô hình vào VRAM/RAM."""
    global _USE_GPU, _GPU_CHECKED, _GPU_DEVICE_NAME
    logger.info("🚀 [WARM-UP] Bắt đầu kiểm tra phần cứng & nạp mô hình Whisper...")

    dummy_wav = "/tmp/warmup_sine.wav"
    try:
        with wave.open(dummy_wav, "w") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(16000)
            wf.writeframes(struct.pack('<1600h', *([0] * 1600)))
    except Exception as e:
        logger.warning(f"Không thể tạo file audio sine test: {e}")

    # 1. Thử nghiệm chạy whisper-cli với GPU CUDA (-dev 0)
    gpu_success = False
    if os.path.exists(WHISPER_BIN) and os.path.exists(WHISPER_MODEL_PATH):
        try:
            probe_cmd = [
                WHISPER_BIN,
                "-m", WHISPER_MODEL_PATH,
                "-f", dummy_wav,
                "-dev", "0",
                "-t", "2",
                "--output-txt",
                "-of", "/tmp/warmup_gpu_out"
            ]
            res_probe = subprocess.run(
                probe_cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=15
            )
            if res_probe.returncode == 0:
                gpu_success = True
                _USE_GPU = True
                _GPU_DEVICE_NAME = "NVIDIA CUDA GPU"
                # Thử truy vấn tên model GPU chính xác
                try:
                    res_smi = subprocess.run(
                        ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        text=True,
                        timeout=5
                    )
                    if res_smi.returncode == 0 and res_smi.stdout.strip():
                        first_gpu = res_smi.stdout.strip().split("\n")[0]
                        _GPU_DEVICE_NAME = f"CUDA ({first_gpu})"
                except Exception:
                    pass
                logger.info(f"🚀 [WARM-UP] Đã kích hoạt tăng tốc {_GPU_DEVICE_NAME} cho Whisper thành công!")
            else:
                logger.warning(f"⚠️ [WARM-UP] whisper-cli với GPU trả về mã lỗi {res_probe.returncode}. Sẽ dùng CPU fallback.")
        except Exception as e_gpu:
            logger.warning(f"⚠️ [WARM-UP] Không thể kích hoạt GPU ({e_gpu}). Sẽ dùng CPU fallback.")

    if not gpu_success:
        _USE_GPU = False
        _GPU_DEVICE_NAME = "CPU (AVX2 Multithreading)"
        try:
            if os.path.exists(WHISPER_MODEL_PATH):
                with open(WHISPER_MODEL_PATH, "rb") as f:
                    _ = f.read()
            if os.path.exists(WHISPER_BIN):
                subprocess.run(
                    [WHISPER_BIN, "-m", WHISPER_MODEL_PATH, "-f", dummy_wav, "-ngl", "0", "-t", "4", "--output-txt", "-of", "/tmp/warmup_cpu_out"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    timeout=10
                )
            logger.info("⚡ [WARM-UP] Whisper C++ Engine đã sẵn sàng trên CPU (AVX2 Multithreading).")
        except Exception as e_cpu:
            logger.warning(f"⚠️ [WARM-UP] Lỗi warm-up CPU: {e_cpu}")

    _GPU_CHECKED = True

@asynccontextmanager
async def lifespan(app: FastAPI):
    threading.Thread(target=_detect_and_warmup_whisper, daemon=True).start()
    yield

app = FastAPI(title="Worker Whisper Microservice (GPU & CPU Fallback)", version="2.0.0", lifespan=lifespan)
 
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"success": False, "detail": exc.detail},
    )

@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "service": "worker-whisper",
        "device": "gpu" if _USE_GPU else "cpu",
        "gpu_available": _USE_GPU,
        "backend": _GPU_DEVICE_NAME,
        "model_exists": os.path.exists(WHISPER_MODEL_PATH),
        "whisper_bin_exists": os.path.exists(WHISPER_BIN)
    }

@app.post("/api/transcribe")
async def transcribe_media(
    request: Request,
    file: UploadFile = File(...),
    language: str = Form("auto"),
    format: str = Form("txt"),
    task: str = Form("transcribe")
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Tên file không hợp lệ")

    trace_id, parent_span_id = parse_traceparent(request.headers.get("traceparent"))

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

        # 1. Convert media sang 16kHz 16-bit Mono WAV cho Whisper (đa luồng -threads 0, bỏ qua video stream -vn)
        t_ff_start = time.perf_counter()
        cmd_ffmpeg = [
            "ffmpeg", "-y", "-threads", "0", "-vn", "-i", temp_in_path,
            "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le",
            wav_path
        ]
        res_ff = subprocess.run(cmd_ffmpeg, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if res_ff.returncode != 0:
            raise HTTPException(status_code=500, detail=f"FFmpeg chuyển đổi âm thanh thất bại: {res_ff.stderr}")
        dur_ffmpeg_ms = (time.perf_counter() - t_ff_start) * 1000.0

        # Lấy thời lượng audio tức thì bằng module wave chuẩn (0.05 ms thay vì gọi ffprobe subprocess tốn 250ms)
        duration_sec = 0.0
        try:
            with wave.open(wav_path, "rb") as wf:
                frames = wf.getnframes()
                rate = wf.getframerate()
                if rate > 0:
                    duration_sec = round(float(frames) / float(rate), 2)
        except Exception:
            duration_sec = 0.0

        send_otlp_trace(
            name="    ├─ 🎵 [1/2] Chuẩn hóa âm thanh WAV 16kHz (FFmpeg)",
            duration_ms=dur_ffmpeg_ms,
            attributes={
                "audio.duration_sec": duration_sec,
                "file.name": file.filename or "media",
            },
            trace_id=trace_id,
            parent_span_id=parent_span_id,
        )

        # [Issue 4] Giới hạn thời lượng tối đa 10 phút (600s)
        if duration_sec > 600.0:
            mins = int(duration_sec // 60)
            secs = int(duration_sec % 60)
            raise HTTPException(
                status_code=400,
                detail=f"Thời lượng audio ({mins} phút {secs} giây) vượt quá giới hạn tối đa cho phép là 10 phút. Vui lòng chọn file ngắn hơn."
            )

        # 2. Chạy whisper-cli ưu tiên GPU (CUDA -ngl 99), tự động fallback CPU nếu không có GPU hoặc gặp lỗi
        cpu_threads = str(min(os.cpu_count() or 16, 16))
        actual_device = "gpu" if _USE_GPU else "cpu"
        backend_name = _GPU_DEVICE_NAME if _USE_GPU else "CPU (AVX2 Multithreading)"

        def _build_whisper_cmd(use_gpu: bool):
            cmd = [
                WHISPER_BIN,
                "-m", WHISPER_MODEL_PATH,
                "-f", wav_path,
                "-bs", "1",
                "-bo", "1",
                "-nf",
                "-sns",
                "-nth", "0.35",
                "--output-json",
                "-of", out_base
            ]
            if use_gpu:
                cmd.extend(["-dev", "0", "-t", "4"])
            else:
                cmd.extend(["-ng", "-t", cpu_threads])
            if language and language != "auto":
                cmd.extend(["-l", language])
            if clean_task == "translate":
                cmd.append("--translate")
            return cmd

        cmd_whisper = _build_whisper_cmd(_USE_GPU)
        start_t = time.perf_counter()
        res_wh = subprocess.run(cmd_whisper, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

        # Nếu chạy GPU bị lỗi, tự động thử lại ngay lập tức với CPU đa luồng
        if res_wh.returncode != 0 and _USE_GPU:
            logger.warning(f"⚠️ Whisper GPU CUDA lỗi ({res_wh.stderr}). Tự động chuyển sang fallback CPU...")
            cmd_whisper = _build_whisper_cmd(False)
            res_wh = subprocess.run(cmd_whisper, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            actual_device = "cpu"
            backend_name = "CPU (AVX2 Fallback)"

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
                    "model": os.path.basename(WHISPER_MODEL_PATH),
                    "device": actual_device,
                    "backend": backend_name
                }
                json.dump(export_json, out_f, ensure_ascii=False, indent=2)
            else:
                out_f.write(text_content)

        send_otlp_trace(
            name=f"    └─ 🎙️ [2/2] Nhận diện giọng nói AI ({backend_name})",
            duration_ms=proc_time * 1000.0,
            attributes={
                "http.route": "/api/transcribe",
                "http.method": "POST",
                "http.status_code": 200,
                "ai.model": f"Whisper ({backend_name})",
                "ai.device": actual_device,
                "ai.audio_duration_sec": duration_sec,
                "ai.detected_language": language,
                "ai.output_format": clean_format,
            },
            trace_id=trace_id,
            parent_span_id=parent_span_id,
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
            "model_used": os.path.basename(WHISPER_MODEL_PATH),
            "device": actual_device,
            "backend": backend_name
        }
    except HTTPException:
        raise
    except Exception as e:
        send_otlp_trace(
            name="🎙️ [Whisper] Nhận diện giọng nói (GGML C++ Engine)",
            duration_ms=50.0,
            attributes={"error": str(e), "http.status_code": 500},
            trace_id=trace_id,
            parent_span_id=parent_span_id,
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
