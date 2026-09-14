FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -u 1000 -m appuser

WORKDIR /app

COPY services/worker_pdf2docx/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY services/worker_pdf2docx/ /app/services/worker_pdf2docx/

RUN mkdir -p /app/downloads && chown -R appuser:appuser /app /home/appuser

ENV PORT=8005
ENV DOWNLOAD_DIR=/app/downloads
ENV PYTHONPATH=/app/services/worker_pdf2docx:/app

EXPOSE 8005

USER appuser

CMD ["python3", "/app/services/worker_pdf2docx/main.py"]
