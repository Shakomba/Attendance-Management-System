# Attendance Management System — CLAUDE.md

AI-powered face recognition attendance system for classrooms. Professors start a session, a camera streams video to the backend, and students are automatically marked present via face recognition. Grades and email notifications are managed through a web dashboard.

---

## Project Structure

```
Attendance-Management-System/
├── backend/app/
│   ├── main.py                  # FastAPI entry point, all routes
│   ├── config.py                # Env var configuration
│   ├── database.py              # SQL Server connection
│   ├── repos.py                 # SQL Server repository
│   ├── demo_repo.py             # In-memory mock repository
│   ├── schemas.py               # Pydantic request/response models
│   ├── auth.py                  # JWT + WebAuthn auth
│   ├── webauthn_service.py      # Passkey registration/verification
│   ├── websocket_manager.py     # Multi-client WebSocket broadcasting
│   └── services/
│       ├── face_engine.py       # Face detection & embedding (CPU/GPU)
│       ├── recognition_service.py # Recognition logic, cooldowns, caching
│       ├── enrollment_service.py  # Multi-pose enrollment pipeline
│       ├── spoof_detector.py    # Anti-spoofing (Laplacian/LBP/FFT)
│       └── email_service.py     # HTML email templates + SMTP sending
├── frontend/src/
│   ├── App.jsx                  # Main app component
│   ├── components/
│   │   ├── auth/                # LoginPage
│   │   ├── settings/            # SettingsTab
│   │   ├── dashboard/           # CameraFeed, AttendanceTable, GradebookTable, EmailPanel, StatCards, SessionHistory
│   │   ├── enrollment/          # EnrollmentTab, EnrollmentModal
│   │   └── layout/              # DashboardLayout
│   ├── hooks/                   # useApi, useSession, useCamera, useDashboardSocket, useEmail, useEnrollment
│   └── lib/                     # i18n, translations, utils
├── docker/
│   ├── Dockerfile.backend-base  # CPU base image (python + dlib + ODBC)
│   └── Dockerfile.backend-gpu   # GPU image (CUDA + cuDNN layered on base)
├── database/
│   └── 01_init_schema.sql       # Full SQL Server schema + stored procedures + views
├── doorway_client/
│   └── camera_client.py         # Standalone camera streaming client
└── student_photos/              # Drop student photos here for embedding
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.11+, FastAPI 0.115, Uvicorn |
| Database | SQL Server (pyodbc) |
| Face Recognition (CPU) | face_recognition 1.3 + HOG detector |
| Face Recognition (GPU) | InsightFace 0.7.3 + ONNX Runtime GPU + CUDA |
| Image Processing | OpenCV 4.10 |
| Validation | Pydantic 2.10 |
| Frontend | React 18, Vite 6, Tailwind CSS 3 |
| Icons | Lucide React |
| Email | smtplib (stdlib) |

---

## Running the Project

### Backend
```bash
cd backend/
python -m venv .venv311
source .venv311/bin/activate
pip install -r requirements.txt
cp .env.example .env   # then edit .env
./run_backend_311.sh
# or: uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### Frontend
```bash
cd frontend/
npm install
npm run dev       # dev server at http://localhost:5173
npm run build     # production bundle
```

### Camera Client (optional — runs on doorway machine)
```bash
cd doorway_client/
python camera_client.py --server ws://localhost:8000 --session <SESSION_ID> --camera 0 --fps 5
```

### Database
```bash
sqlcmd -S localhost,1433 -U sa -P <password> -i database/01_init_schema.sql
```

---

## Key Configuration (backend/.env)

```env
# Use in-memory repo for local dev without SQL Server
DEMO_MODE=true

# AI mode: "cpu" or "gpu"
AI_MODE=cpu
CPU_DISTANCE_THRESHOLD=0.45
GPU_COSINE_THRESHOLD=0.55

# Recognition tuning
RECOGNITION_FRAME_STRIDE=8         # Process every Nth frame
RECOGNITION_EVENT_COOLDOWN_SEC=20  # Prevent duplicate events

# SQL Server (when DEMO_MODE=false)
SQL_SERVER=localhost
SQL_PORT=1433
SQL_DATABASE=AttendanceAI
SQL_USER=sa
SQL_PASSWORD=YourStrong!Passw0rd

# SMTP
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_DRY_RUN=true   # Set false for real emails
```

---

## API Endpoints (backend/app/main.py)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/auth/login` | Professor authentication |
| GET | `/api/health` | Health check |
| GET | `/api/courses` | List active courses |
| POST | `/api/students` | Create & enroll student |
| POST | `/api/students/{id}/face` | Upload & embed face photo |
| GET | `/api/courses/{id}/gradebook` | Get course grades |
| PATCH | `/api/courses/{id}/students/{sid}/grades` | Update grades |
| POST | `/api/sessions/start` | Start attendance session |
| GET | `/api/sessions/{id}/attendance` | Get session attendance |
| PATCH | `/api/sessions/{id}/students/{sid}/attendance` | Manual attendance update |
| POST | `/api/sessions/{id}/finalize-send-emails` | Finalize + email absentees |
| POST | `/api/courses/{id}/emails/send` | Bulk email students |
| WS | `/ws/camera/{session_id}` | Binary JPEG frame ingestion |
| WS | `/ws/dashboard/{session_id}` | Real-time dashboard events |

---

## Architecture Notes

### Repository Pattern
Two implementations of the same interface:
- `repos.py` — real SQL Server queries
- `demo_repo.py` — in-memory mock (activated by `DEMO_MODE=true`)

When editing data logic, changes to one may need to be mirrored in the other.

### Face Recognition Pipeline
1. Camera client sends binary JPEG frames over WebSocket
2. Backend applies frame stride (every Nth frame) to reduce load
3. Matching frames are queued for async recognition
4. Hit → upserts `SessionAttendance` + broadcasts face overlay to dashboard socket
5. Cooldown window prevents duplicate events

### Embedding Cache
`RecognitionService` caches known face embeddings for 60 seconds per course to avoid repeated DB reads.

### WebSocket Architecture
- `/ws/camera/` — receives binary frames, no relay to browser
- `/ws/dashboard/` — broadcasts JSON events (face overlays, presence events, warnings)
- `WebSocketManager` handles multi-client fan-out

### Email Service
- HTML templates with at-risk/dropped status banners
- Dry-run mode (`SMTP_DRY_RUN=true`) logs emails without sending
- Async dispatch via `asyncio.create_task()` — does not block API responses

### Database Computed Columns (Enrollments table)
- `AttendancePenalty = HoursAbsentTotal × 0.5`
- `AdjustedTotal = RawTotal − AttendancePenalty (min 0)`
- `AtRisk = 1` if `AdjustedTotal < 60` or `HoursAbsentTotal ≥ 4`

### Stored Procedures
- `sp_StartSession` — creates session, initializes attendance rows
- `sp_UpsertAttendanceOnRecognition` — records recognition events
- `sp_FinalizeSession` — marks session complete, computes final stats

### Frontend State
- Session/theme/active tab persisted to `localStorage`
- Dark mode toggled via Tailwind `class` strategy
- `useApi()` auto-detects backend URL (localhost:8000 vs production domain)

---

## No Tests

There are currently no automated tests. Manual testing uses the demo mode + Postman/browser.
