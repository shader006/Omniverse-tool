FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    unzip \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL https://deno.land/install.sh | sh \
    && cp /root/.deno/bin/deno /usr/local/bin/deno

WORKDIR /app

RUN pip install --no-cache-dir \
    fastapi>=0.115.0 \
    uvicorn[standard]>=0.32.0 \
    yt-dlp>=2025.02.19 \
    bgutil-ytdlp-pot-provider>=1.3.0 \
    pydantic>=2.9.0 \
    httpx>=0.27.0 \
    orjson>=3.10.0

COPY app/ /app/app/
COPY services/worker_ytdlp/ /app/services/worker_ytdlp/

ENV PORT=8001
ENV DOWNLOAD_DIR=/app/downloads
ENV PYTHONPATH=/app

EXPOSE 8001

CMD ["python3", "-m", "services.worker_ytdlp.main"]
