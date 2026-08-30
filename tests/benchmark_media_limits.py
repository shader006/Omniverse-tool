#!/usr/bin/env python3
"""
BENCHMARK & STRESS TESTING: GIỚI HẠN THỜI LƯỢNG & TẢI XỬ LÝ MEDIA (MP3/MP4/TRANSCRIBE)
Tác giả: Omniverse Tool Suite

Mục đích:
1. Đo lường tốc độ thực tế (Real-Time Factor - RTF) của whisper.cpp AI & FFmpeg trên phần cứng máy hiện tại.
2. Kiểm tra các mốc thời lượng (10s, 30s, 1m, 2m, 5m, 10m, 15m, 30m, ...) để xác định ngưỡng an toàn tránh Timeout.
3. Đo lường cơ chế giới hạn luồng đồng thời (mediaLimiter) khi nhiều người dùng cùng xử lý.
4. Đưa ra khuyến nghị tham số cấu hình tối ưu (Safe Max Duration, Concurrency Limit).
"""

import os
import sys
import io
import math
import struct
import wave
import time
import argparse
import concurrent.futures
from typing import List, Dict, Any, Tuple

try:
    import requests
except ImportError:
    print("❌ Lỗi: Chưa cài đặt thư viện 'requests'. Vui lòng chạy: pip install requests")
    sys.exit(1)

# Base URL Gateway hoặc Backend
BASE_URL = os.getenv("API_BASE_URL", "http://localhost:80")


def create_synthetic_wav_bytes(duration_sec: float, sample_rate: int = 16000, freq: float = 440.0) -> bytes:
    """Tạo audio WAV in-memory với thời lượng chính xác để benchmark."""
    buf = io.BytesIO()
    n_samples = int(duration_sec * sample_rate)
    with wave.open(buf, "wb") as wav_file:
        wav_file.setnchannels(1)  # Mono 16kHz
        wav_file.setsampwidth(2)   # 16-bit PCM
        wav_file.setframerate(sample_rate)
        
        # Sinh sóng âm sine wave cơ bản
        chunk_size = 8000
        samples_written = 0
        while samples_written < n_samples:
            current_chunk = min(chunk_size, n_samples - samples_written)
            raw_data = bytearray()
            for i in range(current_chunk):
                sample_idx = samples_written + i
                # Thêm chút biến âm để Whisper nhận diện giống giọng nói
                mod_freq = freq + 50.0 * math.sin(2.0 * math.pi * 2.0 * (sample_idx / sample_rate))
                val = int(math.sin(2.0 * math.pi * mod_freq * (sample_idx / sample_rate)) * 12000.0)
                raw_data.extend(struct.pack("<h", val))
            wav_file.writeframes(raw_data)
            samples_written += current_chunk

    buf.seek(0)
    return buf.read()


def format_duration(seconds: float) -> str:
    """Format thời lượng giây thành chuỗi dễ đọc."""
    if seconds < 60:
        return f"{seconds:.0f}s"
    mins = int(seconds // 60)
    secs = int(seconds % 60)
    if secs == 0:
        return f"{mins}m"
    return f"{mins}m {secs}s"


def test_single_transcribe(duration_sec: float, timeout_sec: float = 180.0, language: str = "vi") -> Dict[str, Any]:
    """Thực hiện 1 bài test gửi file audio lên /api/transcribe và đo thời gian phản hồi."""
    t_start_gen = time.perf_counter()
    wav_bytes = create_synthetic_wav_bytes(duration_sec=duration_sec)
    gen_time = time.perf_counter() - t_start_gen
    payload_size_mb = len(wav_bytes) / (1024 * 1024)

    files = {
        "file": (f"bench_{int(duration_sec)}s.wav", wav_bytes, "audio/wav")
    }
    data = {
        "language": language,
        "format": "json",
        "task": "transcribe"
    }

    t_start_req = time.perf_counter()
    status_code = 0
    error_msg = ""
    success = False
    server_reported_time = 0.0

    try:
        res = requests.post(f"{BASE_URL}/api/transcribe", files=files, data=data, timeout=timeout_sec)
        req_duration = time.perf_counter() - t_start_req
        status_code = res.status_code

        if res.status_code == 200:
            res_json = res.json()
            success = res_json.get("success", False)
            server_reported_time = res_json.get("processing_time", 0.0)
            if not success:
                error_msg = res_json.get("detail", res_json.get("error", "Unknown server error"))
        else:
            try:
                res_json = res.json()
                error_msg = res_json.get("detail", res.text[:100])
            except Exception:
                error_msg = res.text[:100]
    except requests.exceptions.Timeout:
        req_duration = time.perf_counter() - t_start_req
        error_msg = f"TIMEOUT (Vượt quá {timeout_sec}s)"
        status_code = 408
    except Exception as e:
        req_duration = time.perf_counter() - t_start_req
        error_msg = str(e)
        status_code = 500

    rtf = (req_duration / duration_sec) if duration_sec > 0 else 0.0

    return {
        "duration_sec": duration_sec,
        "payload_size_mb": payload_size_mb,
        "req_duration": req_duration,
        "server_reported_time": server_reported_time,
        "rtf": rtf,
        "status_code": status_code,
        "success": success,
        "error_msg": error_msg
    }


def run_duration_scaling_benchmark(durations: List[float], timeout_sec: float) -> List[Dict[str, Any]]:
    """Chạy benchmark tăng dần độ dài file audio."""
    print("\n" + "=" * 80)
    print(" 🚀 PHẦN 1: BENCHMARK TĂNG DẦN THỜI LƯỢNG AUDIO (SCALING BENCHMARK)")
    print("=" * 80)
    print(f"[*] Mục tiêu Gateway: {BASE_URL}")
    print(f"[*] Timeout giới hạn cho mỗi request: {timeout_sec}s")
    print(f"[*] Danh sách các mốc thời lượng kiểm tra: {[format_duration(d) for d in durations]}\n")

    results = []
    print(f"{'Thời lượng':<12} | {'Payload':<10} | {'Thời gian chạy':<16} | {'Tỉ lệ RTF':<12} | {'Trạng thái':<14} | {'Ghi chú'}")
    print("-" * 80)

    for dur in durations:
        res = test_single_transcribe(dur, timeout_sec=timeout_sec)
        results.append(res)

        dur_str = format_duration(dur)
        size_str = f"{res['payload_size_mb']:.2f} MB"
        time_str = f"{res['req_duration']:.2f}s"
        rtf_str = f"{res['rtf']:.3f}x" if res['success'] else "N/A"

        if res['success']:
            status_str = "✅ PASS (200)"
            note = f"Whisper core: {res['server_reported_time']:.1f}s"
        elif res['status_code'] == 408:
            status_str = "⏱️ TIMEOUT"
            note = res['error_msg']
        else:
            status_str = f"❌ LỖI ({res['status_code']})"
            note = res['error_msg'][:30]

        print(f"{dur_str:<12} | {size_str:<10} | {time_str:<16} | {rtf_str:<12} | {status_str:<14} | {note}")

    return results


def run_concurrency_stress_test(duration_sec: float, concurrency_levels: List[int], timeout_sec: float):
    """Kiểm tra phản ứng của hệ thống khi có nhiều request đồng thời gửi file dài."""
    print("\n" + "=" * 80)
    print(" ⚡ PHẦN 2: STRESS TEST TẢI ĐỒNG THỜI (CONCURRENCY & WORKER QUEUE)")
    print("=" * 80)
    print(f"[*] Thử nghiệm với file audio mẫu: {format_duration(duration_sec)}")
    print(f"[*] Các mức tải đồng thời: {concurrency_levels}\n")

    print(f"{'Số User đồng thời':<20} | {'Tổng thời gian':<16} | {'Avg Latency/User':<18} | {'Thành công':<12} | {'Đánh giá nghẽn'}")
    print("-" * 80)

    for conc in concurrency_levels:
        t_start = time.perf_counter()
        with concurrent.futures.ThreadPoolExecutor(max_workers=conc) as executor:
            futures = [executor.submit(test_single_transcribe, duration_sec, timeout_sec) for _ in range(conc)]
            task_results = [f.result() for f in concurrent.futures.as_completed(futures)]
        
        total_wall_time = time.perf_counter() - t_start
        success_count = sum(1 for r in task_results if r['success'])
        avg_latency = sum(r['req_duration'] for r in task_results) / len(task_results)

        bottleneck_note = "Bình thường"
        if total_wall_time > (avg_latency * 1.5):
            bottleneck_note = "⚠️ Bị xếp hàng chờ (Queue)"

        print(f"{conc:<20} | {total_wall_time:<16.2f}s | {avg_latency:<18.2f}s | {f'{success_count}/{conc}':<12} | {bottleneck_note}")


def analyze_and_print_recommendations(results: List[Dict[str, Any]], standard_http_timeouts: List[int] = [60, 120, 300]):
    """Phân tích kết quả và xuất báo cáo khuyến nghị giới hạn tối ưu."""
    successful_results = [r for r in results if r['success'] and r['rtf'] > 0]
    if not successful_results:
        print("\n❌ Không có bài test nào thành công để đưa ra phân tích.")
        return

    avg_rtf = sum(r['rtf'] for r in successful_results) / len(successful_results)
    
    print("\n" + "=" * 80)
    print(" 📊 KẾT QUẢ PHÂN TÍCH & KHUYẾN NGHỊ GIỚI HẠN CHO HỆ THỐNG")
    print("=" * 80)
    print(f"🔹 Hệ số xử lý trung bình (RTF): {avg_rtf:.3f}x")
    print(f"   (Giải thích: 1 phút audio cần khoảng {avg_rtf * 60:.1f} giây để Whisper AI xử lý trên CPU này)\n")

    print("📌 NGƯỠNG THỜI LƯỢNG AN TOÀN TỐI ĐA TRÁNH TIMEOUT TRÌNH DUYỆT:")
    print("-" * 80)
    for t_out in standard_http_timeouts:
        safe_duration_sec = (t_out * 0.75) / avg_rtf  # Hệ số an toàn 75%
        safe_dur_formatted = format_duration(safe_duration_sec)
        print(f"  • Nếu HTTP Timeout = {t_out}s (mặc định Gateway/Nginx/Pingora):")
        print(f"    👉 Giới hạn audio/video Transcribe tối đa: ~{safe_dur_formatted} (an toàn nhất)")

    print("\n💡 KHUYẾN NGHỊ CẤU HÌNH PRODUCTION ĐỀ XUẤT:")
    print("  1. Cấu hình Transcribe (Whisper AI):")
    print(f"     - Đặt giới hạn thời lượng: MAX_TRANSCRIBE_DURATION = {format_duration((60 * 0.75) / avg_rtf)}")
    print("     - Giới hạn kích thước file upload: 50 MB - 100 MB")
    print("  2. Cấu hình Tải URL (YouTube/TikTok - yt-dlp + FFmpeg):")
    print("     - Đặt giới hạn thời lượng video tải về: 30 - 45 phút")
    print("  3. Trải nghiệm người dùng (UX):")
    print("     - Với các file dài hơn 5 phút, nên hỗ trợ hiển thị Progress SSE hoặc trả về Job ID chạy nền thay vì Sync HTTP.")
    print("=" * 80 + "\n")


def check_gateway_health():
    """Kiểm tra Gateway có đang chạy không."""
    try:
        res = requests.get(f"{BASE_URL}/health", timeout=3)
        if res.status_code == 200:
            return True
    except Exception:
        pass
    return False


def main():
    global BASE_URL
    parser = argparse.ArgumentParser(description="Media Flow Limit & Performance Benchmark")
    parser.add_argument("--url", default=BASE_URL, help="Base URL của dịch vụ (mặc định: http://localhost:80)")
    parser.add_argument("--quick", action="store_true", help="Chạy nhanh với các mốc thời lượng ngắn (10s, 30s, 60s)")
    parser.add_argument("--full", action="store_true", help="Chạy đầy đủ cả mốc dài (10s -> 5 phút)")
    parser.add_argument("--timeout", type=float, default=120.0, help="Timeout cho mỗi request (giây)")
    parser.add_argument("--concurrency", action="store_true", help="Chạy thêm stress test nhiều luồng đồng thời")
    args = parser.parse_args()

    BASE_URL = args.url.rstrip("/")

    print("=" * 80)
    print("   OMNIVERSE MEDIA PROCESSING LIMITS BENCHMARK TOOL")
    print("=" * 80)

    if not check_gateway_health():
        print(f"⚠️ Cảnh báo: Không thể kết nối tới Gateway tại {BASE_URL}/health!")
        print("   Hãy đảm bảo bạn đã khởi động hệ thống bằng `./start.sh` hoặc Docker stack.")
        choice = input("   Bạn có muốn tiếp tục thử kết nối không? (y/N): ").strip().lower()
        if choice != 'y':
            sys.exit(1)

    if args.quick:
        test_durations = [10.0, 30.0, 60.0]
    elif args.full:
        test_durations = [10.0, 30.0, 60.0, 120.0, 300.0]
    else:
        test_durations = [10.0, 30.0, 60.0, 120.0]

    # 1. Chạy bài test tăng dần độ dài
    results = run_duration_scaling_benchmark(test_durations, timeout_sec=args.timeout)

    # 2. Chạy bài test đồng thời nếu được yêu cầu
    if args.concurrency:
        run_concurrency_stress_test(duration_sec=30.0, concurrency_levels=[1, 2, 4], timeout_sec=args.timeout)

    # 3. Phân tích kết quả và in ra khuyến nghị
    analyze_and_print_recommendations(results)


if __name__ == "__main__":
    main()
