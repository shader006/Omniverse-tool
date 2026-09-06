# Môi trường build WebAssembly chuẩn với Rust và wasm-pack
FROM rust:1.80-slim as builder

RUN apt-get update && apt-get install -y curl pkg-config libssl-dev build-essential \
    && rm -rf /var/lib/apt/lists/*

# Cài đặt wasm-pack
RUN curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh

WORKDIR /app
COPY . .

# Build WebAssembly cho target Web
RUN wasm-pack build --target web --release --out-dir /app/pkg

CMD ["cp", "-r", "/app/pkg/.", "/output/"]
