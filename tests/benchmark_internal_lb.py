#!/usr/bin/env python3
"""
BENCHMARK & SO SÁNH HIỆU NĂNG THUẬT TOÁN LOAD BALANCING TẦNG NỘI BỘ
1. Baseline: Round-Robin (Docker Swarm VIP / L4 Load Balancer)
2. Advanced: P2C + Peak-EWMA (Power of Two Choices + Exponentially Weighted Moving Average)

Mô phỏng và đo lường sự phân phối tải, thời gian phản hồi (Mean, P50, P90, P95, P99),
và khả năng xử lý bất đồng bộ khi các Gotenberg worker có tải không đồng đều.
"""

import argparse
import asyncio
import math
import random
import statistics
import time
from typing import Dict, List, Tuple


# =====================================================================
# 1. MÔ PHỎNG GOTENBERG WORKER NODE (HETEROGENEOUS WORKLOAD)
# =====================================================================
class SimulatedWorkerNode:
    def __init__(self, node_id: str, base_latency_ms: float, contention_factor: float = 1.2):
        self.node_id = node_id
        self.base_latency_ms = base_latency_ms
        self.contention_factor = contention_factor
        self.active_jobs = 0
        self.total_processed = 0

    async def process_task(self) -> float:
        """
        Mô phỏng xử lý tài liệu (Office/HTML/PDF).
        Khi node có nhiều active_jobs, thời gian xử lý tăng lên do cạnh tranh CPU/RAM.
        """
        self.active_jobs += 1
        self.total_processed += 1

        # Độ trễ cơ bản có dao động ngẫu nhiên (jitter)
        jitter = random.uniform(0.85, 1.25)
        # Hệ số quá tải khi có nhiều job chạy đồng thời trên cùng 1 container
        concurrency_penalty = 1.0 + (self.active_jobs - 1) * (self.contention_factor * 0.15)
        simulated_duration_ms = self.base_latency_ms * jitter * concurrency_penalty

        # Ngủ bất đồng bộ mô phỏng I/O và CPU compute của Gotenberg
        await asyncio.sleep(simulated_duration_ms / 1000.0)

        self.active_jobs = max(0, self.active_jobs - 1)
        return simulated_duration_ms


# =====================================================================
# 2. THUẬT TOÁN 1: ROUND-ROBIN (MẶC ĐỊNH SWARM VIP)
# =====================================================================
class RoundRobinLB:
    def __init__(self, nodes: List[SimulatedWorkerNode]):
        self.nodes = nodes
        self.index = 0
        self.lock = asyncio.Lock()

    async def select_node(self) -> SimulatedWorkerNode:
        async with self.lock:
            selected = self.nodes[self.index % len(self.nodes)]
            self.index += 1
            return selected

    async def record_completion(self, node: SimulatedWorkerNode, elapsed_ms: float):
        # Round Robin không cần ghi nhận trạng thái phản hồi
        pass


# =====================================================================
# 3. THUẬT TOÁN 2: P2C + PEAK-EWMA
# =====================================================================
class P2CPeakEWMALB:
    def __init__(self, nodes: List[SimulatedWorkerNode], alpha: float = 0.2, initial_ewma_ms: float = 20.0):
        self.nodes = nodes
        self.alpha = alpha
        self.lock = asyncio.Lock()
        
        # State tracking cho từng node
        self.active_conns: Dict[str, int] = {n.node_id: 0 for n in nodes}
        self.ewma_latency: Dict[str, float] = {n.node_id: initial_ewma_ms for n in nodes}

    async def select_node(self) -> SimulatedWorkerNode:
        async with self.lock:
            num_nodes = len(self.nodes)
            if num_nodes < 2:
                selected = self.nodes[0]
            else:
                # 1. P2C: Bốc ngẫu nhiên 2 node ứng viên
                idx1 = random.randint(0, num_nodes - 1)
                idx2 = random.randint(0, num_nodes - 1)
                while idx2 == idx1:
                    idx2 = random.randint(0, num_nodes - 1)

                node1 = self.nodes[idx1]
                node2 = self.nodes[idx2]

                # 2. Chấm điểm Peak-EWMA Score = (ActiveConns + 1) * EWMA_Latency
                score1 = (self.active_conns[node1.node_id] + 1) * self.ewma_latency[node1.node_id]
                score2 = (self.active_conns[node2.node_id] + 1) * self.ewma_latency[node2.node_id]

                selected = node1 if score1 <= score2 else node2

            # Ghi nhận kết nối đang hoạt động
            self.active_conns[selected.node_id] += 1
            return selected

    async def record_completion(self, node: SimulatedWorkerNode, elapsed_ms: float):
        async with self.lock:
            # Giảm active connections
            self.active_conns[node.node_id] = max(0, self.active_conns[node.node_id] - 1)
            # Cập nhật EWMA theo công thức trượt
            curr_ewma = self.ewma_latency[node.node_id]
            self.ewma_latency[node.node_id] = self.alpha * elapsed_ms + (1.0 - self.alpha) * curr_ewma


# =====================================================================
# 4. TRÌNH ĐIỀU PHỐI BENCHMARK & TÍNH TOÁN CHỈ SỐ
# =====================================================================
class BenchmarkResult:
    def __init__(self, name: str, latencies: List[float], total_time_sec: float, node_distribution: Dict[str, int]):
        self.name = name
        self.latencies = sorted(latencies)
        self.total_requests = len(latencies)
        self.total_time_sec = total_time_sec
        self.rps = self.total_requests / total_time_sec if total_time_sec > 0 else 0
        self.node_distribution = node_distribution

        self.min_lat = min(self.latencies) if self.latencies else 0
        self.max_lat = max(self.latencies) if self.latencies else 0
        self.mean_lat = statistics.mean(self.latencies) if self.latencies else 0
        self.std_dev = statistics.stdev(self.latencies) if len(self.latencies) > 1 else 0

        self.p50 = self._percentile(50)
        self.p90 = self._percentile(90)
        self.p95 = self._percentile(95)
        self.p99 = self._percentile(99)

    def _percentile(self, p: float) -> float:
        if not self.latencies:
            return 0.0
        k = (len(self.latencies) - 1) * (p / 100.0)
        f = math.floor(k)
        c = math.ceil(k)
        if f == c:
            return self.latencies[int(k)]
        d0 = self.latencies[int(f)] * (c - k)
        d1 = self.latencies[int(c)] * (k - f)
        return d0 + d1


async def run_benchmark(lb_name: str, lb_instance, num_requests: int, concurrency: int) -> BenchmarkResult:
    semaphore = asyncio.Semaphore(concurrency)
    latencies: List[float] = []
    node_counts: Dict[str, int] = {}

    async def worker():
        async with semaphore:
            start = time.perf_counter()
            node = await lb_instance.select_node()
            elapsed_ms = await node.process_task()
            await lb_instance.record_completion(node, elapsed_ms)
            total_elapsed_ms = (time.perf_counter() - start) * 1000.0
            latencies.append(total_elapsed_ms)
            node_counts[node.node_id] = node_counts.get(node.node_id, 0) + 1

    t0 = time.perf_counter()
    tasks = [asyncio.create_task(worker()) for _ in range(num_requests)]
    await asyncio.gather(*tasks)
    total_time = time.perf_counter() - t0

    return BenchmarkResult(lb_name, latencies, total_time, node_counts)


def print_comparison_table(res_rr: BenchmarkResult, res_p2c: BenchmarkResult, num_nodes: int):
    diff_p95 = ((res_p2c.p95 - res_rr.p95) / res_rr.p95) * 100.0
    diff_p99 = ((res_p2c.p99 - res_rr.p99) / res_rr.p99) * 100.0
    diff_mean = ((res_p2c.mean_lat - res_rr.mean_lat) / res_rr.mean_lat) * 100.0
    diff_rps = ((res_p2c.rps - res_rr.rps) / res_rr.rps) * 100.0

    print("\n" + "=" * 78)
    print(f"       KẾT QUẢ SO SÁNH HIỆU NĂNG TẢI NỘI BỘ ({num_nodes} GOTENBERG WORKERS)")
    print("=" * 78)
    print(f"{'Chỉ số đo lường (Metrics)':<32} | {'Round-Robin (Hiện tại)':<20} | {'P2C + Peak-EWMA':<18}")
    print("-" * 78)
    print(f"{'Tổng số Requests':<32} | {res_rr.total_requests:<20} | {res_p2c.total_requests:<18}")
    print(f"{'Tổng thời gian thực thi':<32} | {res_rr.total_time_sec:<17.3f} s | {res_p2c.total_time_sec:<15.3f} s")
    print(f"{'Throughput (Req/giây)':<32} | {res_rr.rps:<17.1f}   | \033[92m{res_p2c.rps:<15.1f} ({diff_rps:+.1f}%)\033[0m")
    print("-" * 78)
    print(f"{'Độ trễ trung bình (Mean)':<32} | {res_rr.mean_lat:<17.2f} ms | \033[92m{res_p2c.mean_lat:<15.2f} ms ({diff_mean:+.1f}%)\033[0m")
    print(f"{'Độ trễ P50 (Median)':<32} | {res_rr.p50:<17.2f} ms | {res_p2c.p50:<15.2f} ms")
    print(f"{'Độ trễ P90':<32} | {res_rr.p90:<17.2f} ms | \033[92m{res_p2c.p90:<15.2f} ms\033[0m")
    print(f"{'Độ trễ P95 (High Load)':<32} | {res_rr.p95:<17.2f} ms | \033[92m{res_p2c.p95:<15.2f} ms ({diff_p95:+.1f}%)\033[0m")
    print(f"{'Độ trễ P99 (Tail Latency)':<32} | {res_rr.p99:<17.2f} ms | \033[92m{res_p2c.p99:<15.2f} ms ({diff_p99:+.1f}%)\033[0m")
    print(f"{'Độ lệch chuẩn (Std Dev)':<32} | {res_rr.std_dev:<17.2f} ms | {res_p2c.std_dev:<15.2f} ms")
    print("=" * 78)

    print("\n📊 PHÂN PHỐI TẢI THỰC TẾ TRÊN TỪNG WORKER:")
    print("-" * 78)
    for node_id in sorted(res_rr.node_distribution.keys()):
        rr_cnt = res_rr.node_distribution.get(node_id, 0)
        p2c_cnt = res_p2c.node_distribution.get(node_id, 0)
        print(f"  • {node_id:<22} ➔ Round-Robin: {rr_cnt:>5} reqs | P2C+EWMA: {p2c_cnt:>5} reqs")
    print("=" * 78)

    print("\n💡 ĐÁNH GIÁ & KẾT LUẬN:")
    if diff_p99 < 0:
        print(f"  ✅ P2C + Peak-EWMA giúp giảm Tail Latency P99 tới \033[92m{abs(diff_p99):.1f}%\033[0m so với Round-Robin.")
    if diff_rps > 0:
        print(f"  ✅ Throughput tổng thể tăng \033[92m{diff_rps:.1f}%\033[0m nhờ tự động tránh các container đang bị nghẽn LibreOffice/Chromium.")
    print("  ✅ Round-Robin phân phối đều số lượng nhưng bỏ qua trạng thái quá tải của từng worker.")
    print("  ✅ P2C + Peak-EWMA định tuyến thông minh dựa trên cả kết nối đang mở và thời gian trễ thực tế.\n")


# =====================================================================
# 5. ENTRYPOINT CHÍNH
# =====================================================================
async def main():
    parser = argparse.ArgumentParser(description="Benchmark Load Balancing Algorithms: Round-Robin vs P2C + Peak-EWMA")
    parser.add_argument("--requests", type=int, default=1500, help="Tổng số request kiểm thử (mặc định: 1500)")
    parser.add_argument("--concurrency", type=int, default=40, help="Mức độ đồng thời (mặc định: 40)")
    parser.add_argument("--workers", type=int, default=4, help="Số lượng Gotenberg Worker (mặc định: 4)")
    args = parser.parse_args()

    print("=" * 78)
    print("      KHỞI ĐỘNG BENCHMARK SO SÁNH THUẬT TOÁN LOAD BALANCING NỘI BỘ")
    print("=" * 78)
    print(f"⚙️  Cấu hình: {args.requests} Requests | Concurrency: {args.concurrency} | {args.workers} Gotenberg Workers")

    # Tạo cụm workers mô phỏng với tải không đồng đều (Heterogeneous Gotenberg Workload)
    # Ví dụ: Worker-1, Worker-2 xử lý nhanh; Worker-3, Worker-4 đang gánh các tác vụ nặng (LibreOffice/Chromium)
    base_latencies = [25.0, 30.0, 75.0, 110.0]
    
    # 1. Chạy bài test với Round-Robin
    nodes_rr = [
        SimulatedWorkerNode(f"gotenberg-worker-{i+1}", base_latencies[i % len(base_latencies)])
        for i in range(args.workers)
    ]
    lb_rr = RoundRobinLB(nodes_rr)
    print("\n⏳ [1/2] Đang chạy kiểm thử với thuật toán: Round-Robin (Baseline)...")
    res_rr = await run_benchmark("Round-Robin", lb_rr, args.requests, args.concurrency)

    # 2. Chạy bài test với P2C + Peak-EWMA
    nodes_p2c = [
        SimulatedWorkerNode(f"gotenberg-worker-{i+1}", base_latencies[i % len(base_latencies)])
        for i in range(args.workers)
    ]
    lb_p2c = P2CPeakEWMALB(nodes_p2c, alpha=0.2, initial_ewma_ms=30.0)
    print("⏳ [2/2] Đang chạy kiểm thử với thuật toán: P2C + Peak-EWMA...")
    res_p2c = await run_benchmark("P2C + Peak-EWMA", lb_p2c, args.requests, args.concurrency)

    # 3. Xuất bảng so sánh
    print_comparison_table(res_rr, res_p2c, args.workers)


if __name__ == "__main__":
    asyncio.run(main())
