# Stage 1: Build static binary bằng Go
FROM golang:1.22-alpine AS builder

WORKDIR /src

COPY go.mod ./
COPY main.go ./

# Biên dịch tĩnh siêu tối ưu, loại bỏ debug symbols (-s -w)
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /autoscaler main.go

# Stage 2: Runtime Image siêu nhẹ (< 10MB)
FROM alpine:latest

RUN apk --no-cache add ca-certificates

WORKDIR /app

COPY --from=builder /autoscaler /app/autoscaler

CMD ["/app/autoscaler"]
