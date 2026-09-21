#!/usr/bin/env bash
# Khởi động Worker Whisper trên GPU NVIDIA CUDA (RTX 3090)
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Tự động nạp file .env từ thư mục gốc một cách an toàn (hỗ trợ đường dẫn có khoảng trắng)
if [ -f "$PROJECT_DIR/.env" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
        [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
        if [[ "$line" =~ ^[[:space:]]*([a-zA-Z_][a-zA-Z0-9_]*)[[:space:]]*=(.*)$ ]]; then
            key="${BASH_REMATCH[1]}"
            val="${BASH_REMATCH[2]}"
            val="${val#"${val%%[![:space:]]*}"}"
            val="${val%"${val##*[![:space:]]}"}"
            if [[ "$val" =~ ^\"(.*)\"$ ]] || [[ "$val" =~ ^\'(.*)\'$ ]]; then
                val="${BASH_REMATCH[1]}"
            fi
            export "$key=$val"
        fi
    done < "$PROJECT_DIR/.env"
fi

# Tự động kích hoạt môi trường Conda
CONDA_ENV="${CONDA_ENV_NAME:-omniverse}"
if [ -f "/opt/tljh/user/etc/profile.d/conda.sh" ]; then
    source "/opt/tljh/user/etc/profile.d/conda.sh"
    conda activate "$CONDA_ENV" 2>/dev/null || true
elif command -v conda >/dev/null 2>&1; then
    eval "$(conda shell.bash hook)"
    conda activate "$CONDA_ENV" 2>/dev/null || true
fi

# Thiết lập các biến môi trường
export PYTHONPATH="$PROJECT_DIR/backend"
export DOWNLOAD_DIR="${DOWNLOAD_DIR:-$PROJECT_DIR/downloads}"
export WHISPER_BIN="${WHISPER_BIN:-$HOME/whisper.cpp/build/bin/whisper-cli}"
export WHISPER_MODEL_PATH="${WHISPER_MODEL_PATH:-$HOME/whisper.cpp/models/ggml-small.bin}"
export PORT="${WORKER_WHISPER_PORT:-${PORT:-8002}}"

cd "$PROJECT_DIR/backend"
while true; do
    echo "=========================================================="
    echo "🚀 Khởi động Worker Whisper (GPU CUDA)"
    echo "   Binary: $WHISPER_BIN"
    echo "   Model:  $WHISPER_MODEL_PATH"
    echo "   Port:   $PORT"
    echo "=========================================================="
    python -m services.worker_whisper.main || true
    echo "⚠️ Tiến trình Worker Whisper đã dừng. Tự động khởi động lại sau 2 giây..."
    sleep 2
done
