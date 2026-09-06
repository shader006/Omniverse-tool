"""
Dedicated High-Performance Background Removal Engine powered by BiRefNet-Lite & Intel OpenVINO.
Optimized for ultra-low memory footprint and fast inference.
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
import numpy as np

logger = logging.getLogger("rmbg_engine")

# Global Thread-Safe Singleton Engine & Inference Serializer
_BIREFNET_ENGINE: Optional[Any] = None
_BIREFNET_LOCK = threading.Lock()
_INFERENCE_LOCK = threading.Lock()  # Đảm bảo tuyệt đối 1 inference tại 1 thời điểm

# Safety Limits: 2560px (~2.5K) cân bằng hoàn hảo giữa độ nét studio cực cao và chống tràn RAM
MAX_IMAGE_SIZE = 2560
TARGET_INFERENCE_SIZE = (1024, 1024)

# ImageNet normalization constants
IMAGENET_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32).reshape((1, 3, 1, 1))
IMAGENET_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32).reshape((1, 3, 1, 1))


def get_optimal_cpu_threads() -> Optional[int]:
    """
    Xác định số luồng CPU cho OpenVINO / ONNX.
    Nếu trả về None: Để OpenVINO tự động quản lý (Auto TBB scheduler) để tối ưu theo kiến trúc CPU.
    Có thể tùy chỉnh qua biến môi trường RMBG_NUM_THREADS.
    """
    env_threads = os.getenv("RMBG_NUM_THREADS")
    if env_threads:
        try:
            t = int(env_threads.strip())
            if t > 0:
                return t
        except ValueError:
            pass
    # Mặc định trả về None để OpenVINO tự tối ưu theo số core thực tế của máy chủ
    return None


def hex_to_rgb(hex_str: str) -> Tuple[int, int, int]:
    """Chuyển mã màu hex sang RGB tuple."""
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


def cleanup_python_memory():
    """Thu gom rác Python GC (không can thiệp C++ arena heap)."""
    import gc
    gc.collect()


# Alias tương thích ngược
free_system_memory = cleanup_python_memory



def get_birefnet_model_path() -> str:
    """Xác định file mô hình BiRefNet-Lite ONNX / OpenVINO."""
    custom_path = os.getenv("BIREFNET_MODEL_PATH")
    if custom_path and os.path.exists(custom_path):
        return custom_path

    cache_dir = os.path.expanduser(os.getenv("BIREFNET_CACHE_DIR", "~/.cache/birefnet"))
    os.makedirs(cache_dir, exist_ok=True)
    model_path = os.path.join(cache_dir, "birefnet_lite.onnx")

    if not os.path.exists(model_path):
        logger.info(f"Downloading BiRefNet-Lite ONNX model to {model_path}...")
        try:
            from huggingface_hub import hf_hub_download
            downloaded = hf_hub_download(
                repo_id="onnx-community/BiRefNet_lite-ONNX",
                filename="onnx/model.onnx",
                local_dir=cache_dir,
            )
            if os.path.exists(downloaded) and downloaded != model_path:
                import shutil
                shutil.copy2(downloaded, model_path)
            logger.info("✅ BiRefNet-Lite download completed.")
        except Exception as e:
            logger.warning(f"Lỗi tải từ Hugging Face Hub: {e}. Thử tải URL trực tiếp...")
            try:
                import urllib.request
                fallback_url = "https://huggingface.co/onnx-community/BiRefNet_lite-ONNX/resolve/main/onnx/model.onnx"
                urllib.request.urlretrieve(fallback_url, model_path)
                logger.info("✅ Tải BiRefNet-Lite qua URL dự phòng thành công.")
            except Exception as e_url:
                logger.error(f"Không thể tải BiRefNet-Lite model: {e_url}")
                if os.path.exists(model_path):
                    os.remove(model_path)
                return ""
    return model_path


class BiRefNetOpenVINOEngine:
    """Engine tách nền BiRefNet-Lite tăng tốc bởi Intel OpenVINO."""

    def __init__(self, model_path: str, num_threads: Optional[int] = None):
        self.model_path = model_path
        self.num_threads = num_threads if (num_threads and num_threads > 0) else get_optimal_cpu_threads()
        self.backend = "unknown"
        self.compiled_model = None
        self._init_engine()

    def _init_engine(self):
        # 1. OpenVINO Runtime
        try:
            import openvino as ov
            core = ov.Core()
            logger.info(f"Loading BiRefNet-Lite into OpenVINO Core from: {self.model_path}")
            model = core.read_model(self.model_path)

            config = {
                "PERFORMANCE_HINT": "LATENCY",
                "NUM_STREAMS": "1",
                "ENABLE_CPU_PINNING": "NO",
            }
            if self.num_threads and self.num_threads > 0:
                config["INFERENCE_NUM_THREADS"] = str(self.num_threads)

            self.compiled_model = core.compile_model(model, "CPU", config)
            self.backend = "openvino"
            thread_str = f"{self.num_threads} CPU threads" if self.num_threads else "Auto TBB threads"
            logger.info(f"🚀 [OpenVINO] BiRefNet-Lite đã nạp thành công ({thread_str}).")
            return
        except Exception as e:
            logger.warning(f"Lỗi OpenVINO Core: {e}. Thử chuyển sang ONNX Runtime...")

        # 2. Fallback sang ONNX Runtime
        try:
            import onnxruntime as ort
            opts = ort.SessionOptions()
            if self.num_threads and self.num_threads > 0:
                opts.intra_op_num_threads = self.num_threads
            opts.inter_op_num_threads = 1
            opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            opts.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
            opts.enable_cpu_mem_arena = False

            self.compiled_model = ort.InferenceSession(
                self.model_path,
                sess_options=opts,
                providers=["CPUExecutionProvider"],
            )
            self.backend = "onnxruntime"
            thread_str = f"{self.num_threads} CPU threads" if self.num_threads else "Auto threads"
            logger.info(f"⚡ [ONNX Runtime] BiRefNet-Lite đã nạp thành công ({thread_str}).")
        except Exception as e:
            logger.error(f"Lỗi khởi tạo ONNX Runtime: {e}")
            self.compiled_model = None
            self.backend = "failed"

    def predict_mask(self, pil_img: Image.Image) -> Optional[Image.Image]:
        """Tạo Alpha Matte mask sắc nét từ ảnh PIL với quản lý bộ nhớ nghiêm ngặt."""
        if not self.compiled_model:
            return None

        orig_w, orig_h = pil_img.size

        # Preprocessing: Chuyển RGB -> Resize 1024x1024 (BOX / Area Sampling chống mất tóc) -> Normalize ImageNet
        rgb_img = pil_img.convert("RGB")
        resized = rgb_img.resize(TARGET_INFERENCE_SIZE, Image.Resampling.BOX)

        # Tối ưu RAM: Scale in-place, không cấp phát thêm 12MB mảng float32 trung gian thứ hai
        arr = np.asarray(resized, dtype=np.float32)
        arr = np.transpose(arr, (2, 0, 1))  # (3, 1024, 1024)
        arr *= (1.0 / 255.0)  # In-place scaling
        tensor = np.expand_dims(arr, axis=0)  # (1, 3, 1024, 1024)
        tensor -= IMAGENET_MEAN  # In-place normalization
        tensor /= IMAGENET_STD   # In-place normalization

        # Dọn dẹp biến tạm tiền xử lý ngay lập tức
        del resized, arr, rgb_img

        # Inference: Khóa _INFERENCE_LOCK để đảm bảo chuẩn 1 inference tại một thời điểm
        with _INFERENCE_LOCK:
            if self.backend == "openvino":
                infer_req = self.compiled_model.create_infer_request()
                results = infer_req.infer({0: tensor})
                out_tensor = list(results.values())[0]
                del infer_req, results
            elif self.backend == "onnxruntime":
                input_name = self.compiled_model.get_inputs()[0].name
                results = self.compiled_model.run(None, {input_name: tensor})
                out_tensor = results[0]
                del results
            else:
                del tensor
                return None

        del tensor

        # Postprocessing: Squeeze -> Sigmoid (nếu là logits) -> uint8
        out_mask = np.squeeze(out_tensor)
        if out_mask.min() < 0.0 or out_mask.max() > 1.0:
            out_mask = 1.0 / (1.0 + np.exp(-out_mask))

        out_mask = np.clip(out_mask * 255.0, 0, 255).astype(np.uint8)
        mask_img = Image.fromarray(out_mask, mode="L")
        del out_mask, out_tensor

        # Resize mask về đúng kích thước ảnh đầu vào (BICUBIC mượt viền cong, chống răng cưa)
        if (orig_w, orig_h) != TARGET_INFERENCE_SIZE:
            mask_img = mask_img.resize((orig_w, orig_h), Image.Resampling.BICUBIC)

        return mask_img


def get_birefnet_engine(num_threads: Optional[int] = None) -> Optional[BiRefNetOpenVINOEngine]:
    """Khởi tạo hoặc tái sử dụng Singleton BiRefNet Engine."""
    global _BIREFNET_ENGINE
    if _BIREFNET_ENGINE is not None and _BIREFNET_ENGINE.compiled_model is not None:
        return _BIREFNET_ENGINE

    with _BIREFNET_LOCK:
        if _BIREFNET_ENGINE is not None and _BIREFNET_ENGINE.compiled_model is not None:
            return _BIREFNET_ENGINE

        model_path = get_birefnet_model_path()
        if not model_path or not os.path.exists(model_path):
            logger.warning("Không tìm thấy model BiRefNet-Lite.")
            return None

        engine = BiRefNetOpenVINOEngine(model_path=model_path, num_threads=num_threads)
        if engine.compiled_model is not None:
            _BIREFNET_ENGINE = engine
            return _BIREFNET_ENGINE
        return None


# Backward compatibility aliases for unit tests & benchmarks
def get_rembg_session(model_name: Optional[str] = None) -> Optional[BiRefNetOpenVINOEngine]:
    return get_birefnet_engine()

def maybe_trim_memory():
    free_system_memory()


def remove_background(
    image_input: Union[bytes, str, Image.Image],
    model_name: str = "birefnet-lite",
    bg_color: Optional[Union[str, Tuple[int, int, int]]] = None,
    num_threads: Optional[int] = None,
    alpha_matting: bool = False,
) -> Tuple[Image.Image, Dict[str, Any]]:
    """
    Tách nền ảnh bằng mô hình BiRefNet-Lite (OpenVINO Engine) với kiểm soát bộ nhớ an toàn.
    """
    start_total = time.perf_counter()

    # 1. Tiền xử lý ảnh
    start_load = time.perf_counter()
    if isinstance(image_input, bytes):
        pil_img = Image.open(io.BytesIO(image_input))
    elif isinstance(image_input, str):
        pil_img = Image.open(image_input)
    elif isinstance(image_input, Image.Image):
        pil_img = image_input
    else:
        raise ValueError(f"Định dạng input không hợp lệ: {type(image_input)}")

    pil_img = ImageOps.exif_transpose(pil_img)
    orig_width, orig_height = pil_img.size

    # Thu nhỏ an toàn về tối đa MAX_IMAGE_SIZE (2560px) bằng BILINEAR để tránh peak RAM khi nén PNG
    if pil_img.width > MAX_IMAGE_SIZE or pil_img.height > MAX_IMAGE_SIZE:
        logger.info(f"Tối ưu ảnh lớn ({pil_img.size}) về tối đa {MAX_IMAGE_SIZE}px để đảm bảo an toàn bộ nhớ.")
        pil_img.thumbnail((MAX_IMAGE_SIZE, MAX_IMAGE_SIZE), Image.Resampling.BILINEAR)

    load_time_ms = (time.perf_counter() - start_load) * 1000

    # 2. Suy luận AI với BiRefNet-Lite
    start_infer = time.perf_counter()
    engine = get_birefnet_engine(num_threads=num_threads)
    output_img = None
    backend_display = "BiRefNet-Lite (Fallback)"

    if engine and engine.compiled_model is not None:
        mask = engine.predict_mask(pil_img)
        if mask is not None:
            rgba = pil_img.convert("RGBA")
            rgba.putalpha(mask)
            output_img = rgba
            backend_display = f"BiRefNet-Lite ({engine.backend.upper()})"
            del mask

    if output_img is None:
        output_img = _fallback_remove_bg(pil_img)
        backend_display = "Color-Distance Fallback"

    infer_time_ms = (time.perf_counter() - start_infer) * 1000

    # 3. Đổ màu nền nếu được yêu cầu
    start_post = time.perf_counter()
    if bg_color is not None and bg_color != "transparent" and bg_color != "":
        rgb = hex_to_rgb(bg_color) if isinstance(bg_color, str) else bg_color
        bg_canvas = Image.new("RGBA", output_img.size, (*rgb, 255))
        bg_canvas.paste(output_img, (0, 0), mask=output_img)
        output_img = bg_canvas

    post_time_ms = (time.perf_counter() - start_post) * 1000
    total_time_ms = (time.perf_counter() - start_total) * 1000

    metadata = {
        "model": "birefnet-lite",
        "model_display": backend_display,
        "backend": backend_display,
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

    free_system_memory()
    return output_img, metadata


async def remove_background_async(
    image_input: Union[bytes, str, Image.Image],
    model_name: str = "birefnet-lite",
    bg_color: Optional[Union[str, Tuple[int, int, int]]] = None,
    num_threads: Optional[int] = None,
    alpha_matting: bool = False,
) -> Tuple[Image.Image, Dict[str, Any]]:
    """Hàm bất đồng bộ."""
    return await asyncio.to_thread(
        remove_background,
        image_input,
        model_name,
        bg_color,
        num_threads,
        alpha_matting,
    )


def _fallback_remove_bg(pil_img: Image.Image, threshold: int = 30) -> Image.Image:
    """Fallback tách nền nhanh dựa trên màu góc ảnh với mức tiêu thụ RAM tối thiểu."""
    rgba = pil_img.convert("RGBA")
    w, h = rgba.size
    try:
        # Lấy màu 4 góc trực tiếp từ ảnh không cần clone mảng int32 lớn
        c1 = np.array(rgba.getpixel((0, 0))[:3], dtype=np.float32)
        c2 = np.array(rgba.getpixel((w - 1, 0))[:3], dtype=np.float32)
        c3 = np.array(rgba.getpixel((0, h - 1))[:3], dtype=np.float32)
        c4 = np.array(rgba.getpixel((w - 1, h - 1))[:3], dtype=np.float32)
        avg_bg = (c1 + c2 + c3 + c4) * 0.25

        arr = np.array(rgba)  # 2560x2560x4 uint8 (~26MB)
        # Tính khoảng cách theo từng kênh màu trực tiếp, tránh nhân bản mảng 75MB int32
        diff_r = np.abs(arr[:, :, 0].astype(np.float32) - avg_bg[0])
        diff_g = np.abs(arr[:, :, 1].astype(np.float32) - avg_bg[1])
        diff_b = np.abs(arr[:, :, 2].astype(np.float32) - avg_bg[2])
        mask = (diff_r <= threshold) & (diff_g <= threshold) & (diff_b <= threshold)
        arr[mask, 3] = 0
        del diff_r, diff_g, diff_b, mask
        res = Image.fromarray(arr, "RGBA")
        del arr
        return res
    except Exception:
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
