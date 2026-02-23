# Distributed AI Attendance & Grade Management System

This project provides a full end-to-end baseline implementation for:
1. SQL Server schema with automated grade/penalty logic
2. FastAPI backend with WebSockets and dual CPU/GPU face recognition modes
3. Teacher web dashboard (React + Tailwind)
4. SMTP absentee report service

## Architecture

- `database/01_init_schema.sql`
  - Initializes all tables, computed columns, procedures, and gradebook view.
  - Includes automated formulas:
    - `AttendancePenalty = HoursAbsentTotal * 0.25`
    - `AdjustedTotal = RawTotal - AttendancePenalty` (floored at 0)
    - `AtRisk` flag
  - Includes attendance procedures:
    - `sp_UpsertAttendanceOnRecognition`
    - `sp_FinalizeSession`
- `backend/`
  - FastAPI API + WebSockets
  - SQL Server integration via `pyodbc`
  - AI engine abstraction with dual mode:
    - `AI_MODE=cpu` -> `face_recognition` + HOG (default)
    - `AI_MODE=gpu` -> `InsightFace` + CUDA provider
- `frontend/`
  - Teacher dashboard (React + Tailwind) with:
    - Live feed frame display
    - Real-time recognition notifications
    - Session attendance table
    - Full gradebook table
    - Finalize session + send emails button
- `doorway_client/camera_client.py`
  - Separate laptop client that streams doorway camera frames to backend over WebSocket.

## Phase 1: Database Setup

1. Open SQL Server Management Studio (or Azure Data Studio).
2. Run:

```sql
:r database/01_init_schema.sql
```

Or paste and execute contents of `database/01_init_schema.sql`.

## Phase 2: Backend Setup

1. Create Python environment and install dependencies:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

2. Configure environment:

```bash
cp .env.example .env
```

3. Edit `.env` with SQL Server and SMTP credentials.
   For local testing without SQL Server installed, keep:
   - `DEMO_MODE=true`

4. Run API:

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Real Recognition Runtime (recommended local setup)

If your system default Python is 3.14+, install a local Python 3.11 runtime and use a dedicated env:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
export PATH=$HOME/.local/bin:$PATH
uv python install 3.11
cd backend
uv venv .venv311 --python 3.11
source .venv311/bin/activate
python -m ensurepip --upgrade
python -m pip install cmake
python -m pip install --no-build-isolation dlib==20.0.0
python -m pip install -r requirements.txt
./run_backend_311.sh
```

### CPU/GPU Switch (single variable)

- Default CPU HOG mode:

```env
AI_MODE=cpu
```

- Switch to RTX 3080Ti GPU mode:

```env
AI_MODE=gpu
```

No code changes required.

## Phase 3: Teacher Dashboard

This dashboard is now a full React + Tailwind web app.

Requirements:

- Node.js 20+ and npm
- If Node is not globally installed, use local runtime:
  - `export PATH=$HOME/.local/node/node-v20.18.2-linux-x64/bin:$PATH`

Run development server:

```bash
cd frontend
npm install
npm run dev -- --host 0.0.0.0 --port 5173
```

Then visit: `http://localhost:5173`

Dashboard actions:
1. Refresh courses
2. Start session
3. Start local camera demo (or use doorway client)
4. Monitor notifications + attendance + gradebook
5. Finalize session and dispatch absentee emails

Performance notes for older classroom hardware:
1. Dashboard rendering is canvas-based and frame-throttled (draw loop capped) to avoid React re-render overhead.
2. Camera uplink is FPS-capped and drops frames when WebSocket buffer grows.
3. Overlay drawing and stream decode are separated from table/notification UI state updates.

## Student Photos (Where to Put Them)

Store student photos in:

- `student_photos/`

Recommended file naming:

- `student_photos/<student_code>.jpg`
- Example: `student_photos/S003.jpg`

Register photo as face embedding:

```bash
curl -X POST http://localhost:8000/api/students/<student_id>/face \
  -F "image=@student_photos/<student_code>.jpg"
```

Quick verification for active course embeddings:

```bash
curl http://localhost:8000/api/debug/courses/1/embedding-count
```

In `DEMO_MODE=true`, backend startup automatically scans `student_photos/` and registers matching photos
by filename (`<student_code>.jpg`) if embeddings are missing.

## Phase 4: SMTP Service

The endpoint:

- `POST /api/sessions/{session_id}/finalize-send-emails`

will:
1. Finalize the session and calculate hourly absences
2. Update `HoursAbsentTotal` in enrollments
3. Send personalized HTML emails to absentees
4. Persist logs in `dbo.EmailDispatchLog`

For safe testing, keep:

```env
SMTP_DRY_RUN=true
```

Switch to real send:

```env
SMTP_DRY_RUN=false
```

## Example Workflow (API)

1. `POST /api/students` to create and enroll student.
2. `POST /api/students/{student_id}/face` to upload student portrait and store embedding.
3. `POST /api/sessions/start` to start class session.
4. Stream frames over `ws://<server>/ws/camera/{session_id}`.
5. Monitor UI via `ws://<server>/ws/dashboard/{session_id}`.
6. Finalize with `POST /api/sessions/{session_id}/finalize-send-emails`.

## Notes

- CPU mode uses HOG for lower hardware requirements.
- GPU mode expects CUDA-capable drivers and `onnxruntime-gpu` compatibility.
- Face embedding storage is model-specific (`hog-128` vs `insightface-512`).
  Register student faces in the same mode that will be used for recognition.
- `DEMO_MODE=true` keeps everything local in-memory so you can test UI/API without SQL setup.
