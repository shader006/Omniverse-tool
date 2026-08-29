#!/bin/bash
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$DIR"

if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

echo "🚀 Đang khởi động Omniverse Tool stack..."
docker stack deploy -c docker-stack.yml omniverse
echo "✅ Đã gửi lệnh khởi động! Kiểm tra trạng thái:"
docker service ls
