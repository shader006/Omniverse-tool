FROM mcr.microsoft.com/devcontainers/base:debian-12

# Cài đặt các công cụ hệ thống cần thiết cho C/C++, CMake, Clang (cho Pingora & Pixelfixer), FFmpeg và bảo mật
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    clang \
    pkg-config \
    libssl-dev \
    ffmpeg \
    ca-certificates \
    curl \
    git \
    jq \
    && rm -rf /var/lib/apt/lists/*
