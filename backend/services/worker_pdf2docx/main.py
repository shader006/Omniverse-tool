import os
import sys
import time
import uuid
import json
import shutil
import queue
import logging
import tempfile
import threading
import urllib.request
from typing import Optional, Tuple
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request
from fastapi.responses import FileResponse
from starlette.background import BackgroundTasks
import uvicorn
import pikepdf
from pdf2docx import Converter

from post_processor import post_process_docx

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("worker_pdf2docx")

app = FastAPI(title="Worker PDF-to-DOCX Microservice", version="1.0.0")

DOWNLOAD_DIR = os.getenv("DOWNLOAD_DIR", "/app/downloads")
os.makedirs(DOWNLOAD_DIR, exist_ok=True)

# ─────────────────────────────────────────────────────────────
# OTLP TELEMETRY SENDER (HiAi Observe Distributed Tracing)
# ─────────────────────────────────────────────────────────────
HIAI_OBSERVE_URL = os.getenv("HIAI_OBSERVE_URL", "http://172.17.0.1:8001")
HIAI_OBSERVE_API_KEY = os.getenv("HIAI_OBSERVE_API_KEY", "")
_TRACE_QUEUE = queue.Queue(maxsize=1000)


def _send_otlp_http(payload: dict):
    if not HIAI_OBSERVE_API_KEY:
        return
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{HIAI_OBSERVE_URL}/v1/traces",
        data=data,
        headers={
            "Authorization": f"Bearer {HIAI_OBSERVE_API_KEY}",
            "Content-Type": "application/json",
        },
    )
    # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected - internal OTLP
    with urllib.request.urlopen(req, timeout=2.0) as resp:
        _ = resp.read()


def _telemetry_worker():
    while True:
        try:
            payload = _TRACE_QUEUE.get()
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
    trace_id: str,
    parent_span_id: Optional[str] = None,
    is_error: bool = False,
):
    """Gửi OTLP trace span lên HiAi Observe liên kết theo cây phân tán."""
    if not HIAI_OBSERVE_API_KEY:
        return

    try:
        now_ns = int(time.time() * 1e9)
        start_ns = now_ns - int(duration_ms * 1e6)
        span_id = uuid.uuid4().hex[:16]

        attrs_list = [
            {"key": "service.name", "value": {"stringValue": "worker-pdf2docx"}},
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
            "traceId": trace_id,
            "spanId": span_id,
            "name": name,
            "kind": 1,
            "startTimeUnixNano": str(start_ns),
            "endTimeUnixNano": str(now_ns),
            "attributes": attrs_list,
            "status": {"code": 2 if is_error else 1},
        }
        if parent_span_id:
            span_obj["parentSpanId"] = parent_span_id

        payload = {
            "resourceSpans": [
                {
                    "resource": {"attributes": attrs_list[:2]},
                    "scopeSpans": [
                        {
                            "scope": {"name": "pdf2docx-tracer", "version": "1.0.0"},
                            "spans": [span_obj],
                        }
                    ],
                }
            ]
        }
        _TRACE_QUEUE.put_nowait(payload)
    except Exception:
        pass


def remove_temp_path(path: str):
    """Xóa file hoặc thư mục tạm an toàn sau khi đã stream xong."""
    try:
        if os.path.isfile(path) or os.path.islink(path):
            os.remove(path)
        elif os.path.isdir(path):
            shutil.rmtree(path, ignore_errors=True)
    except Exception as e:
        logger.warning(f"Lỗi khi dọn dẹp file tạm {path}: {e}")


@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "service": "worker_pdf2docx",
        "engine": "pikepdf + pdf2docx + python-docx",
    }


@app.post("/convert")
async def convert_pdf_to_docx(
    request: Request,
    file: UploadFile = File(...),
    target_font: Optional[str] = Form(None),
    background_tasks: BackgroundTasks = BackgroundTasks(),
):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=400,
            detail="Định dạng file không hợp lệ. Chỉ chấp nhận file có đuôi .pdf.",
        )

    trace_id, parent_span_id = parse_traceparent(request.headers.get("traceparent"))

    req_start = time.perf_counter()
    task_id = str(uuid.uuid4())
    temp_dir = tempfile.mkdtemp(prefix=f"pdf2docx_{task_id}_")
    input_pdf_path = os.path.join(temp_dir, "input.pdf")
    sanitized_pdf_path = os.path.join(temp_dir, "sanitized.pdf")
    output_docx_path = os.path.join(temp_dir, "output.docx")

    try:
        # 1. Lưu file upload vào thư mục tạm
        content = await file.read()
        if len(content) == 0:
            raise HTTPException(status_code=400, detail="File tải lên rỗng (0 bytes).")
        with open(input_pdf_path, "wb") as f:
            f.write(content)

        # 2. Tiền xử lý bằng pikepdf: Sửa header, gỡ bỏ hạn chế quyền / encryption
        convert_source = input_pdf_path
        t_pike_start = time.perf_counter()
        pike_repaired = False
        try:
            with pikepdf.open(input_pdf_path) as pdf:
                pdf.save(sanitized_pdf_path)
            convert_source = sanitized_pdf_path
            pike_repaired = True
            logger.info(f"[{task_id}] pikepdf sửa và gỡ hạn chế PDF thành công.")
        except Exception as e:
            logger.warning(f"[{task_id}] pikepdf sanitize warning (dùng file gốc): {e}")
        dur_pike = (time.perf_counter() - t_pike_start) * 1000.0

        send_otlp_trace(
            name="    ├─ 📄 [1/3] Kiểm tra & Sửa lỗi PDF (pikepdf)",
            duration_ms=dur_pike,
            attributes={
                "pdf.input_size_bytes": len(content),
                "pdf.repaired": pike_repaired,
                "file.name": file.filename or "document.pdf",
            },
            trace_id=trace_id,
            parent_span_id=parent_span_id,
        )

        # 3. Chuyển đổi PDF sang DOCX bằng pdf2docx
        t_conv_start = time.perf_counter()
        logger.info(f"[{task_id}] Bắt đầu chạy pdf2docx.Converter...")
        cv = Converter(convert_source)
        try:
            cv.convert(output_docx_path, multi_processing=True, cpu_count=2)
        finally:
            cv.close()
        dur_conv = (time.perf_counter() - t_conv_start) * 1000.0

        if not os.path.exists(output_docx_path) or os.path.getsize(output_docx_path) == 0:
            raise HTTPException(
                status_code=500,
                detail="Quá trình chuyển đổi PDF sang Word thất bại hoặc file đầu ra rỗng.",
            )

        send_otlp_trace(
            name="    ├─ 📑 [2/3] Phân tích layout & Chuyển đổi DOCX (pdf2docx)",
            duration_ms=dur_conv,
            attributes={
                "docx.raw_size_bytes": os.path.getsize(output_docx_path),
            },
            trace_id=trace_id,
            parent_span_id=parent_span_id,
        )

        # 4. Hậu xử lý bằng python-docx
        t_post_start = time.perf_counter()
        post_process_docx(
            output_docx_path,
            target_font=target_font if target_font and target_font.strip() else None,
            remove_empty_paragraphs=True,
            optimize_tables=True,
            stitch_paragraphs=True,
        )
        dur_post = (time.perf_counter() - t_post_start) * 1000.0

        send_otlp_trace(
            name="    └─ 🎨 [3/3] Hậu xử lý Font & Màu chữ (python-docx)",
            duration_ms=dur_post,
            attributes={
                "target_font": target_font or "Keep Original",
                "docx.final_size_bytes": os.path.getsize(output_docx_path),
            },
            trace_id=trace_id,
            parent_span_id=parent_span_id,
        )

        total_duration_ms = (time.perf_counter() - req_start) * 1000.0
        doc_size = os.path.getsize(output_docx_path)
        logger.info(f"[{task_id}] Hoàn thành convert PDF -> DOCX ({doc_size} bytes) trong {total_duration_ms:.2f}ms")

        send_otlp_trace(
            name=" └─ 📦 [Worker-PDF2DOCX] Chuyển đổi PDF sang DOCX",
            duration_ms=total_duration_ms,
            attributes={
                "file.name": file.filename or "document.pdf",
                "docx.size_bytes": doc_size,
                "target_font": target_font or "default",
            },
            trace_id=trace_id,
            parent_span_id=parent_span_id,
        )

        # Tên file download
        original_name = file.filename or "document.pdf"
        base_name = os.path.splitext(original_name)[0]
        out_filename = f"{base_name}.docx"

        # Đăng ký dọn dẹp thư mục tạm sau khi phản hồi trả về client
        background_tasks.add_task(remove_temp_path, temp_dir)

        return FileResponse(
            path=output_docx_path,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            filename=out_filename,
            headers={
                "X-Conversion-Engine": "pikepdf+pdf2docx+python-docx",
                "X-Processing-Time-Ms": f"{total_duration_ms:.2f}",
            },
        )

    except HTTPException as he:
        remove_temp_path(temp_dir)
        total_duration_ms = (time.perf_counter() - req_start) * 1000.0
        send_otlp_trace(
            name="📦 [PDF2DOCX] Toàn trình Worker PDF-to-DOCX",
            duration_ms=total_duration_ms,
            attributes={"error": he.detail, "http.status_code": he.status_code},
            trace_id=trace_id,
            parent_span_id=parent_span_id,
            is_error=True,
        )
        raise
    except Exception as e:
        remove_temp_path(temp_dir)
        total_duration_ms = (time.perf_counter() - req_start) * 1000.0
        logger.exception(f"[{task_id}] Lỗi chuyển đổi PDF sang DOCX: {e}")
        send_otlp_trace(
            name="📦 [PDF2DOCX] Toàn trình Worker PDF-to-DOCX",
            duration_ms=total_duration_ms,
            attributes={"error": str(e), "http.status_code": 500},
            trace_id=trace_id,
            parent_span_id=parent_span_id,
            is_error=True,
        )
        raise HTTPException(
            status_code=500,
            detail=f"Lỗi khi chuyển đổi file PDF sang Word: {str(e)}",
        )


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8005"))
    uvicorn.run(app, host="0.0.0.0", port=port)
