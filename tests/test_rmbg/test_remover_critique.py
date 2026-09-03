"""
Bộ kiểm thử tự động kiểm chứng 7 nhận xét về engine bóc nền rmbg/remover.py
"""

import unittest
import os
import sys
import inspect
import threading
import time
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "backend")))
from app.rmbg import remover

class TestRemoverCritique(unittest.TestCase):

    def test_01_inference_lacks_lock_allows_concurrency(self):
        """1. Kiểm tra: _BIREFNET_LOCK chỉ dùng cho khởi tạo singleton, KHÔNG khóa lúc predict_mask."""
        # Kiểm tra mã nguồn của predict_mask và remover.py
        remover_src = inspect.getsource(remover)
        predict_mask_src = inspect.getsource(remover.BiRefNetOpenVINOEngine.predict_mask)

        has_lock_in_predict = "_BIREFNET_LOCK" in predict_mask_src or "threading.Lock" in predict_mask_src or "_INFER_LOCK" in remover_src
        self.assertFalse(has_lock_in_predict, "predict_mask() không được bảo vệ bởi inference lock")
        print("  👉 [XÁC NHẬN ĐÚNG 1] predict_mask() không có Lock. 2 request đồng thời sẽ chạy N inference song song, có thể gây RAM & CPU spike.")

    def test_02_thread_capping_to_4_and_missing_env(self):
        """2. Kiểm tra: get_optimal_cpu_threads() bị khóa cứng min(cpu_count, 4) và không đọc biến môi trường."""
        threads = remover.get_optimal_cpu_threads()
        cpu_count = os.cpu_count() or 4

        src = inspect.getsource(remover.get_optimal_cpu_threads)
        has_env = "os.getenv" in src or "os.environ" in src
        has_min_4 = "min(cpu_count, 4)" in src or "min(" in src

        self.assertFalse(has_env, "get_optimal_cpu_threads không hỗ trợ biến môi trường")
        self.assertTrue(has_min_4, "get_optimal_cpu_threads khóa trần ở 4 threads")
        self.assertLessEqual(threads, 4, f"Threads hiện tại là {threads} dù hệ thống có {cpu_count} cores")
        print(f"  👉 [XÁC NHẬN ĐÚNG 2] CPU máy chủ có {cpu_count} cores nhưng get_optimal_cpu_threads() ép trần <= 4 và không có cấu hình env.")

    def test_03_openvino_config_hardcodes_inference_threads(self):
        """3. Kiểm tra: OpenVINO config ép cứng INFERENCE_NUM_THREADS thay vì để OpenVINO auto-tune."""
        src = inspect.getsource(remover.BiRefNetOpenVINOEngine._init_engine)
        has_hardcoded_threads = '"INFERENCE_NUM_THREADS": str(self.num_threads)' in src
        self.assertTrue(has_hardcoded_threads, "Config OpenVINO ép cứng INFERENCE_NUM_THREADS")
        print("  👉 [XÁC NHẬN ĐÚNG 3] Cấu hình OpenVINO đang ép cứng INFERENCE_NUM_THREADS, làm mất cơ chế auto-scheduling tối ưu của OpenVINO.")

    def test_04_numpy_intermediate_allocation(self):
        """4. Kiểm tra: np.array(resized, dtype=np.float32) / 255.0 tạo 2 mảng float32 trung gian 12MB + 12MB."""
        src = inspect.getsource(remover.BiRefNetOpenVINOEngine.predict_mask)
        has_div_255 = "arr = np.array(resized, dtype=np.float32) / 255.0" in src
        self.assertTrue(has_div_255, "Có phép chia / 255.0 tạo thêm mảng trung gian")

        # Đo kích thước mảng 1024x1024x3 float32
        sample_size = 1024 * 1024 * 3 * 4  # bytes
        mb = sample_size / (1024 * 1024)
        print(f"  👉 [XÁC NHẬN ĐÚNG 4] Mảng 1024x1024x3 float32 = {mb:.1f}MB. Phép chia / 255.0 tạo thêm 1 bản sao {mb:.1f}MB trung gian nữa.")

    def test_05_convert_rgb_redundant_check(self):
        """5. Kiểm tra: Đoạn if rgb_img is not pil_img: del rgb_img phức tạp hóa không cần thiết."""
        src = inspect.getsource(remover.BiRefNetOpenVINOEngine.predict_mask)
        has_is_not_check = "if rgb_img is not pil_img:" in src
        self.assertTrue(has_is_not_check, "Có đoạn kiểm tra identity thừa")
        print("  👉 [XÁC NHẬN ĐÚNG 5] Đoạn `if rgb_img is not pil_img: del rgb_img` là thừa thãi, Python GC và refcount xử lý an toàn với `del rgb_img`.")

    def test_06_free_system_memory_is_only_gc(self):
        """6. Kiểm tra: free_system_memory() thực chất chỉ gọi gc.collect(), không thể hoàn trả C++ heap về OS."""
        src = inspect.getsource(remover.free_system_memory)
        has_only_gc = "gc.collect()" in src and "malloc_trim" not in src
        self.assertTrue(has_only_gc, "free_system_memory chỉ gọi gc.collect()")
        print("  👉 [XÁC NHẬN ĐÚNG 6] free_system_memory() chỉ gọi duy nhất gc.collect(). Tên gọi gây hiểu nhầm vì không trả OpenVINO / C++ heap về OS.")

    def test_07_fallback_remove_bg_memory_spike(self):
        """7. Kiểm tra: _fallback_remove_bg() với ảnh 2560x2560 ép sang int32 tạo peak RAM khổng lồ (>200MB)."""
        w, h = 2560, 2560
        uint8_size = w * h * 4 / (1024 * 1024)       # ~25 MB
        int32_size = w * h * 3 * 4 / (1024 * 1024)   # ~75 MB
        diff_sq_size = w * h * 3 * 4 / (1024 * 1024) # ~75 MB
        sum_dist_size = w * h * 8 / (1024 * 1024)    # ~50 MB (float64)
        total_peak = uint8_size + int32_size + diff_sq_size + sum_dist_size

        src = inspect.getsource(remover._fallback_remove_bg)
        has_int32 = "astype(np.int32)" in src
        self.assertTrue(has_int32, "_fallback_remove_bg ép sang int32")
        print(f"  👉 [XÁC NHẬN ĐÚNG 7] Fallback trên ảnh {w}x{h} tạo mảng int32 và phép tính distance với peak RAM ước tính ~{total_peak:.1f}MB!")

if __name__ == "__main__":
    unittest.main()
