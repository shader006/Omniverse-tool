#!/usr/bin/env bash
# ==============================================================================
# Omniverse Tool - Stop Stack Script
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
echo -e "${YELLOW}🛑 ĐANG DỪNG OMNIVERSE TOOL STACK...${NC}"
echo -e "${BLUE}======================================================================${NC}"

# 1. Gỡ bỏ Docker stack
if docker stack ls --format '{{.Name}}' | grep -q "^omniverse$"; then
    echo -e "📦 Đang gửi tín hiệu gỡ bỏ stack 'omniverse'..."
    docker stack rm omniverse >/dev/null 2>&1 || true
fi

# 2. Chờ cho tất cả các service dừng hẳn
echo -n "⏳ Đang đợi toàn bộ services kết thúc"
for i in {1..25}; do
    SERVICES=$(docker service ls --filter "name=omniverse_" -q 2>/dev/null || true)
    if [ -z "$SERVICES" ]; then
        break
    fi
    echo -n "."
    sleep 1
done
echo ""

# Nếu còn service kẹt do mất label namespace, cưỡng chế xóa
REMAINING_SERVICES=$(docker service ls --filter "name=omniverse_" -q 2>/dev/null || true)
if [ -n "$REMAINING_SERVICES" ]; then
    echo -e "${YELLOW}⚠️ Cưỡng chế dọn dẹp các service còn sót...${NC}"
    docker service rm $REMAINING_SERVICES >/dev/null 2>&1 || true
    sleep 2
fi

# 3. Chờ cho overlay network omniverse_omniverse_net được giải phóng hoàn toàn
echo -n "🌐 Đang đợi Docker giải phóng mạng overlay"
for i in {1..15}; do
    if ! docker network ls --format '{{.Name}}' | grep -q "^omniverse_omniverse_net$"; then
        break
    fi
    echo -n "."
    docker network rm omniverse_omniverse_net >/dev/null 2>&1 || true
    sleep 1
done
echo ""

# Cho Docker daemon nghỉ 1 nhịp để hoàn tất state sync
sleep 1

echo -e "\n${GREEN}✅ ĐÃ DỪNG TOÀN BỘ DỊCH VỤ VÀ GIẢI PHÓNG TÀI NGUYÊN HOÀN TẤT!${NC}"
echo -e "${BLUE}======================================================================${NC}\n"
