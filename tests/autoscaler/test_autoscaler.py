#!/usr/bin/env python3
"""
Unit tests runner for Golang Docker Swarm Autoscaler.
Executes the comprehensive 5-scenario test suite in Go container.
"""

import os
import subprocess
import unittest


class TestAutoscaler(unittest.TestCase):
    def test_autoscaler_go_unit_suite(self):
        """Chạy toàn bộ bộ kiểm thử Go: Max/P95 CPU, First Sample, Non-blocking Cooldown, Deduplication, Safe GC"""
        workspace_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
        autoscaler_dir = os.path.join(workspace_dir, "autoscaler")

        cmd = [
            "docker", "run", "--rm",
            "-v", f"{autoscaler_dir}:/app",
            "-w", "/app",
            "golang:1.22-alpine",
            "go", "test", "-v", "./..."
        ]

        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=60)
        print("\n" + result.stdout)
        if result.stderr:
            print(result.stderr)

        self.assertEqual(result.returncode, 0, f"Autoscaler Go test thất bại: {result.stderr or result.stdout}")
        self.assertIn("PASS", result.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)
