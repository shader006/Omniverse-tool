#!/bin/bash
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$DIR"

if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

export WORKSPACE_DIR="$DIR"

echo "🚀 Đang khởi động Omniverse Tool stack..."
docker stack deploy -c docker-stack.yml omniverse
echo "✅ Đã gửi lệnh khởi động! Kiểm tra trạng thái:"
docker service ls
