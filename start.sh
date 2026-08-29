#!/bin/bash
echo "🚀 Đang khởi động Omniverse Tool stack..."
docker stack deploy -c docker-stack.yml omniverse
echo "✅ Đã gửi lệnh khởi động! Kiểm tra trạng thái:"
docker service ls
