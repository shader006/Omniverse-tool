FROM rust:1-slim AS builder

WORKDIR /build

COPY services/worker_pixelfixer/Cargo.toml ./
COPY services/worker_pixelfixer/src ./src

RUN cargo build --release

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN mkdir -p /app/downloads
COPY --from=builder /build/target/release/worker_pixelfixer /app/worker_pixelfixer

ENV PORT=8004
ENV DOWNLOAD_DIR=/app/downloads
EXPOSE 8004

CMD ["/app/worker_pixelfixer"]
