# Benchmark & Test Suite cho PixelFixer

Thư mục này cung cấp bộ dataset benchmark và các kịch bản kiểm thử đo lường độ chính xác, độ trễ và khả năng khôi phục pixel art của service `worker_pixelfixer`.

---

## 1. Cấu trúc thư mục

```
tests/test_pixelfixer/
├── dataset/
│   ├── manifest.json            # Ground-truth metadata (size gốc, size biến dạng, category)
│   ├── native_1x/               # 25 ảnh pixel art nguyên bản (Ground Truth 1x)
│   ├── real_samples/            # 6 ảnh thực tế chất lượng cao (dragon, frog, koi-pond, ...)
│   └── distorted/               # 125 ảnh biến dạng nhân tạo phục vụ benchmark
├── run_pixelfixer_tests.py      # Runner tổng hợp thực thi 5 nhóm kiểm thử
├── test_01_core_functional.py   # Nhóm 1: Chức năng cốt lõi & Tái tạo lưới
├── test_02_error_and_edge_cases.py # Nhóm 2: Xử lý ngoại lệ & Lỗi biên
├── test_03_protocols_and_streaming.py # Nhóm 3: Giao thức truyền tải & Headers
├── test_04_optimizations_and_concurrency.py # Nhóm 4: Tối ưu hóa & Đa luồng Rayon
├── test_05_security_and_validation.py # Nhóm 5: An toàn bảo mật & Validation
└── README.md
```

Ngoài ra, mã nguồn bộ công cụ benchmark chuẩn quốc tế của Retro Diffusion được lưu tại:
- `git_pixel/pixel-bench/`

---

## 2. Các danh mục suy hao (Distortion Categories) trong Dataset

Bộ dataset bao gồm **125 mẫu kiểm thử** trải rộng trên 5 danh mục suy hao thường gặp trong thực tế:

1. **`clean_nn_3x`**: Phóng to Nearest-Neighbor 3x chuẩn.
2. **`clean_nn_4x`**: Phóng to Nearest-Neighbor 4x chuẩn.
3. **`fractional_2_5x`**: Phóng to tỉ lệ không nguyên 2.5x bằng nội suy song tuyến (Bilinear), làm nhòe viền và lệch lưới pixel.
4. **`blur_bicubic`**: Phóng to Bicubic 3x kết hợp Gaussian Blur (mô phỏng ảnh pixel art bị làm mờ bởi app vẽ hoặc web view).
5. **`jpeg_q45`**: Nén JPEG chất lượng thấp Q=45 (gây nhiễu khối và artifact viền màu).
6. **`real_samples`**: Bộ ảnh pixel art thực tế dung lượng lớn từ 1.3MB - 2.5MB để đo đạc thời gian tái tạo (`/fix`) và bộ nhớ.

---

## 3. Hướng dẫn chạy kiểm thử và Benchmark

### 3.1. Chạy Bộ Kiểm Thử 5 Nhóm (Chuẩn hóa tương tự URL và Transcribe)

Mô-đun PixelFixer được tổ chức thành 5 nhóm kiểm thử độc lập:
1. **`test_01_core_functional.py`**: Chức năng cốt lõi (Health, Detect Grid Fast/Full, Auto Reconstruct, Manual Cols/Rows, SOTA vs Original, Auto Palette).
2. **`test_02_error_and_edge_cases.py`**: Xử lý ngoại lệ, dữ liệu lỗi biên (Missing file, Corrupt data, Method 405, Boundary sizes).
3. **`test_03_protocols_and_streaming.py`**: Giao thức truyền tải, MIME Type `image/png`, Headers Rust Engine (`X-Grid-Cols`, `X-Download-Url`), OpenTelemetry Traceparent.
4. **`test_04_optimizations_and_concurrency.py`**: Đa luồng Rayon đồng thời (`/detect` & `/fix`), tính nhất quán FNV-1a Hash, Benchmark Fast vs Full mode, Burst load.
5. **`test_05_security_and_validation.py`**: An toàn bảo mật (Chặn file thực thi `.exe`, `.sh`, Chống Path Traversal, Chặn MIME Spoofing, Ngăn rò rỉ Stacktrace).

```bash
# Chạy toàn bộ 5 nhóm kiểm thử PixelFixer
python3 tests/test_pixelfixer/run_pixelfixer_tests.py

# Hoặc chạy riêng 1 nhóm cụ thể (ví dụ nhóm 1 hoặc nhóm 5)
python3 tests/test_pixelfixer/run_pixelfixer_tests.py --group 1
python3 tests/test_pixelfixer/run_pixelfixer_tests.py --group 5

# Chạy thông qua Test Runner tổng thể của dự án
python3 tests/run_tests.py --pixelfixer
```

### 3.2. Chạy Benchmark hiệu năng & độ chính xác

```bash
# Chạy toàn bộ 125 mẫu với chế độ fast
python3 tests/test_pixelfixer/benchmark_pixelfixer.py

# Hoặc chạy thử nghiệm nhanh 20 mẫu
python3 tests/test_pixelfixer/benchmark_pixelfixer.py --limit 20

# Chạy với chế độ full consensus (chính xác tối đa)
python3 tests/test_pixelfixer/benchmark_pixelfixer.py --mode full

# Chỉ định URL nếu chạy trong docker container khác
python3 tests/test_pixelfixer/benchmark_pixelfixer.py --url http://localhost:8004
```

### 3.3. Các chỉ số được đo lường
* **Exact %**: Tỉ lệ phát hiện đúng 100% kích thước pixel gốc `(cols x rows)`.
* **±1PX %**: Tỉ lệ tìm đúng kích thước trong phạm vi sai số 1 pixel.
* **Latency (Avg / P95 ms)**: Thời gian xử lý thuật toán tính bằng mili-giây.
* **Throughput**: Khả năng xử lý ảnh kích thước lớn ở bước tái dựng `/fix`.
