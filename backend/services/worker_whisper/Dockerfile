# ── Stage 1: Build whisper.cpp (AVX2 CPU optimization) ──
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

RUN mkdir -p /models && \
    curl -L -o /models/ggml-base.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin && \
    curl -L -o /models/ggml-small.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin

# ── Stage 2: Runtime Image ──
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libgomp1 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN pip install --no-cache-dir \
    fastapi>=0.115.0 \
    uvicorn[standard]>=0.32.0 \
    python-multipart>=0.0.12

# Copy whisper binaries & models
COPY --from=whisper-builder /whisper/build/bin/whisper-cli /usr/local/bin/whisper-cli
COPY --from=whisper-builder /models/ /app/models/whisper/

COPY services/worker_whisper/ /app/services/worker_whisper/

ENV PORT=8002
ENV DOWNLOAD_DIR=/app/downloads
ENV WHISPER_BIN=/usr/local/bin/whisper-cli
ENV WHISPER_MODEL_PATH=/app/models/whisper/ggml-small.bin
ENV PYTHONPATH=/app

EXPOSE 8002

CMD ["python3", "-m", "services.worker_whisper.main"]
