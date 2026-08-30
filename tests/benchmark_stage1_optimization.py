#!/usr/bin/env python3
import os
import sys
import time
import wave
import math
import struct
import subprocess

def generate_test_audio(duration_sec=160, sample_rate=16000, out_path='/tmp/bench_160s.wav'):
    """Tạo file audio tổng hợp 2 phút 40 giây (160s)"""
    num_samples = int(duration_sec * sample_rate)
    with wave.open(out_path, 'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        frames = bytearray()
        for i in range(num_samples):
            t = i / sample_rate
            # Mô phỏng sóng âm thanh tiếng nói + nhạc nền
            sample_val = int(
                (math.sin(2 * math.pi * 220 * t) * 0.4 +
                 math.sin(2 * math.pi * 440 * t) * 0.3 +
                 math.sin(2 * math.pi * 880 * t) * 0.2 +
                 math.sin(2 * math.pi * 1760 * t) * 0.1) * 15000.0
            )
            frames.extend(struct.pack('<h', max(-32768, min(32767, sample_val))))
        wav.writeframes(frames)
    return out_path

def main():
    print("=" * 70)
    print("   BENCHMARK TỐI ƯU GIAI ĐOẠN 1: AUDIO 2 PHÚT 40 GIÂY (160s)")
    print("=" * 70)

    # 1. Tìm container
    cid = subprocess.run(['docker', 'ps', '-q', '-f', 'name=omniverse_app'], stdout=subprocess.PIPE, text=True).stdout.strip().split()
    if not cid:
        print("[!] Không tìm thấy container omniverse_app đang chạy!")
        sys.exit(1)
    target_cid = cid[0]
    print(f"[*] Target Container ID: {target_cid}")

    # 2. Tạo audio 160s (2m40s) và copy vào container
    audio_path = "/tmp/bench_160s.wav"
    print(f"[*] Đang tạo audio thử nghiệm thời lượng 2 phút 40 giây (160s)...")
    generate_test_audio(160, 16000, audio_path)
    subprocess.run(['docker', 'cp', audio_path, f"{target_cid}:{audio_path}"], check=True)
    print(f"[*] Đã nạp file {audio_path} vào container thành công.\n")

    # 3. Benchmark Config Gốc (4 threads, default settings)
    print("[+] 1. Đang chạy đo CẤU HÌNH GỐC (4 Threads, Default Whisper)...")
    cmd_baseline = [
        'docker', 'exec', target_cid, 'whisper-cli',
        '-m', '/app/models/whisper/ggml-small.bin',
        '-f', audio_path,
        '-t', '4',
        '-l', 'en',
        '--output-json',
        '-of', '/tmp/out_baseline'
    ]
    t0 = time.perf_counter()
    p_base = subprocess.run(cmd_baseline, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    dur_baseline = round(time.perf_counter() - t0, 2)
    rtf_baseline = round(dur_baseline / 160.0, 3)
    speed_baseline = round(160.0 / dur_baseline, 1)
    print(f"   => Thời gian: {dur_baseline}s | RTF: {rtf_baseline}x (Nhanh gấp {speed_baseline}x realtime)")

    # 4. Benchmark Config Giai đoạn 1 (8 threads, beam-size 2, temp 0, no-fallback, flash-attn)
    print("\n[+] 2. Đang chạy đo CẤU HÌNH TỐI ƯU GIAI ĐOẠN 1 (8 Threads, Flash-Attn, No-Fallback, Beam 2)...")
    cmd_opt = [
        'docker', 'exec', target_cid, 'whisper-cli',
        '-m', '/app/models/whisper/ggml-small.bin',
        '-f', audio_path,
        '-t', '8',
        '--beam-size', '2',
        '--temperature', '0.0',
        '--no-fallback',
        '--flash-attn',
        '-l', 'en',
        '--output-json',
        '-of', '/tmp/out_opt'
    ]
    t0 = time.perf_counter()
    p_opt = subprocess.run(cmd_opt, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    dur_opt = round(time.perf_counter() - t0, 2)
    rtf_opt = round(dur_opt / 160.0, 3)
    speed_opt = round(160.0 / dur_opt, 1)
    print(f"   => Thời gian: {dur_opt}s | RTF: {rtf_opt}x (Nhanh gấp {speed_opt}x realtime)")

    # 5. So sánh kết quả
    speedup_percent = round(((dur_baseline - dur_opt) / dur_baseline) * 100, 1)
    factor = round(dur_baseline / dur_opt, 2)

    print("\n" + "=" * 70)
    print("                    KẾT QUẢ SO SÁNH HIỆU NĂNG")
    print("=" * 70)
    print(f"Thời lượng audio test : 2 phút 40 giây (160 giây)")
    print(f"Cấu hình gốc (4T)     : {dur_baseline} giây  (RTF: {rtf_baseline}x, {speed_baseline}x realtime)")
    print(f"Cấu hình tối ưu GĐ1   : {dur_opt} giây  (RTF: {rtf_opt}x, {speed_opt}x realtime)")
    print("-" * 70)
    print(f"🎉 TỐC ĐỘ TĂNG TRƯỞNG : Nhanh hơn {speedup_percent}% (Gấp {factor}x lần)")
    print(f"⏱️ THỜI GIAN TIẾT KIỆM: Giảm được {round(dur_baseline - dur_opt, 2)} giây cho bài hát 2m40s")
    print("=" * 70)

if __name__ == "__main__":
    main()
