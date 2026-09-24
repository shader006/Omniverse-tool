# ── Stage 1: Build NestJS TypeScript Binary ──
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json tsconfig*.json nest-cli.json ./
RUN npm install

COPY src/ ./src/
RUN npm run build

# ── Stage 2: Minimal NestJS Production Runtime ──
FROM node:20-alpine AS runner

RUN apk add --no-cache ca-certificates tzdata

WORKDIR /app

# Chuẩn bị thư mục cho downloads dùng chung và frontend với quyền user node
RUN mkdir -p /app/downloads /frontend && \
    chown -R node:node /app /frontend

USER node

COPY --chown=node:node package*.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY --chown=node:node --from=builder /app/dist ./dist

EXPOSE 8000

ENV NODE_ENV=production
ENV PORT=8000
ENV DOWNLOAD_DIR=/app/downloads
ENV FRONTEND_DIR=/frontend

CMD ["node", "dist/main.js"]
