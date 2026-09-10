import os
import sys
import time
import uuid
import shutil
import logging
import tempfile
from typing import Optional
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
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
    file: UploadFile = File(...),
    target_font: Optional[str] = Form(None),
    background_tasks: BackgroundTasks = BackgroundTasks(),
):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=400,
            detail="Định dạng file không hợp lệ. Chỉ chấp nhận file có đuôi .pdf.",
        )

    req_start = time.perf_counter()
    task_id = str(uuid.uuid4())
    temp_dir = tempfile.mkdtemp(prefix=f"pdf2docx_{task_id}_")
    input_pdf_path = os.path.join(temp_dir, "input.pdf")
    sanitized_pdf_path = os.path.join(temp_dir, "sanitized.pdf")
    output_docx_path = os.path.join(temp_dir, "output.docx")

    try:
        # 1. Lưu file upload vào thư mục tạm
        with open(input_pdf_path, "wb") as f:
            content = await file.read()
            if len(content) == 0:
                raise HTTPException(status_code=400, detail="File tải lên rỗng (0 bytes).")
            f.write(content)

        # 2. Tiền xử lý bằng pikepdf: Sửa header, gỡ bỏ hạn chế quyền / encryption
        convert_source = input_pdf_path
        try:
            with pikepdf.open(input_pdf_path) as pdf:
                pdf.save(sanitized_pdf_path)
            convert_source = sanitized_pdf_path
            logger.info(f"[{task_id}] pikepdf sửa và gỡ hạn chế PDF thành công.")
        except Exception as e:
            logger.warning(f"[{task_id}] pikepdf sanitize warning (sẽ dùng file gốc): {e}")

        # 3. Chuyển đổi PDF sang DOCX bằng pdf2docx
        logger.info(f"[{task_id}] Bắt đầu chạy pdf2docx.Converter...")
        cv = Converter(convert_source)
        try:
            cv.convert(output_docx_path, multi_processing=True, cpu_count=2)
        finally:
            cv.close()

        if not os.path.exists(output_docx_path) or os.path.getsize(output_docx_path) == 0:
            raise HTTPException(
                status_code=500,
                detail="Quá trình chuyển đổi PDF sang Word thất bại hoặc file đầu ra rỗng.",
            )

        # 4. Hậu xử lý bằng python-docx
        post_process_docx(
            output_docx_path,
            target_font=target_font if target_font and target_font.strip() else None,
            remove_empty_paragraphs=True,
            optimize_tables=True,
            stitch_paragraphs=True,
        )

        duration_ms = (time.perf_counter() - req_start) * 1000.0
        doc_size = os.path.getsize(output_docx_path)
        logger.info(f"[{task_id}] Hoàn thành convert PDF -> DOCX ({doc_size} bytes) trong {duration_ms:.2f}ms")

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
                "X-Processing-Time-Ms": f"{duration_ms:.2f}",
            },
        )

    except HTTPException:
        remove_temp_path(temp_dir)
        raise
    except Exception as e:
        remove_temp_path(temp_dir)
        logger.exception(f"[{task_id}] Lỗi chuyển đổi PDF sang DOCX: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Lỗi khi chuyển đổi file PDF sang Word: {str(e)}",
        )


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8005"))
    uvicorn.run(app, host="0.0.0.0", port=port)
