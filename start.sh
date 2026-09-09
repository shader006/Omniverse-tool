#!/usr/bin/env bash
# ==============================================================================
# Omniverse Tool - Start Stack Script
# ==============================================================================
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$DIR"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}======================================================================${NC}"
echo -e "${GREEN}🚀 ĐANG KHỞI ĐỘNG OMNIVERSE TOOL STACK...${NC}"
echo -e "${BLUE}======================================================================${NC}"

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

export WORKSPACE_DIR="$DIR"

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
echo -e "${GREEN}✅ TRẠNG THÁI CÁC DỊCH VỤ OMNIVERSE TOOL:${NC}"
echo -e "${BLUE}======================================================================${NC}"
docker service ls --filter "name=omniverse_" --format "table {{.Name}}\t{{.Mode}}\t{{.Replicas}}\t{{.Ports}}"

echo -e "\n${GREEN}✨ Hướng dẫn truy cập:${NC}"
echo -e "   - Cổng Gateway trực tiếp:  ${BLUE}http://localhost:8000${NC}"
echo -e "   - Cổng Pingora Proxy:      ${BLUE}http://localhost:8080${NC}"
echo -e "   - Dừng toàn bộ hệ thống:   ${YELLOW}./stop.sh${NC} (hoặc ./stop)"
echo -e "${BLUE}======================================================================${NC}\n"
