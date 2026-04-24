# Attendance Management System

AI face-recognition attendance for classrooms. Professors start a session, the
camera streams video to the backend, and students are automatically marked
present via face recognition with passive anti-spoofing (CNN PAD).

- Backend: FastAPI + SQL Server, CPU (dlib) or GPU (InsightFace)
- Frontend: React 18 + Vite + Tailwind
- Anti-spoofing: MiniFASNet ONNX ensemble with temporal aggregation

See [CLAUDE.md](CLAUDE.md) for a deeper architecture walkthrough.

---

## Repo layout

```
backend/           FastAPI app (app/), requirements, local runner
frontend/          React + Vite SPA
database/          SQL Server schema + stored procedures
docker/            Dockerfiles (backend-base, backend-gpu)
nginx/             nginx.conf (prod), local.conf (local dev)
scripts/           convert_pad_models.py (one-time PAD setup)
docker-compose.yml         Production stack (GPU backend + SQL + nginx + certbot)
docker-compose.local.yml   Local dev overrides (CPU backend, no SSL)
deploy.sh                  Sync + build + start on a VPS (see below)
ssl-init.sh                One-time Let's Encrypt cert setup
CLAUDE.md                  Detailed architecture / config notes
```

---

## Local development

```bash
# 1. Backend
cd backend
python -m venv .venv311
source .venv311/bin/activate        # Windows: .venv311\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                 # edit values
./run_backend_311.sh                 # starts uvicorn on :8000

# 2. Frontend (new shell)
cd frontend
npm install
npm run dev                          # http://localhost:5173

# 3. Database
sqlcmd -S localhost,1433 -U sa -P <password> -i database/01_init_schema.sql
```

### One-time: anti-spoofing CNN weights

```bash
pip install "torch==2.1.*" --index-url https://download.pytorch.org/whl/cpu
python scripts/convert_pad_models.py
```
Generates the two MiniFASNet ONNX files under `backend/app/models/pad/`.
Skipping this disables spoof protection but attendance still works.

### Local Docker stack

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
```

---

## Production deploy (DigitalOcean GPU droplet)

One-time server prep:
```bash
apt-get install -y docker.io docker-compose-plugin
# NVIDIA container toolkit — see deploy.sh header for full commands
```

Every deploy:
```bash
./deploy.sh <droplet-ip>
```
`deploy.sh` rsyncs the repo to `/opt/attendify`, ships the prebuilt backend
image over SSH, and runs `docker compose up -d --build`. Required on the
server: `/opt/attendify/.env` with `JWT_SECRET_KEY`, `MSSQL_SA_PASSWORD`,
SMTP credentials.

First deploy also needs SSL certs:
```bash
ssh root@<ip> "cd /opt/attendify && bash ssl-init.sh you@example.com"
```

The production stack serves:
- `https://attendify.tech`         — frontend
- `https://api.attendify.tech`     — backend API + WebSockets
- `https://api.attendify.tech/docs` — OpenAPI docs

---

## Key endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/auth/login` | Professor login (JWT) |
| POST | `/api/sessions/start` | Start an attendance session |
| WS   | `/ws/camera/{session_id}` | Binary JPEG frame ingestion |
| WS   | `/ws/dashboard/{session_id}` | Real-time overlays + events |
| POST | `/api/sessions/{id}/finalize-send-emails` | Close session + email absentees |
| GET  | `/api/courses/{id}/gradebook` | Fetch course grades |

Full list in [backend/app/main.py](backend/app/main.py) or the Swagger UI at
`/docs`.
