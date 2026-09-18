# ── Stage 1: Build whisper.cpp with NVIDIA CUDA & CPU AVX2 ──
FROM nvidia/cuda:12.2.2-devel-ubuntu22.04 AS whisper-builder
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    git \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /whisper
# Build với CUDA Toolkit: Hỗ trợ kiến trúc Ampere (RTX 3090: arch 86), Hopper (90), Ada (89), A100 (80), Turing (75)
RUN git clone --depth 1 https://github.com/ggerganov/whisper.cpp.git . \
    && cmake -B build \
       -DGGML_CUDA=ON \
       -DCMAKE_CUDA_ARCHITECTURES="86;80;75;70" \
       -DBUILD_SHARED_LIBS=OFF \
       -DWHISPER_BUILD_EXAMPLES=ON \
    && cmake --build build --config Release -j$(nproc)

RUN mkdir -p /models && \
    curl -L -o /models/ggml-base.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin && \
    curl -L -o /models/ggml-small.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin

# ── Stage 2: Runtime Image (CUDA 12.2 Runtime) ──
FROM nvidia/cuda:12.2.2-runtime-ubuntu22.04

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-setuptools \
    ffmpeg \
    libgomp1 \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && ln -s /usr/bin/python3 /usr/local/bin/python \
    && useradd -u 1000 -m appuser

WORKDIR /app

RUN pip3 install --no-cache-dir --upgrade pip && \
    pip3 install --no-cache-dir \
    fastapi>=0.115.0 \
    uvicorn[standard]>=0.32.0 \
    python-multipart>=0.0.12

# Copy whisper binaries & models
COPY --from=whisper-builder /whisper/build/bin/whisper-cli /usr/local/bin/whisper-cli
COPY --from=whisper-builder /models/ /app/models/whisper/

COPY services/worker_whisper/ /app/services/worker_whisper/

RUN mkdir -p /app/downloads && chown -R appuser:appuser /app

ENV PORT=8002
ENV DOWNLOAD_DIR=/app/downloads
ENV WHISPER_BIN=/usr/local/bin/whisper-cli
ENV WHISPER_MODEL_PATH=/app/models/whisper/ggml-small.bin
ENV PYTHONPATH=/app
ENV NVIDIA_VISIBLE_DEVICES=all
ENV NVIDIA_DRIVER_CAPABILITIES=compute,utility

EXPOSE 8002

USER appuser

CMD ["python3", "-m", "services.worker_whisper.main"]

