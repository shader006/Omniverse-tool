#!/usr/bin/env bash
# ==============================================================================
# Omniverse Tool - Start Stack Script
# ==============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" >/dev/null 2>&1 && pwd)"
DIR="$(cd "$SCRIPT_DIR/.." >/dev/null 2>&1 && pwd)"
cd "$DIR"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# 0. Phân tích tham số dòng lệnh CLI (Engine Selection)
BACKEND_TARGET="${BACKEND_ENGINE:-go}"

show_help() {
    echo "Usage: ./start [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --go             Khởi động với Backend Go (mặc định)"
    echo "  --nestjs         Khởi động với Backend NestJS (Hexagonal DDD)"
    echo "  -h, --help       Hiển thị hướng dẫn sử dụng"
    echo ""
}

while [[ "$#" -gt 0 ]]; do
    case $1 in
        --nestjs) BACKEND_TARGET="nestjs"; shift ;;
        --go)     BACKEND_TARGET="go"; shift ;;
        -h|--help) show_help; exit 0 ;;
        *) echo "⚠️ Tham số không xác định: $1"; show_help; exit 1 ;;
    esac
done

if [ "$BACKEND_TARGET" = "nestjs" ]; then
    echo -e "${YELLOW}⚙️ Backend Engine được chọn: NestJS (Hexagonal DDD Architecture)${NC}"
    export GATEWAY_IMAGE="omniversetool-gateway-nestjs:latest"

    # Tự động build nếu image chưa tồn tại
    if ! docker image inspect "$GATEWAY_IMAGE" >/dev/null 2>&1; then
        echo -e "${YELLOW}🔨 Chưa tìm thấy image '$GATEWAY_IMAGE', đang tiến hành build...${NC}"
        docker build -t "$GATEWAY_IMAGE" -f "$DIR/backend/internal_nestjs/Dockerfile" "$DIR/backend/internal_nestjs"
        echo -e "${GREEN}✅ Build image NestJS thành công!${NC}"
    fi
else
    echo -e "${GREEN}⚙️ Backend Engine được chọn: Golang (High Performance Gateway)${NC}"
    export GATEWAY_IMAGE="omniversetool-gateway:latest"
fi

# 1. Kiểm tra trạng thái Docker Swarm
SWARM_STATE=$(docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null || echo "inactive")
if [ "$SWARM_STATE" != "active" ]; then
    echo -e "${YELLOW}⚙️ Docker Swarm chưa kích hoạt, đang khởi tạo Swarm...${NC}"
    docker swarm init >/dev/null 2>&1 || true
fi

# 2. Đảm bảo không còn service cũ hoặc tài nguyên xung đột
EXISTING_SERVICES=$(docker service ls --filter "name=omniverse_" -q 2>/dev/null || true)
if [ -n "$EXISTING_SERVICES" ]; then
    echo -e "${YELLOW}⚠️ Phát hiện service cũ chưa dừng hoàn toàn, đang dọn sạch...${NC}"
    docker service rm $EXISTING_SERVICES >/dev/null 2>&1 || true
    sleep 2
fi

# 3. Load cấu hình .env
if [ -f .env ]; then
    echo -e "📄 Đang nạp cấu hình từ .env..."
    set -a
    source .env
    set +a
fi

export WORKSPACE_DIR="${LOCAL_WORKSPACE_FOLDER:-$DIR}"

# 3.5 Kiểm tra và tự động đóng gói Frontend React/Vite nếu cần
if [ -f "$DIR/frontend/package.json" ] && command -v npm >/dev/null 2>&1; then
    if [ ! -d "$DIR/frontend/dist" ] || [ "$DIR/frontend/src" -nt "$DIR/frontend/dist" ]; then
        echo -e "${YELLOW}⚡ Đang đóng gói Frontend React/Vite (npm run build)...${NC}"
        (cd "$DIR/frontend" && npm run build)
        echo -e "${GREEN}✅ Build frontend hoàn tất!${NC}"
    fi
fi

# 3.8 Khởi động hệ thống giám sát HiAI Observe nếu có
if [ -d "$DIR/hiai-observe" ] && [ -f "$DIR/hiai-observe/docker-compose.yml" ]; then
    echo -e "${YELLOW}🔍 Đang kiểm tra & khởi động HiAI Observe (Port 8001)...${NC}"
    docker compose -f "$DIR/hiai-observe/docker-compose.yml" up -d
fi

# 4. Deploy stack (có cơ chế tự động thử lại 1 lần nếu gặp race condition mạng overlay)
echo -e "📦 Đang triển khai stack 'omniverse' từ docker-stack.yml..."
if ! docker stack deploy --resolve-image=never -c docker-stack.yml omniverse; then
    echo -e "${YELLOW}⚠️ Mạng Docker đang trong tiến trình đồng bộ, thử lại sau 2 giây...${NC}"
    sleep 2
    docker stack deploy --resolve-image=never -c docker-stack.yml omniverse
fi

# 5. Chờ các service khởi động và hội tụ (convergence check)
echo -e "\n⏳ Đang khởi động các container và kiểm tra trạng thái (khoảng 6-8 giây)..."
for i in {1..7}; do
    echo -n "."
    sleep 1
done
echo -e "\n"

# 6. Hiển thị bảng trạng thái dịch vụ
echo -e "${BLUE}======================================================================${NC}"
echo -e "${GREEN}✅ TRẠNG THÁI CÁC DỊCH VỤ OMNIVERSE TOOL & HIAI OBSERVE:${NC}"
echo -e "${BLUE}======================================================================${NC}"
docker service ls --filter "name=omniverse_" --format "table {{.Name}}\t{{.Mode}}\t{{.Replicas}}\t{{.Ports}}"
if [ -d "$DIR/hiai-observe" ] && [ -f "$DIR/hiai-observe/docker-compose.yml" ]; then
    echo -e "\n${CYAN}📊 Trạng thái HiAI Observe Containers:${NC}"
    docker compose -f "$DIR/hiai-observe/docker-compose.yml" ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"
fi

echo -e "\n${GREEN}✨ Hướng dẫn truy cập:${NC}"
echo -e "   - Cổng Web / API (Pingora Proxy): ${BLUE}http://localhost:80${NC} (hoặc http://<IP-LAN>)"
echo -e "   - Backend Engine Kích Hoạt:       ${GREEN}${BACKEND_TARGET^^}${NC} (${GATEWAY_IMAGE})"
echo -e "   - Cổng HiAI Observe APM:          ${BLUE}http://localhost:8001${NC}"
echo -e "   - Dừng toàn bộ hệ thống:          ${YELLOW}./run/stop.sh${NC} (hoặc ./stop)"
echo -e "${BLUE}======================================================================${NC}\n"
