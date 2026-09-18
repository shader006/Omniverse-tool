#!/usr/bin/env python3
"""
HiAI Observe Lightweight Host Agent for Remote Machine (pail).
Collects system metrics (CPU, RAM, Disk, Network, Load, GPU, Docker)
and pushes them to the HiAI Observe server over Tailscale.

Requires only Python 3 standard library.
"""

import os
import sys
import re
import time
import json
import socket
import platform
import subprocess
import urllib.request
import urllib.error
import urllib.parse

# Tự động nạp cấu hình từ file .env nếu có (chuẩn bị chạy độc lập không cần thư viện ngoài)
def _load_local_env():
    candidates = [
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".env")),
        os.path.abspath(".env")
    ]
    for p in candidates:
        if os.path.exists(p):
            try:
                with open(p, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line and not line.startswith("#") and "=" in line:
                            k, v = line.split("=", 1)
                            k = k.strip()
                            v = v.strip().strip("'\"")
                            if k and k not in os.environ:
                                os.environ[k] = v
                break
            except Exception:
                pass

_load_local_env()

# ── Configuration ────────────────────────────────────────────────────────────
DEFAULT_OBSERVE_URL = "http://localhost:8001"
OBSERVE_URL = os.getenv("HIAI_OBSERVE_URL", DEFAULT_OBSERVE_URL).rstrip("/")
API_KEY = os.getenv("HIAI_OBSERVE_API_KEY", "")
HOST_ID = os.getenv("HOST_ID", "pail")
INTERVAL = int(os.getenv("INTERVAL_SECONDS", "15"))
PROXY_URL = os.getenv("HIAI_PROXY") or os.getenv("TAILSCALE_PROXY") or os.getenv("HTTP_PROXY") or os.getenv("http_proxy")
DISK_PATH = os.getenv("HIAI_DISK_PATH", "").strip()
QUIET_MODE = os.getenv("HIAI_QUIET", "0").lower() in ("1", "true", "yes")
VERBOSE_MODE = os.getenv("HIAI_VERBOSE", "0").lower() in ("1", "true", "yes")
HEARTBEAT_TICKS = int(os.getenv("HIAI_LOG_EVERY", "20"))

# ── Proxy Auto-Detection (Tailscale Userspace Networking) ─────────────────────
ACTIVE_PROXY = None

def is_port_reachable(host: str, port: int, timeout: float = 0.2) -> bool:
    """Checks if a TCP port is reachable quickly."""
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except Exception:
        return False

def setup_proxy(custom_proxy=None):
    """
    Configures urllib with a proxy. Automatically detects local Tailscale
    userspace proxy (127.0.0.1:1055) when target URL uses Tailscale (100.x or .ts.net).
    """
    global ACTIVE_PROXY
    proxy = custom_proxy or PROXY_URL

    if not proxy:
        # Check if connecting to a Tailscale IP or domain while tailscaled userspace proxy is up
        is_tailscale_dest = "100." in OBSERVE_URL or ".ts.net" in OBSERVE_URL or "shader" in OBSERVE_URL
        if is_tailscale_dest and is_port_reachable("127.0.0.1", 1055):
            proxy = "http://127.0.0.1:1055"

    if proxy and proxy.lower() not in ("none", "direct", "off"):
        ACTIVE_PROXY = proxy
        proxy_handler = urllib.request.ProxyHandler({
            "http": proxy,
            "https": proxy
        })
        opener = urllib.request.build_opener(proxy_handler)
        urllib.request.install_opener(opener)
        return proxy
    else:
        ACTIVE_PROXY = None
        urllib.request.install_opener(urllib.request.build_opener())
        return None

# Initialize proxy configuration
setup_proxy()

INGEST_ENDPOINT = f"{OBSERVE_URL}/api/agent/ingest"

# ── Metric Collectors ─────────────────────────────────────────────────────────

_prev_cpu_stat = None
_prev_net_stat = None
_prev_time = None

def get_cpu_stats():
    """Reads overall CPU % and per-core CPU % from /proc/stat."""
    global _prev_cpu_stat
    try:
        with open("/proc/stat", "r") as f:
            lines = f.readlines()
    except Exception:
        return 0.0, []

    current = {}
    for line in lines:
        parts = line.split()
        if not parts:
            continue
        name = parts[0]
        if name == "cpu" or (name.startswith("cpu") and name[3:].isdigit()):
            vals = [float(x) for x in parts[1:]]
            idle = vals[3] + (vals[4] if len(vals) > 4 else 0)
            total = sum(vals)
            current[name] = (idle, total)

    if not _prev_cpu_stat:
        _prev_cpu_stat = current
        time.sleep(0.1)
        return get_cpu_stats()

    overall_pct = 0.0
    if "cpu" in current and "cpu" in _prev_cpu_stat:
        idle, total = current["cpu"]
        prev_idle, prev_total = _prev_cpu_stat["cpu"]
        diff_idle = idle - prev_idle
        diff_total = total - prev_total
        pct = round((1.0 - (diff_idle / diff_total)) * 100.0, 1) if diff_total > 0 else 0.0
        overall_pct = max(0.0, min(100.0, pct))

    cores_pct = []
    core_keys = sorted(
        [k for k in current.keys() if k.startswith("cpu") and k[3:].isdigit()],
        key=lambda x: int(x[3:])
    )
    for name in core_keys:
        if name in _prev_cpu_stat:
            idle, total = current[name]
            prev_idle, prev_total = _prev_cpu_stat[name]
            diff_idle = idle - prev_idle
            diff_total = total - prev_total
            pct = round((1.0 - (diff_idle / diff_total)) * 100.0, 1) if diff_total > 0 else 0.0
            cores_pct.append(max(0.0, min(100.0, pct)))
        else:
            cores_pct.append(0.0)

    _prev_cpu_stat = current
    return overall_pct, cores_pct

def get_memory_stats():
    """Reads RAM and Swap usage in MB from /proc/meminfo."""
    mem = {}
    try:
        with open("/proc/meminfo", "r") as f:
            for line in f:
                parts = line.split(":")
                if len(parts) == 2:
                    mem[parts[0].strip()] = int(parts[1].strip().split()[0])
    except Exception:
        return 0, 0, 0, 0, 0

    total_mb = mem.get("MemTotal", 0) // 1024
    avail_mb = mem.get("MemAvailable", mem.get("MemFree", 0)) // 1024
    used_mb = max(0, total_mb - avail_mb)
    swap_total_mb = mem.get("SwapTotal", 0) // 1024
    swap_free_mb = mem.get("SwapFree", 0) // 1024
    swap_used_mb = max(0, swap_total_mb - swap_free_mb)

    return used_mb, total_mb, avail_mb, swap_used_mb, swap_total_mb

def get_mount_point(path: str) -> str:
    """Finds the filesystem mount point of a given path."""
    path = os.path.abspath(path)
    while not os.path.ismount(path):
        parent = os.path.dirname(path)
        if parent == path:
            break
        path = parent
    return path

def find_allocated_disk_path() -> str:
    """
    Identifies the allocated filesystem/storage path for the current user.
    In shared SSH environments (like university/lab GPU servers), user home
    and workspaces are often mounted on dedicated data disks (e.g. /mnt/data/ssd980)
    rather than the root '/' system drive which may be full from OS/other users.
    """
    if DISK_PATH and os.path.exists(DISK_PATH):
        return DISK_PATH

    # Check user home directory mount first
    home_dir = os.path.expanduser("~")
    if os.path.exists(home_dir):
        m = get_mount_point(home_dir)
        if m and m != "/":
            return m

    # Check current working directory mount
    cwd = os.getcwd()
    if os.path.exists(cwd):
        m = get_mount_point(cwd)
        if m and m != "/":
            return m

    # Common shared data mount locations
    for common_path in ["/mnt/data/ssd980", "/mnt/data", "/data"]:
        if os.path.exists(common_path) and os.path.ismount(common_path):
            return common_path

    return "/"

def get_disk_stats(path: str = None):
    """
    Reads disk usage in GB on the allocated storage path.
    Uses actual used space (f_blocks - f_bfree) to match 'df' command output,
    reporting path, used_gb, total_gb, free_gb, and percent.
    """
    target = path or find_allocated_disk_path()
    try:
        st = os.statvfs(target)
        total_gb = round((st.f_blocks * st.f_frsize) / (1024 ** 3), 1)
        used_gb = round(((st.f_blocks - st.f_bfree) * st.f_frsize) / (1024 ** 3), 1)
        free_gb = round((st.f_bavail * st.f_frsize) / (1024 ** 3), 1)
        pct = round((used_gb / total_gb) * 100, 1) if total_gb else 0.0
        return {
            "path": target,
            "used": used_gb,
            "total": total_gb,
            "free": free_gb,
            "percent": pct
        }
    except Exception:
        return {
            "path": target or "/",
            "used": 0.0,
            "total": 0.0,
            "free": 0.0,
            "percent": 0.0
        }

_prev_disk_io = None

def get_disk_io():
    """
    Reads disk I/O metrics from /proc/diskstats (Linux).
    Calculates read/write rates (bytes/s), total read/write bytes, IOPS, and %util.
    Pure Python standard library with zero disk overhead.
    """
    global _prev_disk_io
    now = time.time()
    total_reads = 0
    total_read_sectors = 0
    total_writes = 0
    total_write_sectors = 0
    total_io_ms = 0
    disk_count = 0

    try:
        with open("/proc/diskstats", "r") as f:
            for line in f:
                parts = line.split()
                if len(parts) < 14:
                    continue
                dev = parts[2]
                if dev.startswith(("loop", "ram", "dm-", "md", "sr", "zram")):
                    continue
                # Exclude partitions to avoid double counting
                if re.match(r"^(sd[a-z]+\d+|nvme\d+n\d+p\d+|vd[a-z]+\d+|xvd[a-z]+\d+|mmcblk\d+p\d+)", dev):
                    continue
                disk_count += 1
                total_reads += int(parts[3])
                total_read_sectors += int(parts[5])
                total_writes += int(parts[7])
                total_write_sectors += int(parts[9])
                total_io_ms += int(parts[12])

        read_bytes = total_read_sectors * 512
        write_bytes = total_write_sectors * 512
        read_rate = 0
        write_rate = 0
        iops = 0.0
        util_pct = 0.0

        if _prev_disk_io:
            dt = max(now - _prev_disk_io["time"], 0.1)
            dr_sec = max(total_read_sectors - _prev_disk_io["read_sectors"], 0)
            dw_sec = max(total_write_sectors - _prev_disk_io["write_sectors"], 0)
            dr_ops = max(total_reads - _prev_disk_io["reads"], 0)
            dw_ops = max(total_writes - _prev_disk_io["writes"], 0)
            d_ioms = max(total_io_ms - _prev_disk_io["io_ms"], 0)

            read_rate = int((dr_sec * 512) / dt)
            write_rate = int((dw_sec * 512) / dt)
            iops = round((dr_ops + dw_ops) / dt, 1)
            divisor = max(disk_count, 1) * dt * 1000.0
            util_pct = min(round((d_ioms / divisor) * 100.0, 2), 100.0)

        _prev_disk_io = {
            "time": now,
            "reads": total_reads,
            "read_sectors": total_read_sectors,
            "writes": total_writes,
            "write_sectors": total_write_sectors,
            "io_ms": total_io_ms
        }

        return {
            "readBytes": read_bytes,
            "writeBytes": write_bytes,
            "readRate": read_rate,
            "writeRate": write_rate,
            "iops": iops,
            "utilPercent": util_pct
        }
    except Exception:
        return {
            "readBytes": 0,
            "writeBytes": 0,
            "readRate": 0,
            "writeRate": 0,
            "iops": 0.0,
            "utilPercent": 0.0
        }

def get_load_avg():
    """Reads 1m, 5m, 15m load average."""
    try:
        with open("/proc/loadavg", "r") as f:
            parts = f.read().split()
            return [float(parts[0]), float(parts[1]), float(parts[2])]
    except Exception:
        return [0.0, 0.0, 0.0]

def get_network_stats():
    """Reads network Rx and Tx bytes from /proc/net/dev."""
    rx = 0
    tx = 0
    try:
        with open("/proc/net/dev", "r") as f:
            for line in f.readlines()[2:]:
                parts = line.split()
                if len(parts) < 10:
                    continue
                iface = parts[0].strip(":")
                if iface == "lo":
                    continue
                rx += int(parts[1])
                tx += int(parts[9])
    except Exception:
        pass
    return rx, tx

def get_uptime_seconds():
    try:
        with open("/proc/uptime", "r") as f:
            return int(float(f.read().split()[0]))
    except Exception:
        return 0

def get_cpu_model():
    try:
        with open("/proc/cpuinfo", "r") as f:
            for line in f:
                if "model name" in line:
                    return line.split(":")[1].strip()
    except Exception:
        pass
    return platform.processor() or "Unknown CPU"

def get_kernel_release():
    try:
        with open("/proc/sys/kernel/osrelease", "r") as f:
            return f.read().strip()
    except Exception:
        return platform.release()

def get_gpu_stats():
    """Collects GPU metrics if nvidia-smi is available."""
    try:
        out = subprocess.check_output(
            ["nvidia-smi", "--query-gpu=index,utilization.gpu,memory.used,memory.total,temperature.gpu", "--format=csv,noheader,nounits"],
            stderr=subprocess.DEVNULL,
            timeout=2
        ).decode().strip()
        gpus = []
        for line in out.splitlines():
            if not line.strip():
                continue
            parts = [p.strip() for p in line.split(",")]
            if len(parts) >= 5:
                gpus.append({
                    "gpuIndex": int(parts[0]),
                    "utilizationPercent": float(parts[1]),
                    "memoryUsedMb": float(parts[2]),
                    "memoryTotalMb": float(parts[3]),
                    "temperatureC": float(parts[4]) if parts[4] != "N/A" else None
                })
        return gpus
    except Exception:
        return []

def get_docker_containers():
    """Collects container stats if docker is running."""
    containers = []
    try:
        ps_out = subprocess.check_output(
            ["docker", "ps", "--format", "{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}"],
            stderr=subprocess.DEVNULL,
            timeout=3
        ).decode().strip()
        if not ps_out:
            return []

        stats_out = subprocess.check_output(
            ["docker", "stats", "--no-stream", "--format", "{{.ID}}|{{.CPUPerc}}|{{.MemUsage}}"],
            stderr=subprocess.DEVNULL,
            timeout=5
        ).decode().strip()

        stats_map = {}
        for line in stats_out.splitlines():
            parts = line.split("|")
            if len(parts) >= 3:
                cid = parts[0].strip()
                cpu_str = parts[1].replace("%", "").strip()
                mem_part = parts[2].split("/")[0].strip()
                mem_mb = 0.0
                if "GiB" in mem_part:
                    mem_mb = float(mem_part.replace("GiB", "").strip()) * 1024
                elif "MiB" in mem_part:
                    mem_mb = float(mem_part.replace("MiB", "").strip())
                elif "kB" in mem_part:
                    mem_mb = float(mem_part.replace("kB", "").strip()) / 1024
                stats_map[cid] = (float(cpu_str) if cpu_str else 0.0, mem_mb)

        for line in ps_out.splitlines():
            parts = line.split("|")
            if len(parts) >= 4:
                cid = parts[0].strip()
                name = parts[1].strip()
                image = parts[2].strip()
                status = parts[3].strip()
                cpu, mem_mb = stats_map.get(cid, (0.0, 0.0))
                containers.append({
                    "id": cid,
                    "name": name,
                    "image": image,
                    "status": status,
                    "cpu": cpu,
                    "memory": mem_mb
                })
    except Exception:
        pass
    return containers

def get_top_processes(mem_total_mb: float = 0):
    """
    Collects top 10 CPU-consuming processes using standard `ps`.
    Zero external dependencies, fast (<10ms).
    """
    procs = []
    try:
        out = subprocess.check_output(
            ["ps", "-eo", "pid,comm,%cpu,%mem,stat", "--sort=-%cpu", "--no-headers"],
            timeout=3,
            stderr=subprocess.DEVNULL
        ).decode("utf-8")
        for line in out.strip().split("\n")[:10]:
            parts = line.split()
            if len(parts) >= 5:
                pid = int(parts[0])
                comm = parts[1]
                try:
                    cpu_pct = float(parts[2])
                    mem_pct = float(parts[3])
                except ValueError:
                    continue
                state = parts[4]
                mem_mb = round((mem_pct / 100.0) * mem_total_mb, 1) if mem_total_mb > 0 else 0.0
                state_str = "running" if state.startswith("R") else ("sleeping" if state.startswith("S") else state)
                procs.append({
                    "pid": pid,
                    "name": comm,
                    "cpuPercent": cpu_pct,
                    "memoryMb": mem_mb,
                    "state": state_str
                })
    except Exception:
        pass
    return procs

def build_snapshot():
    cpu_pct, cores = get_cpu_stats()
    mem_used, mem_total, mem_avail, swap_used, swap_total = get_memory_stats()
    disk_info = get_disk_stats()
    disk_used = disk_info["used"]
    disk_total = disk_info["total"]
    disk_pct = disk_info["percent"]
    disk_path = disk_info["path"]
    load = get_load_avg()
    rx, tx = get_network_stats()
    uptime = get_uptime_seconds()
    gpus = get_gpu_stats()
    containers = get_docker_containers()
    top_procs = get_top_processes(mem_total)

    mem_pct = round((mem_used / mem_total) * 100, 1) if mem_total else 0.0
    disk_io = get_disk_io()

    data = {
        "hostId": HOST_ID,
        "hostStats": {
            "cpu": cpu_pct,
            "memory": mem_used,
            "memoryTotal": mem_total,
            "memoryPercent": mem_pct,
            "memoryAvailable": mem_avail,
            "swapUsed": swap_used,
            "swapTotal": swap_total,
            "disk": disk_used,
            "diskTotal": disk_total,
            "diskPercent": disk_pct,
            "diskMount": disk_path,
            "projectDisk": disk_info,
            "diskReadRate": disk_io["readRate"],
            "diskWriteRate": disk_io["writeRate"],
            "diskReadBytes": disk_io["readBytes"],
            "diskWriteBytes": disk_io["writeBytes"],
            "diskIops": disk_io["iops"],
            "diskUtilPercent": disk_io["utilPercent"],
            "topProcesses": top_procs,
            "load": load,
            "network": {"rx": rx, "tx": tx},
            "cores": cores
        },
        "containers": containers,
        "hostInfo": {
            "os": f"{platform.system()} {platform.release()}",
            "kernel": get_kernel_release(),
            "cpuModel": get_cpu_model(),
            "cores": os.cpu_count() or 1,
            "arch": platform.machine(),
            "totalMemoryMb": mem_total,
            "totalDiskGb": disk_total,
            "diskMount": disk_path,
            "uptime": uptime
        }
    }
    if gpus:
        data["gpu"] = gpus
    return data

def send_snapshot(snapshot):
    parsed = urllib.parse.urlparse(INGEST_ENDPOINT)
    if parsed.scheme not in ("http", "https"):
        return 0, f"Unsupported endpoint scheme: {parsed.scheme}"
    payload = json.dumps(snapshot).encode("utf-8")
    req = urllib.request.Request(
        INGEST_ENDPOINT,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "X-API-Key": API_KEY,
            "Accept": "application/json",
            "Host": parsed.netloc
        },
        method="POST"
    )
    try:
        # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected
        with urllib.request.urlopen(req, timeout=8) as resp:
            return resp.status, resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8")
    except Exception as e:
        return 0, str(e)

# ── Service Installer Helper ──────────────────────────────────────────────────

def install_systemd_service():
    """Generates and enables systemd service on Linux."""
    script_path = os.path.abspath(__file__)
    python_bin = sys.executable
    
    proxy_envs = ""
    if ACTIVE_PROXY:
        proxy_envs = f"""Environment="HTTP_PROXY={ACTIVE_PROXY}"
Environment="HTTPS_PROXY={ACTIVE_PROXY}"
"""

    service_content = f"""[Unit]
Description=HiAI Observe Agent (Pail Remote Collector)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart={python_bin} {script_path}
Restart=always
RestartSec=10
Environment="HIAI_OBSERVE_URL={OBSERVE_URL}"
Environment="HIAI_OBSERVE_API_KEY={API_KEY}"
Environment="HOST_ID={HOST_ID}"
Environment="INTERVAL_SECONDS={INTERVAL}"
{proxy_envs}
[Install]
WantedBy=multi-user.target
"""
    service_path = "/etc/systemd/system/hiai-agent.service"
    try:
        with open(service_path, "w") as f:
            f.write(service_content)
        subprocess.run(["systemctl", "daemon-reload"], check=True)
        subprocess.run(["systemctl", "enable", "--now", "hiai-agent"], check=True)
        print("✅ Đã cài đặt và kích hoạt service systemd: hiai-agent")
        print("   Xem trạng thái: sudo systemctl status hiai-agent")
    except Exception as e:
        print(f"❌ Lỗi khi cài đặt systemd service (cần quyền sudo/root): {e}")

# ── Main Loop ─────────────────────────────────────────────────────────────────

def print_help():
    print("""HiAI Observe Agent for Remote Machine (pail)

Sử dụng:
  python hiai_agent_pail.py [tùy chọn]

Tùy chọn:
  --once               Gửi snapshot 1 lần duy nhất rồi thoát (tiện kiểm tra kết nối)
  --url <URL>          Chỉ định URL của HiAI Observe Server (mặc định: http://localhost:8001)
  --proxy <URL>        Chỉ định Proxy (ví dụ: http://127.0.0.1:1055, hoặc 'none' để tắt)
  --disk-path <path>   Chỉ định đường dẫn ổ đĩa cần giám sát (mặc định: tự động tìm phân vùng được phân chia, vd: /mnt/data/ssd980)
  --quiet, -q          Chế độ im lặng (chỉ in log khi có lỗi kết nối, không spam log)
  --verbose, -v        In đầy đủ từng dòng log mỗi chu kỳ (chế độ cũ)
  --log-every <N>      Số chu kỳ in 1 dòng checkpoint tóm tắt (mặc định: 20 chu kỳ ≈ 5 phút)
  --interval <giây>    Khoảng thời gian giữa các lần gửi (mặc định: 15s)
  --install-service    Cài đặt script thành systemd service tự khởi động
  --help               Hiển thị hướng dẫn này
""")

def main():
    global OBSERVE_URL, INGEST_ENDPOINT, INTERVAL, ACTIVE_PROXY, DISK_PATH, QUIET_MODE, VERBOSE_MODE, HEARTBEAT_TICKS

    args = sys.argv[1:]
    run_once = False

    if "--help" in args or "-h" in args:
        print_help()
        return

    if "--install-service" in args:
        install_systemd_service()
        return

    # Parse CLI flags
    if "--once" in args:
        run_once = True

    if "--url" in args:
        idx = args.index("--url")
        if idx + 1 < len(args):
            OBSERVE_URL = args[idx + 1].rstrip("/")
            INGEST_ENDPOINT = f"{OBSERVE_URL}/api/agent/ingest"
            setup_proxy()

    if "--proxy" in args:
        idx = args.index("--proxy")
        if idx + 1 < len(args):
            setup_proxy(args[idx + 1])

    if "--disk-path" in args:
        idx = args.index("--disk-path")
        if idx + 1 < len(args):
            DISK_PATH = args[idx + 1]

    if "--interval" in args:
        idx = args.index("--interval")
        if idx + 1 < len(args):
            try:
                INTERVAL = int(args[idx + 1])
            except ValueError:
                pass

    if "--quiet" in args or "-q" in args:
        QUIET_MODE = True

    if "--verbose" in args or "-v" in args:
        VERBOSE_MODE = True

    if "--log-every" in args:
        idx = args.index("--log-every")
        if idx + 1 < len(args):
            try:
                HEARTBEAT_TICKS = int(args[idx + 1])
            except ValueError:
                pass

    disk_info = get_disk_stats()
    print("=" * 60)
    print("🚀 HiAI Observe Agent — Khởi động giám sát máy:", HOST_ID)
    print("   🌐 Server Ingest URL :", INGEST_ENDPOINT)
    proxy_display = ACTIVE_PROXY if ACTIVE_PROXY else "Không (Kết nối trực tiếp)"
    print("   🛡️ Proxy Tailscale   :", proxy_display)
    print(f"   💾 Phân vùng ổ đĩa   : {disk_info['path']} ({disk_info['used']}GB/{disk_info['total']}GB - {disk_info['percent']}%)")
    mode_desc = "Im lặng (chỉ báo lỗi)" if QUIET_MODE else ("Chi tiết (từng chu kỳ)" if VERBOSE_MODE else f"Gọn gàng (cập nhật tại chỗ, checkpoint mỗi {HEARTBEAT_TICKS} chu kỳ)")
    print("   📢 Chế độ Log       :", mode_desc)
    print("   ⏱️ Chu kỳ gửi       :", INTERVAL, "giây" if not run_once else "Gửi 1 lần (--once)")
    print("   🔑 API Key          :", API_KEY[:10] + "..." + API_KEY[-4:])
    print("=" * 60)

    success_count = 0
    had_error = False

    while True:
        try:
            snapshot = build_snapshot()
            status, resp = send_snapshot(snapshot)
            hs = snapshot["hostStats"]
            ts = time.strftime("%Y-%m-%d %H:%M:%S")
            ram_u_gb = round(hs.get('memory', 0) / 1024, 1)
            ram_t_gb = round(hs.get('memoryTotal', 0) / 1024, 1)
            ram_pct = hs.get('memoryPercent', 0)
            ram_display = f"{ram_u_gb}GB/{ram_t_gb}GB ({ram_pct}%)" if ram_t_gb else f"{hs['memory']}MB"

            disk_u = hs.get('disk', 0)
            disk_t = hs.get('diskTotal', 0)
            disk_pct = hs.get('diskPercent', 0)
            disk_mount = hs.get('diskMount', '')
            mount_str = f" [{disk_mount}]" if disk_mount else ""
            disk_display = f"{disk_u}GB/{disk_t}GB ({disk_pct}%){mount_str}" if disk_t else f"{disk_u}GB"
            r_rate = hs.get('diskReadRate', 0)
            w_rate = hs.get('diskWriteRate', 0)
            def _fmt_b(b):
                if b >= 1024 * 1024: return f"{b / (1024 * 1024):.1f}MB/s"
                if b >= 1024: return f"{b / 1024:.1f}KB/s"
                return f"{b}B/s"
            io_display = f"IO: R {_fmt_b(r_rate)} / W {_fmt_b(w_rate)}"
            gpu_cnt = len(snapshot.get('gpu') or [])

            if status == 200:
                success_count += 1
                if had_error:
                    print(f"\n[{ts}] 💚 Kết nối tới HiAI Observe đã phục hồi thành công!")
                    had_error = False

                if QUIET_MODE:
                    # Hoàn toàn im lặng khi gửi thành công
                    pass
                elif VERBOSE_MODE:
                    # Ghi từng dòng log mỗi chu kỳ (chế độ chi tiết cũ)
                    print(f"[{ts}] ✅ Đã gửi thành công | CPU: {hs['cpu']}% | RAM: {ram_display} | Disk: {disk_display} | {io_display} | Containers: {len(snapshot['containers'])} | GPUs: {gpu_cnt}")
                else:
                    # Chế độ chống spam thông minh:
                    is_tty = sys.stdout.isatty()
                    msg = f"[{ts}] 🟢 HiAI Observe OK (#{success_count}) | CPU: {hs['cpu']}% | RAM: {ram_display} | Disk: {disk_display} | {io_display} | GPUs: {gpu_cnt}"
                    if success_count == 1:
                        print(f"[{ts}] ✅ Kết nối thành công! Đang giám sát định kỳ mỗi {INTERVAL}s (không spam log)...")
                        if is_tty:
                            sys.stdout.write(f"\r{msg:<115}")
                            sys.stdout.flush()
                    elif success_count % HEARTBEAT_TICKS == 0:
                        # In 1 dòng checkpoint vĩnh viễn mỗi 5 phút (HEARTBEAT_TICKS chu kỳ)
                        if is_tty:
                            sys.stdout.write(f"\r{msg:<115}\n")
                        else:
                            print(msg)
                        sys.stdout.flush()
                    elif is_tty:
                        # Ghi đè trên cùng 1 dòng, không sinh dòng mới trong terminal/tmux
                        sys.stdout.write(f"\r{msg:<115}")
                        sys.stdout.flush()
            else:
                had_error = True
                if sys.stdout.isatty() and not VERBOSE_MODE and not QUIET_MODE:
                    sys.stdout.write("\n")
                if status == 404:
                    print(f"[{ts}] ⚠️ Gửi thất bại [HTTP 404 Not Found]: Endpoint '{INGEST_ENDPOINT}' không tồn tại trên server.")
                    print("      👉 Gợi ý: Kiểm tra lại cổng hoặc URL server HiAI Observe (ví dụ: đang chạy cổng nào trên máy shader).")
                elif status in (401, 403):
                    print(f"[{ts}] ⚠️ Gửi thất bại [HTTP {status}]: API Key không hợp lệ hoặc bị từ chối.")
                elif status == 0:
                    print(f"[{ts}] ⚠️ Gửi thất bại [Lỗi mạng / Timeout]: {resp}")
                    if not ACTIVE_PROXY:
                        print("      👉 Gợi ý: Máy đang không dùng Proxy. Nếu server dùng IP Tailscale, hãy chạy với: --proxy http://127.0.0.1:1055")
                else:
                    print(f"[{ts}] ⚠️ Gửi thất bại [HTTP {status}]: {resp}")

            if run_once:
                break
        except KeyboardInterrupt:
            print("\n👋 Đã dừng agent.")
            break
        except Exception as e:
            print(f"⚠️ Ngoại lệ trong vòng lặp: {e}")
            if run_once:
                break

        time.sleep(INTERVAL)

if __name__ == "__main__":
    main()

