# ── Stage 1: Build binary bằng Rust & Clang/CMake ──
FROM rust:bookworm AS builder

WORKDIR /usr/src/pingora_proxy

# Cài đặt các công cụ biên dịch cần thiết cho Pingora
RUN apt-get update && apt-get install -y --no-install-recommends \
    cmake \
    clang \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy mã nguồn
COPY Cargo.toml ./
COPY src ./src

# Biên dịch Release tối ưu hóa tốc độ cao nhất
RUN cargo build --release

# ── Stage 2: Runtime Image siêu nhẹ ──
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libssl3 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy binary đã build từ builder
COPY --from=builder /usr/src/pingora_proxy/target/release/pingora_proxy /usr/local/bin/pingora_proxy

EXPOSE 80 443

ENV RUST_LOG=info
ENV UPSTREAM_ADDR=app:8000

CMD ["pingora_proxy"]
