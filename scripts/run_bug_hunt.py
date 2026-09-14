#!/usr/bin/env python3
"""
Omniverse Tool - Automated Bug Hunting & Security Audit Pipeline
Executes a multi-layer scan:
  - Source Code & Secrets: Gitleaks + Semgrep
  - Endpoint & Logic: Nuclei
  - Runtime: Docker/Process Log Inspector
  - Generates comprehensive markdown report with PoCs and patch suggestions.
"""

import argparse
import datetime
import json
import os
import shutil
import subprocess
import sys
from typing import Dict, List, Any

GITLEAKS_BIN = shutil.which("gitleaks") or os.path.expanduser("~/.local/bin/gitleaks")
NUCLEI_BIN = shutil.which("nuclei") or os.path.expanduser("~/.local/bin/nuclei")
SEMGREP_BIN = shutil.which("semgrep") or os.path.expanduser("~/.local/bin/semgrep")


def check_prerequisites():
    missing = []
    for name, path in [("gitleaks", GITLEAKS_BIN), ("nuclei", NUCLEI_BIN), ("semgrep", SEMGREP_BIN)]:
        if not shutil.which(path) and not os.path.exists(path):
            missing.append(name)
    if missing:
        print(f"[-] Warning: Missing binaries: {', '.join(missing)}")
    return len(missing) == 0


def run_gitleaks(target_dir: str) -> List[Dict[str, Any]]:
    print("[+] [Stage 1/3] Running Gitleaks (Secret Leak Scanning)...")
    cmd = [
        GITLEAKS_BIN,
        "detect",
        "--source", target_dir,
        "--report-format", "json",
        "--exit-code", "0"
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        findings = []
        if proc.stdout.strip():
            try:
                findings = json.loads(proc.stdout)
            except Exception:
                pass
        print(f"    -> Gitleaks found {len(findings)} potential secret leaks.")
        return findings
    except Exception as e:
        print(f"[-] Gitleaks error: {e}")
        return []


def run_semgrep(target_dir: str, config: str = "p/security-audit") -> List[Dict[str, Any]]:
    print(f"[+] [Stage 1/3] Running Semgrep SAST ({config})...")
    cmd = [
        SEMGREP_BIN,
        "scan",
        "--config", config,
        "--json",
        target_dir
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        findings = []
        if proc.stdout.strip():
            try:
                data = json.loads(proc.stdout)
                findings = data.get("results", [])
            except Exception:
                pass
        print(f"    -> Semgrep found {len(findings)} code issues.")
        return findings
    except Exception as e:
        print(f"[-] Semgrep error: {e}")
        return []


def run_nuclei(target_url: str, tags: str = "cve,exposure,misconfig") -> List[Dict[str, Any]]:
    if not target_url:
        print("[*] [Stage 2/3] Skipping Nuclei (No target URL provided).")
        return []
    print(f"[+] [Stage 2/3] Running Nuclei DAST against {target_url}...")
    temp_json = "/tmp/nuclei_run_results.json"
    if os.path.exists(temp_json):
        try:
            os.remove(temp_json)
        except Exception:
            pass

    cmd = [
        NUCLEI_BIN,
        "-u", target_url,
        "-tags", tags,
        "-severity", "critical,high,medium,low",
        "-json-export", temp_json,
        "-silent"
    ]
    findings = []
    try:
        subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        if os.path.exists(temp_json):
            with open(temp_json, "r", encoding="utf-8") as f:
                content = f.read().strip()
                if content:
                    try:
                        parsed = json.loads(content)
                        if isinstance(parsed, list):
                            findings.extend(parsed)
                        elif isinstance(parsed, dict):
                            findings.append(parsed)
                    except Exception:
                        for line in content.splitlines():
                            if line.strip():
                                try:
                                    p = json.loads(line.strip())
                                    if isinstance(p, list):
                                        findings.extend(p)
                                    elif isinstance(p, dict):
                                        findings.append(p)
                                except Exception:
                                    pass
            try:
                os.remove(temp_json)
            except Exception:
                pass
        print(f"    -> Nuclei found {len(findings)} endpoint issues.")
        return findings
    except Exception as e:
        print(f"[-] Nuclei error: {e}")
        return []


def inspect_logs(compose_dir: str) -> List[str]:
    print("[+] [Stage 3/3] Inspecting runtime logs...")
    issues = []
    # Check docker compose logs if docker is available
    if shutil.which("docker"):
        try:
            proc = subprocess.run(
                ["docker", "compose", "logs", "--tail=150"],
                cwd=compose_dir,
                capture_output=True,
                text=True,
                timeout=15
            )
            for line in proc.stdout.split("\n") + proc.stderr.split("\n"):
                lower = line.lower()
                if any(err in lower for err in ["panic:", "fatal:", "traceback (most recent", "unhandled exception", "critical:"]):
                    issues.append(line.strip())
        except Exception:
            pass
    print(f"    -> Identified {len(issues)} runtime warning/error log lines.")
    return issues


def generate_markdown_report(
    target_dir: str,
    target_url: str,
    gitleaks_results: List[Dict[str, Any]],
    semgrep_results: List[Dict[str, Any]],
    nuclei_results: List[Dict[str, Any]],
    runtime_logs: List[str],
    output_path: str
):
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    # Calculate severities
    crit = 0
    high = 0
    med = 0
    low = 0

    for r in semgrep_results:
        sev = r.get("extra", {}).get("severity", "INFO").upper()
        if sev == "ERROR":
            high += 1
        elif sev == "WARNING":
            med += 1
        else:
            low += 1

    for r in nuclei_results:
        sev = r.get("info", {}).get("severity", "info").lower()
        if sev == "critical":
            crit += 1
        elif sev == "high":
            high += 1
        elif sev == "medium":
            med += 1
        else:
            low += 1

    if gitleaks_results:
        high += len(gitleaks_results)

    total_issues = len(gitleaks_results) + len(semgrep_results) + len(nuclei_results) + (1 if runtime_logs else 0)

    lines = [
        f"# Báo Cáo Săn Bug & Kiểm Tra An Ninh Dự Án",
        f"**Thời gian thực hiện**: `{timestamp}`  ",
        f"**Thư mục quét**: `{os.path.abspath(target_dir)}`  ",
        f"**Endpoint kiểm thử**: `{target_url if target_url else 'N/A'}`  ",
        "",
        "## 1. Tổng quan rủi ro (Executive Summary)",
        "",
        f"| Mức độ | Số lượng |",
        f"| :--- | :--- |",
        f"| 🔴 **CRITICAL** | `{crit}` |",
        f"| 🟠 **HIGH** | `{high}` |",
        f"| 🟡 **MEDIUM** | `{med}` |",
        f"| 🔵 **LOW / INFO** | `{low}` |",
        f"| **Tổng số phát hiện** | **`{total_issues}`** |",
        "",
        "---",
        "",
        "## 2. Chi tiết Lỗ hổng Mã nguồn & Secret Leak",
        ""
    ]

    if gitleaks_results:
        lines.append("### 2.1. Rò rỉ Secret & Credentials (Gitleaks)")
        for idx, item in enumerate(gitleaks_results[:15], 1):
            rule = item.get("RuleID", "Unknown")
            fpath = item.get("File", "Unknown")
            line = item.get("StartLine", "?")
            secret = item.get("Secret", "")
            masked = secret[:4] + "***" + secret[-4:] if len(secret) > 8 else "***"
            lines.append(f"- **{idx}. [{rule}]** tại `{fpath}:{line}` - Key masked: `{masked}`")
        if len(gitleaks_results) > 15:
            lines.append(f"- *... còn {len(gitleaks_results) - 15} phát hiện khác.*")
        lines.append("")
    else:
        lines.append("### 2.1. Rò rỉ Secret: ✅ Không phát hiện secret lộ lọt.")
        lines.append("")

    if semgrep_results:
        lines.append("### 2.2. Lỗ hổng Mã nguồn tĩnh (Semgrep SAST)")
        for idx, item in enumerate(semgrep_results[:20], 1):
            check_id = item.get("check_id", "Unknown")
            fpath = item.get("path", "Unknown")
            line = item.get("start", {}).get("line", "?")
            extra = item.get("extra", {})
            msg = extra.get("message", "").split("\n")[0]
            sev = extra.get("severity", "INFO")
            lines.append(f"- **{idx}. [{sev}] `{check_id}`** tại `{fpath}:{line}`: {msg}")
        if len(semgrep_results) > 20:
            lines.append(f"- *... còn {len(semgrep_results) - 20} cảnh báo khác.*")
        lines.append("")
    else:
        lines.append("### 2.2. Lỗ hổng Mã nguồn: ✅ Không phát hiện lỗ hổng SAST nghiêm trọng.")
        lines.append("")

    lines.append("---")
    lines.append("## 3. Lỗ hổng Endpoint & DAST (Nuclei)")
    lines.append("")
    if nuclei_results:
        for idx, item in enumerate(nuclei_results[:15], 1):
            info = item.get("info", {})
            name = info.get("name", item.get("template-id", "Unknown"))
            sev = info.get("severity", "info").upper()
            matched = item.get("matched-at", target_url)
            lines.append(f"- **{idx}. [{sev}] {name}** - `{matched}`")
        lines.append("")
    else:
        lines.append("✅ Không phát hiện lỗ hổng endpoint nào qua Nuclei templates.")
        lines.append("")

    if runtime_logs:
        lines.append("---")
        lines.append("## 4. Cảnh báo Runtime & Exception (Logs / Sentry)")
        lines.append("")
        lines.append("```text")
        for log in runtime_logs[:15]:
            lines.append(log)
        lines.append("```")
        lines.append("")

    lines.append("---")
    lines.append("## 5. Đề xuất Bản vá (Remediation & Action Plan)")
    lines.append("")
    lines.append("1. **Quản lý biến môi trường**: Di chuyển toàn bộ secret/hardcoded token vào file `.env` (được đưa vào `.gitignore`).")
    lines.append("2. **Xử lý Input Sanitization**: Đối với các cảnh báo injection, sử dụng parameterized query hoặc validate strict schema trước khi chuyển tiếp.")
    lines.append("3. **Cấu hình Security Headers**: Đảm bảo các response từ gateway/reverse proxy có đầy đủ `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` và Content Security Policy.")
    lines.append("")

    content = "\n".join(lines)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"[+] Báo cáo săn bug đã được lưu thành công tại: {output_path}")


def main():
    parser = argparse.ArgumentParser(description="Omniverse Bug Hunter & Security Audit Runner")
    parser.add_argument("--target", default=".", help="Target project directory to scan")
    parser.add_argument("--url", default="", help="Target web/API URL for DAST scanning (optional)")
    parser.add_argument("--output", default="bug_report.md", help="Output markdown report file")
    args = parser.parse_args()

    check_prerequisites()
    
    gitleaks_res = run_gitleaks(args.target)
    semgrep_res = run_semgrep(args.target, config="p/security-audit")
    nuclei_res = run_nuclei(args.url) if args.url else []
    runtime_res = inspect_logs(args.target)

    generate_markdown_report(
        target_dir=args.target,
        target_url=args.url,
        gitleaks_results=gitleaks_res,
        semgrep_results=semgrep_res,
        nuclei_results=nuclei_res,
        runtime_logs=runtime_res,
        output_path=args.output
    )


if __name__ == "__main__":
    main()
