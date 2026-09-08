#!/usr/bin/env bash
# Usage: shoot.sh <file.html> [outdir]. Each run gets a fresh shots.XXXXXX folder.
set -euo pipefail
if [ "$#" -lt 1 ] || [ ! -f "$1" ]; then echo 'Usage: shoot.sh <existing file.html> [outdir]' >&2; exit 2; fi
F="$(python3 -c 'import os,sys; print(os.path.abspath(sys.argv[1]))' "$1")"
D="$(dirname "$F")"
B="$(basename "$F")"
O="${2:-$D}"
CH="${CHROME_BIN:-}"
if [ -z "$CH" ]; then
  for CANDIDATE in chromium chromium-browser google-chrome google-chrome-stable; do
    if CH="$(command -v "$CANDIDATE")"; then break; fi
  done
fi
if [ -z "$CH" ]; then
  for CANDIDATE in "$HOME"/.cache/ms-playwright/chromium-*/chrome-linux*/chrome '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; do
    if [ -x "$CANDIDATE" ]; then CH="$CANDIDATE"; break; fi
  done
fi
if [ -z "$CH" ] || [ ! -x "$CH" ]; then echo 'No Chromium found; no screenshots taken (nothing installed).' >&2; exit 3; fi
mkdir -p "$O"
RUN="$(mktemp -d "$O/shots.XXXXXX")"
RUN="$(cd "$RUN" && pwd)"
SRV=''
cleanup() {
  if [ -n "$SRV" ]; then kill "$SRV" 2>/dev/null || true; wait "$SRV" 2>/dev/null || true; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# The OS selects a free port; the readiness file is written after binding.
python3 -u -c '
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import partial
from pathlib import Path
import sys
server = ThreadingHTTPServer(("127.0.0.1", 0), partial(SimpleHTTPRequestHandler, directory=sys.argv[1]))
Path(sys.argv[2]).write_text(str(server.server_port))
server.serve_forever()
' "$D" "$RUN/port" >"$RUN/server.log" 2>&1 &
SRV=$!
READY=0
for ((ATTEMPT=0; ATTEMPT<50; ATTEMPT++)); do
  if ! kill -0 "$SRV" 2>/dev/null; then echo "Screenshot server failed; see $RUN/server.log" >&2; exit 1; fi
  if [ -s "$RUN/port" ]; then READY=1; break; fi
  sleep 0.1
done
if [ "$READY" != 1 ]; then echo 'Screenshot server startup timed out.' >&2; exit 1; fi
P="$(<"$RUN/port")"
URL="$(python3 -c 'from urllib.parse import quote; import sys; print("http://127.0.0.1:" + sys.argv[1] + "/" + quote(sys.argv[2]))' "$P" "$B")"
python3 -c 'import sys,urllib.request; urllib.request.urlopen(sys.argv[1], timeout=5).close()' "$URL"
for V in '1600x900:wide' '1440x860:laptop' '720x900:narrow'; do
  SIZE="${V%%:*}"
  NAME="${V##*:}"
  if ! python3 -c '
import subprocess, sys
try:
    result = subprocess.run(sys.argv[1:], timeout=45)
    sys.exit(result.returncode)
except subprocess.TimeoutExpired:
    sys.exit(124)
' "$CH" --headless=new --disable-gpu --no-sandbox --virtual-time-budget=2500 \
    --user-data-dir="$RUN/profile-$NAME" --window-size="${SIZE/x/,}" \
    --screenshot="$RUN/shot-$NAME.png" "$URL" >"$RUN/browser-$NAME.log" 2>&1; then
    echo "Screenshot failed for $NAME; see $RUN/browser-$NAME.log" >&2; exit 1
  fi
  python3 -c '
from pathlib import Path
import struct,sys
data = Path(sys.argv[1]).read_bytes()
expected = tuple(map(int, sys.argv[2].split("x")))
if len(data) < 33 or data[:8] != b"\x89PNG\r\n\x1a\n" or struct.unpack(">II", data[16:24]) != expected:
    raise SystemExit("Invalid screenshot or unexpected dimensions: " + sys.argv[1])
' "$RUN/shot-$NAME.png" "$SIZE"
done
printf '%s\n' "$RUN"/shot-*.png
