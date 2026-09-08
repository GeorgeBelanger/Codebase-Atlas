#!/usr/bin/env bash
# Usage: recon.sh REPO [--json] [--exclude GLOB ...]
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "$SCRIPT_DIR/recon.py" "$@"
