#!/usr/bin/env python3
import os
import sys
import json
import urllib.request
import urllib.error

API_BASE = os.getenv("HIAI_OBSERVE_URL", "http://localhost:8001")
API_KEY = os.getenv("HIAI_OBSERVE_API_KEY", "")

MONITORS = [
    {
        "name": "🚪 Omniverse Gateway API",
        "url": "http://172.17.0.1:8000/api/health",
        "interval_seconds": 30,
        "monitor_group": "Gateways"
    },
    {
        "name": "🌐 Omniverse Frontend Web UI",
        "url": "http://172.17.0.1:8000/",
        "interval_seconds": 30,
        "monitor_group": "Frontend"
    },
    {
        "name": "⚡ Pingora Reverse Proxy (Port 80)",
        "url": "http://172.17.0.1:80/",
        "interval_seconds": 30,
        "monitor_group": "Gateways"
    },
    {
        "name": "🦀 PixelFixer Worker",
        "url": "http://172.17.0.1:8000/api/pixel/health",
        "interval_seconds": 30,
        "monitor_group": "Workers"
    },
    {
        "name": "🔍 HiAi Observe Health",
        "url": "http://localhost:8001/api/health",
        "interval_seconds": 30,
        "monitor_group": "Observability"
    }
]

def get_project_id():
    req = urllib.request.Request(
        f"{API_BASE}/api/projects",
        headers={"Authorization": f"Bearer {API_KEY}"}
    )
    # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected - internal script
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode())
        projects = data.get("projects", [])
        if projects:
            return projects[0]["id"]
    return None

def get_existing_monitors():
    req = urllib.request.Request(
        f"{API_BASE}/api/monitors",
        headers={"Authorization": f"Bearer {API_KEY}"}
    )
    # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected - internal script
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode())
        return {m["url"]: m for m in data.get("monitors", [])}

def seed():
    print("🚀 Đang đồng bộ tự động danh sách Monitors vào HiAi Observe...")
    project_id = get_project_id()
    if not project_id:
        print("❌ Không tìm thấy project trong HiAi Observe!")
        return

    existing = get_existing_monitors()
    
    for m in MONITORS:
        url = m["url"]
        name = m["name"]
        if url in existing:
            print(f"   ℹ️ Đã tồn tại: {name} ({url})")
            continue
            
        payload = {
            "name": name,
            "url": url,
            "interval_seconds": m.get("interval_seconds", 30),
            "project_id": project_id,
            "monitor_group": m.get("monitor_group", "General")
        }
        
        req = urllib.request.Request(
            f"{API_BASE}/api/monitors",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {API_KEY}",
                "Content-Type": "application/json"
            },
            method="POST"
        )
        try:
            # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected - internal script
            with urllib.request.urlopen(req) as resp:
                print(f"   ✅ Đã thêm Monitor: {name} ➔ {url}")
        except urllib.error.HTTPError as e:
            print(f"   ⚠️ Lỗi khi thêm {name}: {e.read().decode()}")

    print("🎉 Hoàn tất! Hãy F5 lại trang Uptime Monitoring trên trình duyệt.")

if __name__ == "__main__":
    seed()
