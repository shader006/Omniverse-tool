FROM python:3.10-slim

# Cài đặt các thư viện hệ thống cần thiết cho OpenVINO / CPU
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -u 1000 -m appuser

WORKDIR /app

# Cài đặt OpenVINO và ONNX Runtime tối ưu cho CPU Intel AVX / Iris Xe
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir \
    fastapi>=0.115.0 \
    uvicorn[standard]>=0.32.0 \
    python-multipart>=0.0.12 \
    pillow>=10.0.0 \
    numpy>=1.26.0 \
    openvino>=2024.4.0 \
    onnxruntime>=1.18.0 \
    huggingface_hub>=0.23.0

COPY app_python/ /app/app/
COPY services/worker_rmbg/ /app/services/worker_rmbg/

RUN mkdir -p /app/downloads /home/appuser/.cache/birefnet && \
    chown -R appuser:appuser /app /home/appuser

ENV PORT=8003
ENV DOWNLOAD_DIR=/app/downloads
ENV PYTHONPATH=/app
ENV BIREFNET_CACHE_DIR=/home/appuser/.cache/birefnet

EXPOSE 8003

USER appuser

CMD ["python3", "-m", "services.worker_rmbg.main"]

