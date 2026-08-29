# ── Stage 1: Build Golang Server ──
FROM golang:1.22-alpine AS go-builder
WORKDIR /build
COPY go.mod ./
COPY transcribe/ ./transcribe/
COPY *.go ./
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o server .

# ── Stage 2: Build whisper.cpp (AVX2 CPU optimization) ──
FROM debian:bookworm-slim AS whisper-builder
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    git \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /whisper
RUN git clone --depth 1 https://github.com/ggerganov/whisper.cpp.git . \
    && cmake -B build -DGGML_AVX2=ON -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_EXAMPLES=ON \
    && cmake --build build --config Release -j$(nproc)

# Tải trước model GGML Base vào thư mục
RUN mkdir -p /models && \
    curl -L -o /models/ggml-base.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin

# ── Stage 3: Runtime Image (Python 3.12 + FFmpeg + Deno + yt-dlp + Go whisper.cpp) ──
FROM python:3.12-slim

# Cài đặt ffmpeg, nodejs, curl, unzip, ca-certificates, libgomp1 và Deno JS Runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    nodejs \
    unzip \
    ca-certificates \
    curl \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL https://deno.land/install.sh | sh \
    && cp /root/.deno/bin/deno /usr/local/bin/deno

WORKDIR /app

# Cài đặt dependencies Python (chỉ còn yt-dlp nhẹ)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy Golang compiled server binary
COPY --from=go-builder /build/server /app/server

# Copy whisper.cpp binary & preloaded model
RUN mkdir -p /app/models/whisper
COPY --from=whisper-builder /whisper/build/bin/whisper-cli /usr/local/bin/whisper-cli
COPY --from=whisper-builder /whisper/build/ /whisper-build/
RUN find /whisper-build -name "*.so*" -exec cp {} /usr/local/lib/ \; 2>/dev/null || true && ldconfig && rm -rf /whisper-build
COPY --from=whisper-builder /models/ggml-base.bin /app/models/whisper/ggml-base.bin

# Copy mã nguồn Python url_conver
COPY app/ ./app/

# Tạo thư mục chứa file tải về và frontend
RUN mkdir -p /app/downloads /frontend /app/models/whisper

EXPOSE 8000

ENV PORT=8000
ENV DOWNLOAD_DIR=/app/downloads
ENV FRONTEND_DIR=/frontend
ENV PYTHONPATH=/app
ENV WHISPER_BIN=/usr/local/bin/whisper-cli
ENV WHISPER_MODEL_PATH=/app/models/whisper/ggml-base.bin

CMD ["/app/server"]
