# ── Stage 1: Build Golang Server ──
FROM golang:1.22-alpine AS go-builder
WORKDIR /build
COPY go.mod ./
COPY *.go ./
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o server .

# ── Stage 2: Runtime Image (Python 3.12 + FFmpeg + Deno + yt-dlp) ──
FROM python:3.12-slim

# Cài đặt ffmpeg, nodejs, curl, unzip, ca-certificates và Deno JS Runtime (giải mã YouTube & PO Token)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    nodejs \
    unzip \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL https://deno.land/install.sh | sh \
    && cp /root/.deno/bin/deno /usr/local/bin/deno

WORKDIR /app

# Cài đặt dependencies Python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy Golang compiled server binary
COPY --from=go-builder /build/server /app/server

# Copy mã nguồn Python url_conver
COPY app/ ./app/

# Tạo thư mục chứa file tải về và frontend
RUN mkdir -p /app/downloads /frontend

EXPOSE 8000

ENV PORT=8000
ENV DOWNLOAD_DIR=/app/downloads
ENV FRONTEND_DIR=/frontend
ENV PYTHONPATH=/app

CMD ["/app/server"]
