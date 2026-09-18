FROM nvidia/cuda:12.2.2-cudnn8-runtime-ubuntu22.04

# Cài đặt Python 3, pip và các thư viện hệ thống cần thiết
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-setuptools \
    libgomp1 \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && ln -s /usr/bin/python3 /usr/local/bin/python \
    && useradd -u 1000 -m appuser

WORKDIR /app

# Cài đặt onnxruntime-gpu (hỗ trợ cả CUDA và CPUExecutionProvider) cùng OpenVINO CPU fallback
RUN pip3 install --no-cache-dir --upgrade pip && \
    pip3 install --no-cache-dir \
    fastapi>=0.115.0 \
    uvicorn[standard]>=0.32.0 \
    python-multipart>=0.0.12 \
    pillow>=10.0.0 \
    numpy>=1.26.0 \
    openvino>=2024.4.0 \
    onnxruntime-gpu>=1.18.0 \
    huggingface_hub>=0.23.0

COPY app_python/ /app/app/
COPY services/worker_rmbg/ /app/services/worker_rmbg/

RUN mkdir -p /app/downloads /home/appuser/.cache/birefnet && \
    chown -R appuser:appuser /app /home/appuser

ENV PORT=8003
ENV DOWNLOAD_DIR=/app/downloads
ENV PYTHONPATH=/app
ENV BIREFNET_CACHE_DIR=/home/appuser/.cache/birefnet
ENV NVIDIA_VISIBLE_DEVICES=all
ENV NVIDIA_DRIVER_CAPABILITIES=compute,utility

EXPOSE 8003

USER appuser

CMD ["python3", "-m", "services.worker_rmbg.main"]

