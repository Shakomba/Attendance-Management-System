#!/usr/bin/env bash
set -euo pipefail

PROJ="$(cd "$(dirname "$0")" && pwd)"
LOGS="$PROJ/logs"
mkdir -p "$LOGS"

echo "[*] Project root: $PROJ"

# Kill any existing processes on these ports
fuser -k 8000/tcp 2>/dev/null || true
fuser -k 5173/tcp 2>/dev/null || true
sleep 1

# --- Backend ---
echo "[*] Starting FastAPI backend (GPU mode)..."
cd "$PROJ/backend"
source .venv311/bin/activate
nohup uvicorn app.main:app --host 0.0.0.0 --port 8000 > "$LOGS/backend.log" 2>&1 &
BACKEND_PID=$!
echo "[*] Backend PID: $BACKEND_PID"

# --- Frontend ---
echo "[*] Starting Vite frontend..."
cd "$PROJ/frontend"
nohup npm run dev -- --host 0.0.0.0 --port 5173 > "$LOGS/frontend.log" 2>&1 &
FRONTEND_PID=$!
echo "[*] Frontend PID: $FRONTEND_PID"

# Save PIDs
echo "$BACKEND_PID" > "$LOGS/backend.pid"
echo "$FRONTEND_PID" > "$LOGS/frontend.pid"

echo ""
echo "[*] Waiting 8 seconds for services to initialize..."
sleep 8

echo ""
echo "=== Backend log (last 20 lines) ==="
tail -20 "$LOGS/backend.log"

echo ""
echo "=== Frontend log (last 10 lines) ==="
tail -10 "$LOGS/frontend.log"

echo ""
echo "==================================="
echo "  Backend:  http://localhost:8000"
echo "  Docs:     http://localhost:8000/docs"
echo "  Frontend: http://localhost:5173"
echo "==================================="
