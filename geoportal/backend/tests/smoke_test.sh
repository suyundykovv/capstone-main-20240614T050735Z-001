#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT=8010

cd "$ROOT_DIR"

python3 -m uvicorn app.main:app --host 127.0.0.1 --port "$PORT" > /tmp/geoportal-smoke.log 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID >/dev/null 2>&1 || true' EXIT

sleep 4

curl --fail "http://127.0.0.1:${PORT}/api/hello" >/tmp/geoportal-hello.json

python3 - <<'PY'
from pathlib import Path
from PIL import Image
image_path = Path("/tmp/geoportal-smoke.png")
Image.new("RGB", (24, 24), color=(34, 139, 34)).save(image_path, format="PNG")
PY

curl --fail -s -X POST \
  -F "file=@/tmp/geoportal-smoke.png" \
  "http://127.0.0.1:${PORT}/api/predict" >/tmp/geoportal-disease.json

python3 - <<'PY'
import json, pathlib
payload = json.loads(pathlib.Path("/tmp/geoportal-disease.json").read_text())
required = {"mode", "crop", "recommendations"}
missing = required - payload.keys()
if missing:
    raise SystemExit(f"Disease payload missing keys: {missing}")
PY

curl --fail -s -X POST \
  -H "Content-Type: application/json" \
  -d '{"crop_type":"wheat","year":2024,"area_harvested_ha":1000,"production_t":500}' \
  "http://127.0.0.1:${PORT}/api/predict" >/tmp/geoportal-yield.json

python3 - <<'PY'
import json, sys, pathlib
payload = json.loads(pathlib.Path("/tmp/geoportal-yield.json").read_text())
required = {"predicted_yield", "confidence", "mode"}
missing = required - payload.keys()
if missing:
    raise SystemExit(f"Missing keys: {missing}")
PY

curl --fail "http://127.0.0.1:${PORT}/api/models/status" >/tmp/geoportal-status.json

echo "Smoke test passed"
