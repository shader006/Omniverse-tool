#!/usr/bin/env bash
# Omniverse Tool - Fast Nuclei Scanner Runner
# Runs the scan and outputs JSON in this same folder (scripts/)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

python3 "$SCRIPT_DIR/run_nuclei_scan.py" "$@"
