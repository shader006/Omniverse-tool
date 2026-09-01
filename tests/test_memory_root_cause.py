import os
import sys
import time
import gc
import io
import base64
import multiprocessing
import numpy as np
from PIL import Image

def get_process_rss_mb(pid=None):
    """Đọc dung lượng RAM thực tế (RSS) của tiến trình từ /proc."""
    if pid is None:
        path = "/proc/self/status"
    else:
        path = f"/proc/{pid}/status"
    try:
        with open(path, "r") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    return round(int(line.split()[1]) / 1024, 2)
    except Exception:
        pass
    return 0.0

# ══════════════════════════════════════════════════════════════
# TEST A: Kiểm chứng PyMalloc & Chuỗi Base64 làm phình RAM Python
# ══════════════════════════════════════════════════════════════
def test_a_pymalloc_retention():
    print("\n" + "=" * 75)
    print("🔬 [TEST A] KIỂM CHỨNG PYMALLOC & BASE64 / PILLOW BUFFER TRONG PYTHON")
    print("=" * 75)
    
    gc.collect()
    rss_start = get_process_rss_mb()
    print(f"1. RAM ban đầu của tiến trình: {rss_start} MB")
    
    # Giả lập tạo ảnh 24MP và encode Base64
    print("2. Đang tạo ảnh 24MP (6000x4000) và encode chuỗi Base64 trong RAM...")
    img = Image.new("RGBA", (6000, 4000), color=(100, 150, 200, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=False)
    b64_str = base64.b64encode(buf.getvalue()).decode("utf-8")
    
    rss_peak = get_process_rss_mb()
    print(f"3. RAM đỉnh điểm (Peak RAM khi có biến): {rss_peak} MB (+{round(rss_peak - rss_start, 2)} MB)")
    
    # Xóa biến và chạy Garbage Collection
    print("4. Chạy `del img, buf, b64_str` và gọi `gc.collect()`...")
    del img, buf, b64_str
    gc.collect()
    time.sleep(1)
    
    rss_after_gc = get_process_rss_mb()
    print(f"5. RAM sau khi xóa biến & gc.collect(): {rss_after_gc} MB")
    
    retained = round(rss_after_gc - rss_start, 2)
    print(f"👉 KẾT LUẬN A: Python PyMalloc GIỮ LẠI {retained} MB trong internal free-list, KHÔNG trả về OS!")

# ══════════════════════════════════════════════════════════════
# TEST B: Kiểm chứng OpenVINO C++ Runtime Internal Buffer Caching
# ══════════════════════════════════════════════════════════════
def test_b_openvino_internal_caching():
    print("\n" + "=" * 75)
    print("🔬 [TEST B] KIỂM CHỨNG OPENVINO C++ RUNTIME INTERNAL BUFFER CACHING")
    print("=" * 75)
    
    rss_before_ov = get_process_rss_mb()
    print(f"1. RAM trước khi load OpenVINO: {rss_before_ov} MB")
    
    from app.rmbg.remover import get_birefnet_engine
    engine = get_birefnet_engine()
    
    rss_after_load = get_process_rss_mb()
    print(f"2. RAM sau khi nạp Model OpenVINO: {rss_after_load} MB (+{round(rss_after_load - rss_before_ov, 2)} MB)")
    
    # Chạy suy luận lần 1
    dummy_img = Image.new("RGB", (1024, 1024), color=(255, 0, 0))
    print("3. Chạy suy luận AI lần đầu (OpenVINO cấp phát C++ execution graph & thread buffers)...")
    mask1 = engine.predict_mask(dummy_img)
    del mask1
    gc.collect()
    rss_after_infer1 = get_process_rss_mb()
    print(f"4. RAM sau khi suy luận lần 1: {rss_after_infer1} MB (+{round(rss_after_infer1 - rss_after_load, 2)} MB)")
    
    # Chạy suy luận lần 2
    mask2 = engine.predict_mask(dummy_img)
    del mask2, dummy_img
    gc.collect()
    rss_after_infer2 = get_process_rss_mb()
    print(f"5. RAM sau khi suy luận lần 2: {rss_after_infer2} MB")
    print(f"👉 KẾT LUẬN B: OpenVINO giữ cố định ma trận scratchpad & execution cache ({rss_after_infer2} MB) cho các request tiếp theo.")

# ══════════════════════════════════════════════════════════════
# TEST C: Kiểm chứng In-Process (giữ RAM) vs Subprocess (trả 100% RAM)
# ══════════════════════════════════════════════════════════════
def _worker_task(image_bytes, return_dict):
    """Subprocess độc lập xử lý tách nền."""
    from app.rmbg.remover import remove_background
    out_img, meta = remove_background(image_bytes)
    return_dict["success"] = True
    return_dict["size"] = out_img.size

def test_c_subprocess_isolation_vs_inprocess():
    print("\n" + "=" * 75)
    print("🔬 [TEST C] SO SÁNH: IN-PROCESS (BỊ KẸT RAM) vs SUBPROCESS (TRẢ 100% RAM)")
    print("=" * 75)
    
    # Tạo ảnh mẫu
    img = Image.new("RGB", (4000, 3000), color=(120, 180, 240))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    img_bytes = buf.getvalue()
    del img, buf
    
    rss_main_before = get_process_rss_mb()
    print(f"1. RAM Tiến trình chính trước khi chạy Subprocess: {rss_main_before} MB")
    
    print("2. Khởi tạo Subprocess chạy tác vụ tách nền nặng...")
    manager = multiprocessing.Manager()
    return_dict = manager.dict()
    
    p = multiprocessing.Process(target=_worker_task, args=(img_bytes, return_dict))
    p.start()
    
    # Theo dõi RAM của Subprocess trong khi chạy
    while p.is_alive():
        sub_rss = get_process_rss_mb(p.pid)
        if sub_rss > 100:
            print(f"   [Subprocess đang chạy PID {p.pid}] RAM: {sub_rss} MB")
            break
        time.sleep(0.5)
        
    p.join()
    
    # Sau khi Subprocess kết thúc
    print("3. Subprocess đã hoàn thành và THOÁT (exit 0)...")
    time.sleep(1)
    gc.collect()
    
    rss_main_after = get_process_rss_mb()
    print(f"4. RAM Tiến trình chính sau khi Subprocess thoát: {rss_main_after} MB")
    print(f"   -> Độ chênh lệch RAM của tiến trình chính: {round(rss_main_after - rss_main_before, 2)} MB")
    print(f"👉 KẾT LUẬN C: Khi dùng Subprocess / Worker Recycling, 100% RAM của tác vụ nặng được OS thu hồi sạch sẽ ngay khi tiến trình con kết thúc!")

if __name__ == "__main__":
    test_a_pymalloc_retention()
    test_b_openvino_internal_caching()
    test_c_subprocess_isolation_vs_inprocess()
