# ── Stage 1: Build Golang Gateway Binary ──
FROM golang:1.22-alpine AS go-builder
WORKDIR /build
COPY go.mod ./
COPY transcribe/ ./transcribe/
COPY *.go ./
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o server .

# ── Stage 2: Minimal Gateway Runtime ──
FROM alpine:3.19

RUN apk add --no-cache ca-certificates tzdata

WORKDIR /app

# Copy compiled server binary
COPY --from=go-builder /build/server /app/server

# Directories for frontend and shared downloads
RUN mkdir -p /app/downloads /frontend

EXPOSE 8000

ENV PORT=8000
ENV DOWNLOAD_DIR=/app/downloads
ENV FRONTEND_DIR=/frontend

CMD ["/app/server"]
