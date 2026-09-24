#!/usr/bin/env python3
"""
Omniverse Tool - Multi-Service Nuclei Security Scanner
Automatically discovers and scans all running services across the entire stack,
or scans a single target if specified.
Saves JSON reports in the same scripts/ folder.

Usage:
    ./scripts/run_nuclei.sh                     # Auto-detects & scans all active services in the stack
    ./scripts/run_nuclei.sh -u http://localhost:8000   # Scan single service
    ./scripts/run_nuclei.sh -s medium,high,critical   # Scan only medium/high/critical issues
"""

import argparse
import datetime
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
from typing import Dict, List, Any, Tuple

# ANSI Colors
C_RED = "\033[91m"
C_YELLOW = "\033[93m"
C_BLUE = "\033[94m"
C_GREEN = "\033[92m"
C_MAGENTA = "\033[95m"
C_CYAN = "\033[96m"
C_BOLD = "\033[1m"
C_RESET = "\033[0m"

SEVERITY_COLORS = {
    "critical": f"{C_BOLD}{C_RED}",
    "high": C_RED,
    "medium": C_YELLOW,
    "low": C_BLUE,
    "info": C_CYAN,
    "unknown": C_RESET,
}

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# Registry of Omniverse Tool services and their ports
STACK_SERVICES = [
    {"name": "Pingora Reverse Proxy", "url": "http://localhost:80", "host": "127.0.0.1", "port": 80},
    {"name": "Gateway Backend API",   "url": "http://localhost:8000", "host": "127.0.0.1", "port": 8000},
    {"name": "Worker yt-dlp",          "url": "http://localhost:8001", "host": "127.0.0.1", "port": 8001},
    {"name": "Worker Whisper",         "url": "http://localhost:8002", "host": "127.0.0.1", "port": 8002},
    {"name": "Worker RMBG",            "url": "http://localhost:8003", "host": "127.0.0.1", "port": 8003},
    {"name": "Worker PixelFixer",      "url": "http://localhost:8004", "host": "127.0.0.1", "port": 8004},
    {"name": "Worker PDF2DOCX",        "url": "http://localhost:8005", "host": "127.0.0.1", "port": 8005},
    {"name": "Worker Upscaler",        "url": "http://localhost:8006", "host": "127.0.0.1", "port": 8006},
    {"name": "Gotenberg Engine",       "url": "http://localhost:3000", "host": "127.0.0.1", "port": 3000},
    {"name": "Frontend UI (Vite Dev)", "url": "http://localhost:5173", "host": "127.0.0.1", "port": 5173},
]


def is_port_open(host: str, port: int, timeout: float = 0.3) -> bool:
    """Quick socket connect check."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(timeout)
            return sock.connect_ex((host, port)) == 0
    except Exception:
        return False


def discover_active_services() -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Check all known services and partition into active and inactive."""
    active = []
    inactive = []
    for svc in STACK_SERVICES:
        if is_port_open(svc["host"], svc["port"]):
            active.append(svc)
        else:
            inactive.append(svc)
    return active, inactive


def find_nuclei_binary() -> str:
    """Locate local nuclei binary or fallback."""
    for candidate in [
        shutil.which("nuclei"),
        os.path.expanduser("~/.local/bin/nuclei"),
        "/usr/local/bin/nuclei",
        "/usr/bin/nuclei",
    ]:
        if candidate and os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    return ""


def check_docker_available() -> bool:
    docker_bin = shutil.which("docker")
    if not docker_bin:
        return False
    try:
        res = subprocess.run([docker_bin, "--version"], capture_output=True, text=True, timeout=5)
        return res.returncode == 0
    except Exception:
        return False


def parse_args():
    parser = argparse.ArgumentParser(
        description="Run on-demand Nuclei security scan for entire Omniverse Tool stack."
    )
    parser.add_argument(
        "-u", "--target",
        default="http://localhost:80",
        help="Target URL to scan (default: http://localhost:80 - Pingora Gateway).",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Probe and scan ALL active services across localhost (all ports).",
    )
    parser.add_argument(
        "-t", "--tags",
        default="api,misconfig,exposure,cve,ssrf,cors,traversal,token",
        help="Comma-separated template tags (default: api,misconfig,exposure,cve,ssrf,cors,traversal,token)",
    )
    parser.add_argument(
        "-s", "--severity",
        default="critical,high,medium,low,info",
        help="Severities to scan (default: critical,high,medium,low,info)",
    )
    parser.add_argument(
        "--rate-limit",
        type=int,
        default=150,
        help="Maximum requests per second (default: 150)",
    )
    parser.add_argument(
        "-c", "--concurrency",
        type=int,
        default=25,
        help="Number of concurrent templates to run (default: 25)",
    )
    parser.add_argument(
        "--docker",
        action="store_true",
        help="Force using Docker container (projectdiscovery/nuclei) instead of local binary",
    )
    parser.add_argument(
        "--update-templates",
        action="store_true",
        help="Update Nuclei templates before scanning",
    )
    parser.add_argument(
        "-o", "--output",
        default="",
        help="Custom output JSON filename inside scripts/ (optional)",
    )
    return parser.parse_args()


def run_scan():
    args = parse_args()
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")

    if args.output:
        json_filename = args.output if args.output.endswith(".json") else f"{args.output}.json"
        json_path = os.path.join(SCRIPT_DIR, os.path.basename(json_filename))
    else:
        json_path = os.path.join(SCRIPT_DIR, f"nuclei_scan_{timestamp}.json")
    
    latest_symlink = os.path.join(SCRIPT_DIR, "nuclei_scan_latest.json")

    nuclei_bin = find_nuclei_binary()
    use_docker = args.docker or not nuclei_bin

    if not nuclei_bin and not check_docker_available():
        print(f"{C_RED}[!] Error: Neither local 'nuclei' binary nor 'docker' is available.{C_RESET}")
        print("Please install Nuclei or start Docker.")
        sys.exit(1)

    print(f"\n{C_BOLD}{C_MAGENTA}======================================================{C_RESET}")
    print(f"{C_BOLD}{C_MAGENTA}     Omniverse Tool - Full Stack Nuclei Scanner      {C_RESET}")
    print(f"{C_BOLD}{C_MAGENTA}======================================================{C_RESET}")

    targets_to_scan: List[str] = []
    
    # Target resolution: Default to port 80 (Pingora) unless --all is specified
    if args.all:
        print(f"{C_CYAN}[*] Mode           :{C_RESET} {C_BOLD}Automatic Multi-Service Discovery (--all){C_RESET}")
        print(f"[*] Probing Omniverse services...")
        active_svcs, inactive_svcs = discover_active_services()

        for svc in active_svcs:
            print(f"  {C_GREEN}✔ [ONLINE]{C_RESET}  {svc['name']:<24} -> {svc['url']}")
            targets_to_scan.append(svc["url"])

        for svc in inactive_svcs:
            print(f"  {C_YELLOW}✖ [OFFLINE]{C_RESET} {svc['name']:<24} (Port {svc['port']} not responding)")

        if not targets_to_scan:
            print(f"\n{C_RED}[!] Error: No active services detected on localhost!{C_RESET}")
            print(f"{C_YELLOW}[!] Please start your system first (e.g. run './start' or 'docker compose up').{C_RESET}")
            sys.exit(1)
    else:
        targets_to_scan = [args.target]
        print(f"{C_CYAN}[*] Mode           :{C_RESET} Target -> {args.target}")

    print(f"\n{C_CYAN}[*] Targets Count  :{C_RESET} {len(targets_to_scan)} endpoint(s)")
    print(f"{C_CYAN}[*] Tags           :{C_RESET} {args.tags}")
    print(f"{C_CYAN}[*] Severities     :{C_RESET} {args.severity}")
    print(f"{C_CYAN}[*] JSON Output    :{C_RESET} {json_path}")
    print(f"{C_CYAN}[*] Engine Mode    :{C_RESET} {'Docker (projectdiscovery/nuclei)' if use_docker else f'Local binary ({nuclei_bin})'}")
    print("-" * 54)

    # Prepare targets file
    targets_file = os.path.join(SCRIPT_DIR, ".nuclei_targets_tmp.txt")
    with open(targets_file, "w", encoding="utf-8") as f:
        for t in targets_to_scan:
            f.write(t + "\n")

    # Build command
    if not use_docker:
        cmd = [
            nuclei_bin,
            "-list", targets_file,
            "-tags", args.tags,
            "-severity", args.severity,
            "-rate-limit", str(args.rate_limit),
            "-c", str(args.concurrency),
            "-json-export", json_path,
        ]
        if args.update_templates:
            print(f"{C_YELLOW}[*] Updating Nuclei templates...{C_RESET}")
            subprocess.run([nuclei_bin, "-ut"], check=False)
    else:
        # Docker execution mode
        cmd = [
            "docker", "run", "--rm",
            "--net=host",
            "-v", f"{SCRIPT_DIR}:/reports",
            "projectdiscovery/nuclei:latest",
            "-list", f"/reports/{os.path.basename(targets_file)}",
            "-tags", args.tags,
            "-severity", args.severity,
            "-rate-limit", str(args.rate_limit),
            "-c", str(args.concurrency),
            "-json-export", f"/reports/{os.path.basename(json_path)}",
        ]

    print(f"{C_GREEN}[+] Starting Nuclei vulnerability scan...{C_RESET}\n")
    try:
        subprocess.run(cmd)
    except KeyboardInterrupt:
        print(f"\n{C_YELLOW}[!] Scan interrupted by user.{C_RESET}")
    finally:
        if os.path.exists(targets_file):
            try:
                os.remove(targets_file)
            except Exception:
                pass

    # Read and parse results
    findings: List[Dict[str, Any]] = []
    if os.path.exists(json_path):
        with open(json_path, "r", encoding="utf-8") as f:
            raw_content = f.read().strip()
            if raw_content:
                try:
                    parsed = json.loads(raw_content)
                    if isinstance(parsed, list):
                        findings = parsed
                    elif isinstance(parsed, dict):
                        findings = [parsed]
                except json.JSONDecodeError:
                    for line in raw_content.splitlines():
                        line = line.strip()
                        if line:
                            try:
                                findings.append(json.loads(line))
                            except Exception:
                                pass

        try:
            shutil.copyfile(json_path, latest_symlink)
        except Exception:
            pass

    # Print summary
    print("\n" + "=" * 54)
    print(f"{C_BOLD}Scan Completed. Report Summary:{C_RESET}")
    print("=" * 54)

    counts = {"critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0, "unknown": 0}
    for item in findings:
        info = item.get("info", {})
        sev = str(info.get("severity", "unknown")).lower()
        counts[sev] = counts.get(sev, 0) + 1

    total_findings = len(findings)
    print(f"Total Findings Across Entire Stack: {C_BOLD}{total_findings}{C_RESET}")
    for sev in ["critical", "high", "medium", "low", "info"]:
        count = counts.get(sev, 0)
        color = SEVERITY_COLORS.get(sev, C_RESET)
        print(f"  - {color}{sev.upper():<8}{C_RESET}: {count}")

    if total_findings > 0:
        print("\n" + "-" * 54)
        print(f"{C_BOLD}Discovered Vulnerabilities Detail:{C_RESET}")
        print("-" * 54)
        for i, item in enumerate(findings[:30], 1):
            t_id = item.get("template-id", "unknown")
            info = item.get("info", {})
            name = info.get("name", t_id)
            sev = str(info.get("severity", "unknown")).lower()
            matched = item.get("matched-at", item.get("host", ""))
            color = SEVERITY_COLORS.get(sev, C_RESET)
            print(f"[{i:02d}] {color}[{sev.upper()}]{C_RESET} {C_BOLD}{name}{C_RESET} ({t_id})")
            print(f"     Target: {matched}")
        if total_findings > 30:
            print(f"... and {total_findings - 30} more findings. See JSON file.")

    print("\n" + "=" * 54)
    print(f"{C_GREEN}✔ Full-stack report saved to:{C_RESET} {json_path}")
    print(f"{C_GREEN}✔ Latest symlink            :{C_RESET} {latest_symlink}")
    print("=" * 54 + "\n")


if __name__ == "__main__":
    run_scan()
