# 🦀 Omniverse WebAssembly Engine (`wasm/`)

Thư mục này là trung tâm phát triển và biên dịch **WebAssembly (WASM)** bằng **Rust** cho toàn bộ ứng dụng web Omniverse Tool.

---

## 🎯 Mục đích & Lợi ích
1. **Bảo mật mã nguồn tuyệt đối:** Toàn bộ thuật toán nhận diện lưới, xử lý pixel art, lọc nhiễu được biên dịch thành mã máy nhị phân (`.wasm`). Người dùng mở `F12` chỉ thấy file binary, không thể xem hay sao chép code gốc.
2. **Hiệu năng Native (Tốc độ C/Rust):** Chạy nhanh gấp 3–5 lần JavaScript, xử lý ảnh lớn 4K/2K mượt mà mà không giật lag trình duyệt.
3. **Gom nhiều thuật toán vào 1 file duy nhất:** Bạn có thể viết 10, 20 hay 50 thuật toán trong thư mục này, tất cả đều được đóng gói thành **1 file `.wasm` duy nhất** (~100KB – 200KB).

---

## 📁 Cấu trúc thư mục

```text
wasm/
├── Cargo.toml          # Khai báo thư viện Rust & cấu hình tối ưu kích thước file WASM
├── Dockerfile          # Môi trường build containerized độc lập (không cần cài Rust trên máy)
├── build.sh            # Script 1-click tự động build và copy file sang frontend
├── README.md           # Hướng dẫn sử dụng
└── src/
    ├── lib.rs          # Entry point xuất các hàm ra cho JavaScript gọi (#[wasm_bindgen])
    └── grid_detect.rs  # Thuật toán nhận diện lưới (Alpha-aware, Runs GCD, Periodicity)
```

---

## 🚀 Cách Build ra file `.wasm`

Chỉ cần chạy file script:

```bash
cd "/home/shader/code_project/Omniverse tool/wasm"
./build.sh
```

Script sẽ tự động:
* **Ưu tiên 1:** Sử dụng `wasm-pack` nếu máy bạn đã cài sẵn Rust.
* **Ưu tiên 2:** Tự động gọi **Docker** để build ngầm nếu máy bạn chưa cài Rust.
* File kết quả sẽ được tự động xuất thẳng vào thư mục:
  `frontend/client/wasm/` gồm:
  - `pixel_wasm_bg.wasm` (file nhị phân chứa thuật toán)
  - `pixel_wasm.js` (file cầu nối JS loader)

*(Tùy chọn: Nếu muốn cài `wasm-pack` trực tiếp lên máy: `curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh`)*

---

## 💻 Cách sử dụng trong Frontend (`pixel-client.js`)

Trong JavaScript, bạn chỉ cần nạp (load) 1 lần khi mở ứng dụng:

```javascript
// 1. Import hàm từ module WASM đã build
import init, { detect_grid_candidates, detect_best_grid_size } from './wasm/pixel_wasm.js';

// 2. Khởi tạo WASM
await init();

// 3. Gọi thuật toán trực tiếp từ dữ liệu ảnh Canvas (ImageData)
const imgData = ctx.getImageData(0, 0, width, height);

// Cách A: Lấy danh sách các ứng viên lưới kèm % tin cậy
const candidates = detect_grid_candidates(imgData.data, width, height);
console.log("Danh sách lưới:", candidates);
// Kết quả trả về: [{ size: 4, confidence: 95 }, { size: 8, confidence: 60 }, ...]

// Cách B: Lấy ngay kích thước lưới tốt nhất
const bestSize = detect_best_grid_size(imgData.data, width, height);
console.log("Lưới tối ưu nhất:", bestSize);
```

---

## ➕ Cách thêm thuật toán mới vào cùng file `.wasm`

Bạn muốn thêm thuật toán mới? Rất đơn giản:
1. Tạo file mới trong `src/` (ví dụ `src/autocorr.rs` hoặc `src/dither.rs`).
2. Khai báo hàm với thẻ `#[wasm_bindgen]` trong `src/lib.rs`:
   ```rust
   #[wasm_bindgen]
   pub fn my_new_algorithm(data: &[u8], param: u32) -> u32 {
       // Code thuật toán của bạn
   }
   ```
3. Chạy lại `./build.sh`. Tất cả thuật toán cũ và mới sẽ tự động được gộp chung vào 1 file `.wasm` duy nhất!
