FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN pip install --no-cache-dir \
    fastapi>=0.115.0 \
    uvicorn[standard]>=0.32.0 \
    python-multipart>=0.0.12 \
    pillow>=10.0.0 \
    numpy>=1.26.0 \
    rembg>=2.0.50 \
    onnxruntime>=1.18.0

COPY app/ /app/app/
COPY services/worker_rmbg/ /app/services/worker_rmbg/

ENV PORT=8003
ENV DOWNLOAD_DIR=/app/downloads
ENV PYTHONPATH=/app

EXPOSE 8003

CMD ["python3", "-m", "services.worker_rmbg.main"]
