#!/usr/bin/env bash
# ==============================================================================
# Omniverse Tool - Automated & Manual Server Cleaner Script
# ==============================================================================
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$DIR"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}======================================================================${NC}"
echo -e "${GREEN}🧹 [OMNIVERSE CLEANER] BẮT ĐẦU DỌN DẸP DOCKER & CACHE MÁY CHỦ...${NC}"
echo -e "${BLUE}======================================================================${NC}"

# 1. Hiển thị dung lượng trước khi dọn
echo -e "\n${YELLOW}📊 [1/5] Dung lượng ổ cứng trước khi dọn dẹp:${NC}"
df -h / | awk 'NR==1 || NR==2 {print "   " $0}'

# 2. Dọn dẹp Docker Build Cache (Buildkit layers tạm thời)
echo -e "\n${YELLOW}🗑️ [2/5] Đang dọn dẹp Docker Build Cache...${NC}"
docker builder prune -a -f || true

# 3. Dọn dẹp Dangling & Unused Docker Images (<none> images)
echo -e "\n${YELLOW}🖼️ [3/5] Đang dọn dẹp Docker Images cũ & không dùng...${NC}"
docker image prune -f || true

# 4. Dọn dẹp Stopped Containers & Unused Networks
echo -e "\n${YELLOW}📦 [4/5] Đang dọn dẹp Containers tạm và Networks thừa...${NC}"
docker container prune -f || true
docker network prune -f || true

# 5. Dọn dẹp file tạm trong thư mục downloads (quá 2 giờ)
echo -e "\n${YELLOW}📁 [5/5] Đang dọn dẹp file tải về cũ (> 2 giờ) trong downloads/...${NC}"
if [ -d "downloads" ]; then
    find downloads/ -type f -mmin +120 -delete 2>/dev/null || true
    echo -e "   ${GREEN}✓ Đã quét và làm sạch thư mục downloads!${NC}"
fi

# 6. Thu hồi RAM hệ thống (Linux Page Cache & Free Buffer nếu cần)
echo -e "\n${YELLOW}🧠 [Bổ sung] Đồng bộ và làm tươi bộ nhớ RAM cache...${NC}"
sync

echo -e "\n${BLUE}======================================================================${NC}"
echo -e "${GREEN}✅ [HOÀN TẤT] KẾT QUẢ SAU KHI DỌN DẸP:${NC}"
echo -e "${BLUE}======================================================================${NC}"
df -h / | awk 'NR==1 || NR==2 {print "   " $0}'
echo -e ""
free -h | awk 'NR==1 || NR==2 {print "   " $0}'
echo -e "\n${GREEN}🎉 Hệ thống đã được dọn sạch rác và sẵn sàng hoạt động ở trạng thái tốt nhất!${NC}\n"
