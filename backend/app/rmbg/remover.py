"""
Background Removal Engine using BRIA AI RMBG-1.4 & ONNX Runtime CPU Optimization.
"""

import io
import os
import sys
import time
import logging
import threading
import asyncio
from typing import Optional, Union, Tuple, Dict, Any

from PIL import Image, ImageOps

logger = logging.getLogger("rmbg_engine")

# Global Thread-Safe Session Cache
_SESSION_CACHE: Dict[str, Any] = {}
_SESSION_LOCK = threading.Lock()

# Global Memory Trimming Controller (Debounced / Batch-based)
_REQUEST_COUNT = 0
_LAST_TRIM_TIME = 0.0
_TRIM_LOCK = threading.Lock()

# Safety Limits
MAX_IMAGE_SIZE = 4096  # Giới hạn kích thước tối đa 4K để tránh tràn RAM


def get_optimal_cpu_threads() -> int:
    """Xác định số luồng CPU tối ưu cho ONNX Runtime Inference (4 threads cân bằng tối đa tốc độ & RAM)."""
    cpu_count = os.cpu_count() or 4
    return min(cpu_count, 4)


def get_rembg_session(model_name: str = "bria-rmbg", num_threads: Optional[int] = None):
    """
    Khởi tạo hoặc tái sử dụng Session ONNX Runtime của rembg với cơ chế Thread-Safe Lock.
    """
    global _SESSION_CACHE

    normalized_model = "bria-rmbg" if "bria" in model_name.lower() or "1.4" in model_name.lower() else "u2net"

    # Double-checked locking pattern
    if normalized_model in _SESSION_CACHE:
        return _SESSION_CACHE[normalized_model]

    with _SESSION_LOCK:
        if normalized_model in _SESSION_CACHE:
            return _SESSION_CACHE[normalized_model]

        try:
            import onnxruntime as ort
            from rembg import new_session

            threads = num_threads if (num_threads is not None and num_threads > 0) else get_optimal_cpu_threads()

            # Đọc cấu hình arena từ biến môi trường (mặc định False cho container tiết kiệm RAM)
            enable_arena = os.getenv("ORT_ENABLE_CPU_ARENA", "false").lower() in ("true", "1", "yes")
            enable_mem_pattern = os.getenv("ORT_ENABLE_MEM_PATTERN", "false").lower() in ("true", "1", "yes")

            opts = ort.SessionOptions()
            opts.intra_op_num_threads = threads
            opts.inter_op_num_threads = 1
            opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            opts.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
            opts.enable_cpu_mem_arena = enable_arena
            opts.enable_mem_pattern = enable_mem_pattern

            logger.info(
                f"Initializing ONNX Session for model={normalized_model} with {threads} CPU threads "
                f"(arena={enable_arena}, mem_pattern={enable_mem_pattern})..."
            )
            session = new_session(
                model_name=normalized_model,
                providers=["CPUExecutionProvider"],
                sess_opts=opts,
            )
            _SESSION_CACHE[normalized_model] = session
            return session
        except ImportError as e:
            logger.error(f"Thư viện rembg/onnxruntime chưa được cài đặt: {e}")
            return None
        except Exception as e:
            logger.error(f"Lỗi khi khởi tạo ONNX session cho {normalized_model}: {e}")
            return None


def hex_to_rgb(hex_str: str) -> Tuple[int, int, int]:
    """Chuyển mã màu hex dạng #RRGGBB hoặc #RGB sang tuple (R, G, B), có bắt lỗi an toàn."""
    try:
        if not isinstance(hex_str, str):
            return (255, 255, 255)
        clean_hex = hex_str.lstrip('#').strip()
        if len(clean_hex) == 3:
            clean_hex = ''.join(c * 2 for c in clean_hex)
        if len(clean_hex) != 6:
            return (255, 255, 255)
        return tuple(int(clean_hex[i:i+2], 16) for i in (0, 2, 4))
    except (ValueError, TypeError):
        return (255, 255, 255)


def free_system_memory():
    """Giải phóng toàn bộ bộ nhớ heap C/C++ (glibc malloc_trim) và Python GC về cho OS."""
    import gc
    gc.collect()
    try:
        if sys.platform.startswith("linux"):
            import ctypes
            libc = ctypes.CDLL("libc.so.6")
            libc.malloc_trim(0)
    except Exception:
        pass


def maybe_trim_memory(force: bool = False, interval_seconds: float = 300.0, request_batch: int = 30):
    """
    Dọn dẹp bộ nhớ định kỳ hoặc theo batch request để tránh overhead gọi malloc_trim liên tục.
    """
    global _REQUEST_COUNT, _LAST_TRIM_TIME
    with _TRIM_LOCK:
        _REQUEST_COUNT += 1
        now = time.time()
        if force or _REQUEST_COUNT >= request_batch or (now - _LAST_TRIM_TIME > interval_seconds):
            free_system_memory()
            _REQUEST_COUNT = 0
            _LAST_TRIM_TIME = now


def remove_background(
    image_input: Union[bytes, str, Image.Image],
    model_name: str = "bria-rmbg",
    bg_color: Optional[Union[str, Tuple[int, int, int]]] = None,
    num_threads: Optional[int] = None,
    alpha_matting: bool = False,
    alpha_matting_foreground_threshold: int = 240,
    alpha_matting_background_threshold: int = 10,
    alpha_matting_erode_size: int = 10,
) -> Tuple[Image.Image, Dict[str, Any]]:
    """
    Tách nền ảnh bằng mô hình AI (mặc định BRIA AI RMBG-1.4).

    :param image_input: Bytes ảnh, đường dẫn file, hoặc đối tượng PIL Image.
    :param model_name: 'bria-rmbg' (RMBG-1.4) hoặc 'u2net'.
    :param bg_color: None (nền trong suốt), hoặc mã HEX (#ffffff), hoặc tuple RGB (255, 255, 255).
    :param num_threads: Số luồng CPU cho ONNX Runtime.
    :param alpha_matting: Bật/tắt tinh chỉnh viền lông/tóc mịn.
    :return: (PIL.Image đã tách nền, dict metadata)
    """
    start_total = time.perf_counter()

    # 1. Tiền xử lý: Tải ảnh vào PIL Image và sửa góc xoay EXIF nếu có
    start_load = time.perf_counter()
    if isinstance(image_input, bytes):
        pil_img = Image.open(io.BytesIO(image_input))
    elif isinstance(image_input, str):
        pil_img = Image.open(image_input)
    elif isinstance(image_input, Image.Image):
        pil_img = image_input
    else:
        raise ValueError(f"Định dạng input không hợp lệ: {type(image_input)}")

    # Tự động xoay ảnh theo EXIF orientation nếu có
    pil_img = ImageOps.exif_transpose(pil_img)
    orig_width, orig_height = pil_img.size

    # Bảo vệ chống tràn RAM khi ảnh quá lớn (> 4096px)
    if pil_img.width > MAX_IMAGE_SIZE or pil_img.height > MAX_IMAGE_SIZE:
        logger.warning(f"Ảnh quá lớn ({pil_img.size}), tự động thu nhỏ về tối đa {MAX_IMAGE_SIZE}px để bảo vệ RAM.")
        pil_img.thumbnail((MAX_IMAGE_SIZE, MAX_IMAGE_SIZE), Image.Resampling.LANCZOS)

    load_time_ms = (time.perf_counter() - start_load) * 1000

    # 2. Suy luận AI (ONNX Inference)
    start_infer = time.perf_counter()
    normalized_model = "bria-rmbg" if "bria" in model_name.lower() or "1.4" in model_name.lower() else "u2net"
    session = get_rembg_session(model_name=normalized_model, num_threads=num_threads)

    if session is not None:
        try:
            from rembg import remove
            output_img = remove(
                pil_img,
                session=session,
                alpha_matting=alpha_matting,
                alpha_matting_foreground_threshold=alpha_matting_foreground_threshold,
                alpha_matting_background_threshold=alpha_matting_background_threshold,
                alpha_matting_erode_size=alpha_matting_erode_size,
            )
        except Exception as e:
            logger.error(f"Lỗi trong quá trình inference rembg: {e}. Sử dụng fallback.")
            output_img = _fallback_remove_bg(pil_img)
    else:
        logger.info("Chạy fallback removal (khi không có session rembg)")
        output_img = _fallback_remove_bg(pil_img)

    infer_time_ms = (time.perf_counter() - start_infer) * 1000

    # 3. Hậu xử lý: Thêm màu nền nếu người dùng yêu cầu (không phải transparent)
    start_post = time.perf_counter()
    if bg_color is not None and bg_color != "transparent" and bg_color != "":
        rgb = hex_to_rgb(bg_color) if isinstance(bg_color, str) else bg_color
        bg_canvas = Image.new("RGBA", output_img.size, (*rgb, 255))
        bg_canvas.paste(output_img, (0, 0), mask=output_img)
        output_img = bg_canvas

    post_time_ms = (time.perf_counter() - start_post) * 1000
    total_time_ms = (time.perf_counter() - start_total) * 1000

    metadata = {
        "model": normalized_model,
        "model_display": "BRIA AI RMBG-1.4 (HD)" if normalized_model == "bria-rmbg" else "U2Net (Fast)",
        "original_dimensions": [orig_width, orig_height],
        "output_dimensions": [output_img.width, output_img.height],
        "timing_ms": {
            "load": round(load_time_ms, 2),
            "inference": round(infer_time_ms, 2),
            "post_processing": round(post_time_ms, 2),
            "total": round(total_time_ms, 2),
        },
        "bg_color": str(bg_color) if bg_color else "transparent",
    }

    # Dọn dẹp RAM theo chu kỳ/batch (không block synchronous path mọi request)
    maybe_trim_memory(force=False)

    return output_img, metadata


async def remove_background_async(
    image_input: Union[bytes, str, Image.Image],
    model_name: str = "bria-rmbg",
    bg_color: Optional[Union[str, Tuple[int, int, int]]] = None,
    num_threads: Optional[int] = None,
    alpha_matting: bool = False,
) -> Tuple[Image.Image, Dict[str, Any]]:
    """Hàm bất đồng bộ (async wrapper) để chạy remove_background trong threadpool."""
    return await asyncio.to_thread(
        remove_background,
        image_input,
        model_name,
        bg_color,
        num_threads,
        alpha_matting,
    )


def _fallback_remove_bg(pil_img: Image.Image, threshold: int = 30) -> Image.Image:
    """
    Fallback tách nền nhanh (dùng NumPy vectorization nếu có hoặc Pillow)
    dựa trên màu trung bình 4 góc của ảnh.
    """
    rgba = pil_img.convert("RGBA")
    w, h = rgba.size

    try:
        import numpy as np
        arr = np.array(rgba)
        # Lấy màu 4 góc
        c1 = arr[0, 0, :3].astype(np.int32)
        c2 = arr[0, w-1, :3].astype(np.int32)
        c3 = arr[h-1, 0, :3].astype(np.int32)
        c4 = arr[h-1, w-1, :3].astype(np.int32)
        avg_bg = (c1 + c2 + c3 + c4) / 4.0

        # Tính khoảng cách Euclidean màu
        rgb = arr[:, :, :3].astype(np.int32)
        dist = np.sqrt(np.sum((rgb - avg_bg) ** 2, axis=2))
        mask = dist <= threshold
        arr[mask, 3] = 0
        return Image.fromarray(arr, "RGBA")
    except ImportError:
        # Fallback Pillow nếu không có numpy
        corner = rgba.getpixel((0, 0))
        datas = rgba.getdata()
        new_data = []
        for item in datas:
            if (
                abs(item[0] - corner[0]) <= threshold
                and abs(item[1] - corner[1]) <= threshold
                and abs(item[2] - corner[2]) <= threshold
            ):
                new_data.append((255, 255, 255, 0))
            else:
                new_data.append(item)
        rgba.putdata(new_data)
        return rgba
