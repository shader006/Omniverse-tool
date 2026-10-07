FROM python:3.10-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -u 1000 -m appuser

WORKDIR /app

RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir \
    fastapi>=0.115.0 \
    uvicorn[standard]>=0.32.0 \
    python-multipart>=0.0.12 \
    pillow>=10.0.0 \
    numpy>=1.26.0 \
    onnxruntime>=1.18.0

COPY services/worker_upscaler/ /app/services/worker_upscaler/

RUN mkdir -p /app/downloads && \
    chown -R appuser:appuser /app /home/appuser

ENV PORT=8006
ENV DOWNLOAD_DIR=/app/downloads
ENV PYTHONPATH=/app

EXPOSE 8006

USER appuser

CMD ["python3", "-m", "services.worker_upscaler.main"]
