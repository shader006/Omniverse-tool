import os
import sys
import time
import subprocess
import json

TEST_CODE = '''
import os
import sys
import time
import gc
import io
import base64
import ctypes
import numpy as np
from PIL import Image, ImageDraw

def get_rss_mb():
    try:
        with open("/proc/self/status", "r") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    return round(int(line.split()[1]) / 1024, 2)
    except Exception:
        pass
    return 0.0

def safe_free_memory():
    gc.collect()
    # mimalloc purge
    try:
        cur = ctypes.CDLL(None)
        if hasattr(cur, "mi_collect"):
            cur.mi_collect(ctypes.c_bool(True))
            return
    except Exception:
        pass
    # jemalloc purge
    try:
        cur = ctypes.CDLL(None)
        if hasattr(cur, "mallctl"):
            cur.mallctl(b"arenas.purge", None, None, None, 0)
            return
    except Exception:
        pass
    # glibc malloc_trim
    try:
        if not os.getenv("LD_PRELOAD"):
            libc = ctypes.CDLL("libc.so.6")
            if hasattr(libc, "malloc_trim"):
                libc.malloc_trim(0)
    except Exception:
        pass

rss_start = get_rss_mb()

# 1. Warmup Model
from app.rmbg.remover import remove_background, get_birefnet_engine
engine = get_birefnet_engine()
safe_free_memory()
rss_warmed = get_rss_mb()

# 2. Tạo ảnh mẫu thực tế độ phân giải cao 4K (4000 x 3000)
img = Image.new("RGB", (4000, 3000), color=(135, 206, 235))
draw = ImageDraw.Draw(img)
draw.rectangle([500, 500, 3500, 2500], fill=(34, 139, 34))
draw.ellipse([1000, 800, 3000, 2200], fill=(255, 215, 0))

buf = io.BytesIO()
img.save(buf, format="JPEG", quality=90)
raw_bytes = buf.getvalue()
del img, draw, buf
safe_free_memory()

# 3. Chạy xử lý 3 lượt liên tục
peak_rss = 0.0
latencies = []

for i in range(3):
    t0 = time.perf_counter()
    out_img, meta = remove_background(image_input=raw_bytes, model_name="birefnet-lite", alpha_matting=False)
    
    # Giả lập worker lưu file và tạo base64 preview
    buf_out = io.BytesIO()
    out_img.save(buf_out, format="PNG", optimize=False)
    preview = out_img.copy()
    if preview.width > 1200:
        preview.thumbnail((1200, 1200), Image.Resampling.BILINEAR)
    p_buf = io.BytesIO()
    preview.save(p_buf, format="PNG", optimize=False)
    b64 = base64.b64encode(p_buf.getvalue()).decode("utf-8")
    
    t1 = time.perf_counter()
    latencies.append((t1 - t0) * 1000)
    
    current_rss = get_rss_mb()
    if current_rss > peak_rss:
        peak_rss = current_rss
        
    del out_img, buf_out, preview, p_buf, b64, meta
    safe_free_memory()

rss_post = get_rss_mb()

# Đợi 1.5s cho decay
time.sleep(1.5)
safe_free_memory()
rss_after_decay = get_rss_mb()

result = {
    "rss_start_mb": rss_start,
    "rss_warmed_mb": rss_warmed,
    "peak_rss_mb": peak_rss,
    "rss_post_mb": rss_post,
    "rss_after_decay_mb": rss_after_decay,
    "avg_latency_ms": round(sum(latencies) / len(latencies), 1),
    "engine_backend": engine.backend if engine else "unknown"
}
import json
print("__RESULT__" + json.dumps(result))
'''

CONFIGS = [
    {
        "name": "1. glibc (Default Linux)",
        "env": {},
        "desc": "Mặc định hệ điều hành Linux (glibc ptmalloc)"
    },
    {
        "name": "2. mimalloc (Microsoft)",
        "env": {
            "LD_PRELOAD": "/usr/lib/x86_64-linux-gnu/libmimalloc.so.2",
            "MIMALLOC_PURGE_DELAY": "0"
        },
        "desc": "Microsoft mimalloc v2 - Cực nhanh, giải phóng RAM tức thì, tương thích hoàn hảo OpenVINO"
    }
]

def run_benchmarks():
    print("=" * 85)
    print("🏆 BENCHMARK SO SÁNH TRÌNH CẤP PHÁT BỘ NHỚ CHO WORKER RMBG (4K IMAGE)")
    print("=" * 85)
    
    results = []
    
    for cfg in CONFIGS:
        print(f"\n👉 Đang thử nghiệm: {cfg['name']}...")
        env = os.environ.copy()
        env.update(cfg["env"])
        env["PYTHONPATH"] = "/app"
        env["BIREFNET_CACHE_DIR"] = "/root/.cache/birefnet"
        
        proc = subprocess.run(
            ["python3", "-c", TEST_CODE],
            env=env,
            capture_output=True,
            text=True
        )
        
        output = proc.stdout + "\n" + proc.stderr
        parsed = None
        for line in output.splitlines():
            if "__RESULT__" in line:
                parsed = json.loads(line.split("__RESULT__")[1])
                break
                
        if parsed:
            parsed["name"] = cfg["name"]
            parsed["desc"] = cfg["desc"]
            results.append(parsed)
            print(f"   ✓ Backend:       {parsed['engine_backend'].upper()}")
            print(f"   ✓ Warmup RAM:    {parsed['rss_warmed_mb']} MB")
            print(f"   ✓ Peak RAM (4K): {parsed['peak_rss_mb']} MB")
            print(f"   ✓ Sau khi xử lý: {parsed['rss_post_mb']} MB")
            print(f"   ✓ Sau 1.5s:      {parsed['rss_after_decay_mb']} MB")
            print(f"   ✓ Tốc độ xử lý:  {parsed['avg_latency_ms']} ms")
        else:
            print(f"   ❌ Lỗi benchmark {cfg['name']}:")
            print(output[:500])
            
    print("\n" + "=" * 85)
    print("📊 BẢNG TỔNG KẾT SO SÁNH:")
    print("=" * 85)
    header = f"{'Allocator':<26} | {'Warmup':<9} | {'Peak RAM':<10} | {'RAM Idle':<10} | {'Độ trễ':<10}"
    print(header)
    print("-" * len(header))
    for r in results:
        print(f"{r['name']:<26} | {r['rss_warmed_mb']:<6} MB | {r['peak_rss_mb']:<7} MB | {r['rss_after_decay_mb']:<7} MB | {r['avg_latency_ms']:<7} ms")
    print("=" * 85)

if __name__ == "__main__":
    run_benchmarks()
