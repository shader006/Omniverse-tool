#!/usr/bin/env bash
set -e

# ==============================================================================
# Omniverse Tool - WebAssembly Build Script
# Biên dịch Rust code sang .wasm và xuất thẳng vào frontend/client/wasm/
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="$SCRIPT_DIR/../frontend/client/wasm"

echo "========================================================"
echo "🚀 Bắt đầu quá trình build WebAssembly cho Omniverse..."
echo "📂 Thư mục nguồn: $SCRIPT_DIR"
echo "🎯 Thư mục xuất:   $OUTPUT_DIR"
echo "========================================================"

mkdir -p "$OUTPUT_DIR"

if command -v wasm-pack &> /dev/null; then
    echo "✅ Tìm thấy wasm-pack trên máy host! Đang build trực tiếp..."
    cd "$SCRIPT_DIR"
    wasm-pack build --target web --release --out-dir "$OUTPUT_DIR"
    echo "🎉 Build WebAssembly thành công bằng wasm-pack cục bộ!"
elif command -v docker &> /dev/null; then
    echo "⚠️  Không tìm thấy wasm-pack trên máy host."
    echo "🐳 Tự động chuyển sang build thông qua Docker container..."
    cd "$SCRIPT_DIR"
    docker build -t omniverse-wasm-builder .
    docker run --rm -v "$OUTPUT_DIR":/output omniverse-wasm-builder
    echo "🎉 Build WebAssembly thành công bằng Docker!"
else
    echo "❌ LỖI: Cần có 'wasm-pack' hoặc 'docker' để tiến hành build .wasm."
    echo "💡 Bạn có thể cài wasm-pack nhanh bằng lệnh:"
    echo "   curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh"
    exit 1
fi

# Dọn dẹp các file không cần thiết trong thư mục output web
rm -f "$OUTPUT_DIR/.gitignore"
rm -f "$OUTPUT_DIR/package.json"

echo "========================================================"
echo "✨ Hoàn tất! Các file đã sẵn sàng tại frontend/client/wasm:"
ls -lh "$OUTPUT_DIR"
echo "========================================================"
