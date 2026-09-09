#!/usr/bin/env bash
# ==============================================================================
# Omniverse Tool - Modular Server & Resource Cleaner (Docker, App, Host OS)
# ==============================================================================
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$DIR"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# ------------------------------------------------------------------------------
# 1. Khởi tạo cấu hình và phân tích tham số dòng lệnh (CLI Args)
# ------------------------------------------------------------------------------
MOD_DOCKER=false
MOD_APP=false
MOD_SYSTEM=false
DEEP_MODE=false
DRY_RUN=false
DROP_CACHES=false

print_help() {
    cat << EOF
Sử dụng: ./clean.sh [TÙY CHỌN]...

Tùy chọn phân hệ:
  --docker        Chỉ dọn dẹp tài nguyên Docker (containers, images, build cache, logs)
  --app           Chỉ dọn dẹp ứng dụng Omniverse (downloads >2h, cache dự án)
  --system        Chỉ dọn dẹp hệ thống máy chủ Host (journal, apt, /tmp, crash dumps)
  (Nếu không chọn phân hệ nào, mặc định chạy cả 3 phân hệ an toàn)

Tùy chọn hành vi:
  -d, --deep      Chế độ dọn sâu (xóa cả unused docker images và toàn bộ build cache)
  -n, --dry-run   Chỉ quét và ước tính dung lượng có thể giải phóng, KHÔNG xóa gì
  --drop-caches   Yêu cầu kernel xả PageCache/Inodes trong RAM (yêu cầu sudo, không khuyến nghị định kỳ)
  -h, --help      Hiển thị hướng dẫn này

Ví dụ:
  ./clean.sh                  # Dọn dẹp an toàn tiêu chuẩn toàn hệ thống
  ./clean.sh --dry-run        # Quét thử xem có bao nhiêu rác mà không xóa
  ./clean.sh --deep           # Dọn sạch triệt để Docker build cache & images cũ
  ./clean.sh --app            # Chỉ dọn các file tạm của Omniverse (downloads, cache)
  sudo ./clean.sh --system    # Dọn dẹp sâu hệ thống máy chủ (APT, System logs)
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --docker)
            MOD_DOCKER=true
            shift
            ;;
        --app)
            MOD_APP=true
            shift
            ;;
        --system)
            MOD_SYSTEM=true
            shift
            ;;
        -d|--deep|-a|--all)
            DEEP_MODE=true
            shift
            ;;
        -n|--dry-run)
            DRY_RUN=true
            shift
            ;;
        --drop-caches)
            DROP_CACHES=true
            shift
            ;;
        -h|--help)
            print_help
            exit 0
            ;;
        *)
            echo -e "${RED}❌ Tùy chọn không hợp lệ: $1${NC}"
            print_help
            exit 1
            ;;
    esac
done

# Nếu không chọn phân hệ cụ thể, mặc định kích hoạt tất cả
if [ "$MOD_DOCKER" = false ] && [ "$MOD_APP" = false ] && [ "$MOD_SYSTEM" = false ]; then
    MOD_DOCKER=true
    MOD_APP=true
    MOD_SYSTEM=true
fi

# ------------------------------------------------------------------------------
# 2. Nhận diện quyền Root và User thực thi gốc (tránh lỗi $HOME khi chạy sudo)
# ------------------------------------------------------------------------------
IS_ROOT=false
if [ "$(id -u)" -eq 0 ]; then
    IS_ROOT=true
fi

# Xác định user thật sự đã gọi script (ngay cả khi gọi qua sudo)
REAL_USER="${SUDO_USER:-$(id -un)}"
REAL_HOME="$(getent passwd "$REAL_USER" 2>/dev/null | cut -d: -f6)"
[ -z "$REAL_HOME" ] && REAL_HOME="$HOME"

# Lấy Docker Root Directory động (tránh hard-code /var/lib/docker)
DOCKER_ROOT="$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || echo '/var/lib/docker')"

# ------------------------------------------------------------------------------
# 3. Banner thông tin
# ------------------------------------------------------------------------------
echo -e "${BLUE}======================================================================${NC}"
if [ "$DRY_RUN" = true ]; then
    echo -e "${YELLOW}🔍 [OMNIVERSE CLEANER] CHẾ ĐỘ QUÉT THỬ (DRY-RUN - KHÔNG XÓA DỮ LIỆU)${NC}"
else
    echo -e "${GREEN}🧹 [OMNIVERSE CLEANER] BẮT ĐẦU DỌN DẸP HỆ THỐNG...${NC}"
fi
echo -e "   ${CYAN}• Phân hệ:${NC} $([ "$MOD_DOCKER" = true ] && echo -n '[Docker] ') $([ "$MOD_APP" = true ] && echo -n '[Application] ') $([ "$MOD_SYSTEM" = true ] && echo -n '[Host System] ')"
echo -e "   ${CYAN}• Mức độ:${NC} $([ "$DEEP_MODE" = true ] && echo 'DỌN SÂU (--deep)' || echo 'TIÊU CHUẨN (Bảo tồn cache hữu ích)')"
echo -e "   ${CYAN}• Vận hành:${NC} User: ${BOLD}${REAL_USER}${NC} (Home: ${REAL_HOME}) | Quyền: $([ "$IS_ROOT" = true ] && echo -e "${YELLOW}Root/Sudo${NC}" || echo 'User thường')"
echo -e "${BLUE}======================================================================${NC}"

# Hiển thị trạng thái ổ cứng và RAM hiện tại
echo -e "\n${YELLOW}📊 Trạng thái đĩa cứng & RAM hiện thời:${NC}"
df -h / | awk 'NR==1 || NR==2 {print "   " $0}'
free -h | awk 'NR==1 || NR==2 {print "   " $0}'

# ==============================================================================
# PHÂN HỆ 1: DOCKER CLEANUP
# ==============================================================================
if [ "$MOD_DOCKER" = true ]; then
    echo -e "\n${BLUE}----------------------------------------------------------------------${NC}"
    echo -e "${BOLD}🐳 [1/3] PHÂN HỆ DOCKER${NC}"
    echo -e "${BLUE}----------------------------------------------------------------------${NC}"

    if [ "$DRY_RUN" = true ]; then
        echo -e "📋 ${CYAN}Dung lượng Docker hiện tại có thể thu hồi (docker system df):${NC}"
        docker system df | awk '{print "   " $0}'
    else
        # 1. Build Cache
        echo -e "🗑️  Đang dọn dẹp Docker Build Cache..."
        if [ "$DEEP_MODE" = true ]; then
            docker builder prune -a -f || true
        else
            docker builder prune --filter "until=48h" -f 2>/dev/null || docker builder prune -f || true
        fi

        # 2. Containers, Images, Networks
        echo -e "📦 Đang dọn dẹp Containers dừng, Networks thừa và Images..."
        docker container prune -f || true
        docker network prune -f || true
        if [ "$DEEP_MODE" = true ]; then
            echo -e "🖼️  Xóa toàn bộ unused images (--deep)..."
            docker image prune -a -f || true
        else
            docker image prune -f || true
        fi

        # 3. Docker Container JSON Logs (Sử dụng dynamic DOCKER_ROOT & an toàn tuyệt đối khoảng trắng)
        echo -e "📜 Đang kiểm tra log container quá khổ (> 20MB)..."
        docker run --rm -v "$DOCKER_ROOT/containers:/containers" alpine sh -c '
            count=$(find /containers -name "*-json.log" -size +20000k 2>/dev/null | wc -l)
            if [ "$count" -gt 0 ]; then
                find /containers -name "*-json.log" -size +20000k -exec truncate -s 0 {} + 2>/dev/null || true
                echo "   ✓ Đã thu gọn $count file log container quá khổ!"
            else
                echo "   ✓ Các file log container đều ở dung lượng an toàn."
            fi
        ' 2>/dev/null || true
    fi
fi

# ==============================================================================
# PHÂN HỆ 2: APPLICATION (OMNIVERSE) CLEANUP
# ==============================================================================
if [ "$MOD_APP" = true ]; then
    echo -e "\n${BLUE}----------------------------------------------------------------------${NC}"
    echo -e "${BOLD}📁 [2/3] PHÂN HỆ ỨNG DỤNG (OMNIVERSE)${NC}"
    echo -e "${BLUE}----------------------------------------------------------------------${NC}"

    # 1. Thư mục downloads/
    if [ -d "downloads" ]; then
        if [ "$DRY_RUN" = true ]; then
            DOWNLOADS_COUNT=$(find downloads/ -type f -mmin +120 2>/dev/null | wc -l)
            DOWNLOADS_SIZE=$(find downloads/ -type f -mmin +120 -exec du -ch {} + 2>/dev/null | grep 'total$' | awk '{print $1}' || echo "0B")
            echo -e "   • downloads/ (>2 giờ): Tìm thấy ${BOLD}${DOWNLOADS_COUNT}${NC} files (~${DOWNLOADS_SIZE:-0B}) có thể xóa."
        else
            # Sửa quyền sở hữu về REAL_USER nếu file do root sinh ra
            docker run --rm -v "$DIR/downloads:/data" alpine chown -R "$(id -u "$REAL_USER"):$(id -g "$REAL_USER")" /data 2>/dev/null || true
            find downloads/ -type f -mmin +120 -delete 2>/dev/null || true
            find downloads/ -mindepth 1 -type d -empty -delete 2>/dev/null || true
            echo -e "   ${GREEN}✓ Đã dọn dẹp sạch file tạm >2h và thư mục rỗng trong downloads/${NC}"
        fi
    fi

    # 2. Cache phát triển trong các thư mục dự án cho phép (Allowlist: backend, tests)
    ALLOWLIST_DIRS=("backend" "tests")
    TARGETS=()
    for d in "${ALLOWLIST_DIRS[@]}"; do
        if [ -d "$d" ]; then
            TARGETS+=("$d")
        fi
    done

    if [ ${#TARGETS[@]} -gt 0 ]; then
        if [ "$DRY_RUN" = true ]; then
            PYCACHE_COUNT=$(find "${TARGETS[@]}" -type d \( -name "__pycache__" -o -name ".pytest_cache" -o -name ".ruff_cache" -o -name ".mypy_cache" \) 2>/dev/null | wc -l)
            echo -e "   • Code Caches (Allowlist: ${TARGETS[*]}): Tìm thấy ${BOLD}${PYCACHE_COUNT}${NC} thư mục cache lập trình."
        else
            find "${TARGETS[@]}" -type d \( -name "__pycache__" -o -name ".pytest_cache" -o -name ".ruff_cache" -o -name ".mypy_cache" \) -exec rm -rf {} + 2>/dev/null || true
            echo -e "   ${GREEN}✓ Đã xóa sạch cache mã nguồn (__pycache__, pytest, ruff) trong: ${TARGETS[*]}${NC}"
        fi
    fi
fi

# ==============================================================================
# PHÂN HỆ 3: HOST OS CLEANUP
# ==============================================================================
if [ "$MOD_SYSTEM" = true ]; then
    echo -e "\n${BLUE}----------------------------------------------------------------------${NC}"
    echo -e "${BOLD}💻 [3/3] PHÂN HỆ HỆ THỐNG MÁY CHỦ (HOST LINUX)${NC}"
    echo -e "${BLUE}----------------------------------------------------------------------${NC}"

    if [ "$DRY_RUN" = true ]; then
        # Báo cáo cache của User thật sự
        USER_CACHE_SIZE="0B"
        if [ -d "$REAL_HOME/.cache" ]; then
            USER_CACHE_SIZE=$(du -sh "$REAL_HOME/.cache" 2>/dev/null | awk '{print $1}')
        fi
        echo -e "   • User Cache (${REAL_HOME}/.cache): Dung lượng khoảng ~${USER_CACHE_SIZE}"
        
        # Báo cáo file tạm trong /tmp
        TMP_COUNT=$(find /tmp -maxdepth 1 -user "$REAL_USER" -type f -mtime +2 2>/dev/null | wc -l)
        echo -e "   • /tmp cũ (>2 ngày của ${REAL_USER}): Tìm thấy ${BOLD}${TMP_COUNT}${NC} files."

        # Báo cáo Journal logs
        JOURNAL_SIZE=$(journalctl --disk-usage 2>/dev/null | grep -o '[0-9\.]\+[KMG]B' || echo "N/A")
        echo -e "   • Systemd Journal logs: Dung lượng ghi nhận ~${JOURNAL_SIZE}"
    else
        # 1. Dọn cache của REAL_USER (dùng REAL_HOME thay vì $HOME của root)
        if [ -d "$REAL_HOME/.cache" ]; then
            rm -rf "$REAL_HOME/.cache/thumbnails"/* 2>/dev/null || true
            rm -rf "$REAL_HOME/.cache/pip"/* 2>/dev/null || true
            if which go >/dev/null 2>&1; then
                sudo -u "$REAL_USER" go clean -cache 2>/dev/null || rm -rf "$REAL_HOME/.cache/go-build"/* 2>/dev/null || true
            fi
            echo -e "   ${GREEN}✓ Đã dọn Thumbnail, Pip & Go-build cache của user '${REAL_USER}'${NC}"
        fi

        # 2. Dọn file tạm cũ trong /tmp thuộc REAL_USER
        find /tmp -maxdepth 1 -user "$REAL_USER" -type f -mtime +2 -delete 2>/dev/null || true
        find /tmp -maxdepth 1 -user "$REAL_USER" -type d -empty -mtime +2 -delete 2>/dev/null || true
        echo -e "   ${GREEN}✓ Đã dọn file tạm cũ (>2 ngày) của '${REAL_USER}' trong /tmp${NC}"

        # 3. Dọn dẹp cấp hệ thống nếu có quyền root / sudo
        if [ "$IS_ROOT" = true ]; then
            echo -e "   ⚙️ Đang thực hiện dọn dẹp cấp quản trị viên (APT & Journal)..."
            journalctl --vacuum-time=3d --vacuum-size=50M >/dev/null 2>&1 || true
            apt-get autoremove --purge -y >/dev/null 2>&1 || true
            apt-get clean >/dev/null 2>&1 || true
            find /var/log -type f \( -name "*.gz" -o -name "*.1" -o -name "*.old" \) -mtime +7 -delete 2>/dev/null || true
            rm -rf /var/crash/* 2>/dev/null || true
            echo -e "   ${GREEN}✓ Đã dọn sạch APT package cache, System logs cũ & Crash reports${NC}"
        fi
    fi
fi

# ------------------------------------------------------------------------------
# 4. Xử lý bộ nhớ RAM / PageCache (Rõ ràng, không tự ý drop cache trừ khi có flag)
# ------------------------------------------------------------------------------
if [ "$DRY_RUN" = false ]; then
    sync
    if [ "$DROP_CACHES" = true ]; then
        if [ "$IS_ROOT" = true ]; then
            echo -e "\n${YELLOW}🧠 Đang xả PageCache, Dentries & Inodes trong RAM (--drop-caches)...${NC}"
            echo 3 > /proc/sys/vm/drop_caches 2>/dev/null || true
            echo -e "   ${GREEN}✓ Đã giải phóng kernel pagecache trong RAM!${NC}"
        else
            echo -e "\n${RED}⚠️ Cờ --drop-caches yêu cầu quyền sudo/root để thực hiện.${NC}"
        fi
    fi
fi

# ------------------------------------------------------------------------------
# 5. Kết quả & Hướng dẫn
# ------------------------------------------------------------------------------
echo -e "\n${BLUE}======================================================================${NC}"
if [ "$DRY_RUN" = true ]; then
    echo -e "${YELLOW}🔍 [KẾT QUẢ QUÉT THỬ XONG] Để tiến hành dọn dẹp thật sự, chạy lệnh:${NC}"
    echo -e "   ${GREEN}./clean.sh${NC} (hoặc ${BLUE}sudo ./clean.sh${NC} để dọn cả cấp hệ thống)"
else
    echo -e "${GREEN}✅ [HOÀN TẤT] KẾT QUẢ SAU KHI DỌN DẸP:${NC}"
    df -h / | awk 'NR==1 || NR==2 {print "   " $0}'
    echo -e ""
    free -h | awk 'NR==1 || NR==2 {print "   " $0}'

    if [ "$IS_ROOT" = false ] && [ "$MOD_SYSTEM" = true ]; then
        echo -e "\n${CYAN}💡 Mẹo:${NC} Để dọn sâu cả APT cache và System Journal logs của máy chủ, bạn có thể chạy:"
        echo -e "   ${BLUE}sudo ./clean.sh${NC}"
    fi
fi
echo -e "${BLUE}======================================================================${NC}\n"
