# Handoff — Attendance Management System

**Date:** 2026-04-24  
**Production URL:** https://attendify.tech  
**VPS:** DigitalOcean GPU Droplet — RTX 6000 Ada, Toronto region, IP `165.245.235.190`  
**VPS repo path:** `/opt/attendify`  
**Git branch:** `main`

---

## What the system does

AI-powered face-recognition attendance. Professors start a session, a webcam streams binary JPEG frames over WebSocket, and students are marked present automatically via face recognition + passive CNN anti-spoofing. A React dashboard shows real-time overlays and lets professors manage grades and send absentee emails.

---

## Critical: Local repo vs VPS drift

**The two most important anti-spoofing fixes live on the VPS but are NOT yet committed to git.**

`/opt/attendify/backend/app/services/pad_cnn.py` diverges from the local copy in two places:

### Fix 1 — Input normalization (line ~187)

```python
# VPS (correct):
tensor = np.transpose(crop.astype(np.float32), (2, 0, 1))

# Local (broken — was dividing by 255):
tensor = np.transpose(crop.astype(np.float32) / 255.0, (2, 0, 1))
```

MiniVision's `to_tensor` returns raw `img.float()` (0–255 range), not divided by 255. Dividing caused the models to output near-zero live scores for every input, including real faces.

### Fix 2 — Crop function (replaces old `_get_crop`)

The old crop zero-padded and used `max(w,h)*scale`. MiniVision's `CropImage._get_new_box` shifts the window into frame bounds (no padding) and scales w and h independently. The correct implementation is now in `_crop_for_scale` — see the VPS file for the full implementation, or the conversation history.

**Action required:** SSH to VPS, copy the fixed `pad_cnn.py` back to the local repo and commit.

```bash
scp root@165.245.235.190:/opt/attendify/backend/app/services/pad_cnn.py \
    backend/app/services/pad_cnn.py
git add backend/app/services/pad_cnn.py
git commit -m "fix: correct MiniFASNet normalization and crop to match MiniVision source"
```

---

## Architecture

### Backend (`backend/app/`)

| File | Purpose |
|------|---------|
| `main.py` | FastAPI entry, all routes |
| `config.py` | All env vars as frozen dataclass |
| `database.py` | SQL Server pyodbc connection |
| `repos.py` | SQL queries / stored proc calls |
| `services/face_engine.py` | CPU (dlib/face_recognition) or GPU (InsightFace) detection + embeddings |
| `services/recognition_service.py` | Frame processing pipeline: detect → match → temporal CNN PAD → upsert attendance |
| `services/enrollment_service.py` | Multi-pose enrollment (5 poses); pose diversity check; no CNN PAD during enrollment |
| `services/spoof_detector.py` | CNN PAD wrapper with sliding-window temporal aggregation |
| `services/pad_cnn.py` | Low-level MiniFASNet ONNX inference (two-scale ensemble) |
| `services/email_service.py` | HTML email templates + async SMTP dispatch |
| `models/pad/` | MiniFASNet ONNX weights (gitignored; generate with `scripts/convert_pad_models.py`) |

### Frontend (`frontend/src/`)

| Path | Purpose |
|------|---------|
| `components/dashboard/` | CameraFeed, AttendanceTable, GradebookTable, EmailPanel, StatCards, SessionHistory |
| `components/enrollment/` | EnrollmentTab, EnrollmentModal (5-pose capture flow) |
| `components/settings/SettingsTab.jsx` | Settings page; danger zone is fully red; Kurdish toggle uses `rtl` prop with reversed translate values |
| `hooks/` | useApi, useSession, useCamera, useDashboardSocket, useEmail, useEnrollment |
| `lib/i18n.jsx` | Language switcher; sets `document.documentElement.dir = 'rtl'` for Kurdish (`ckb`) |

---

## Anti-spoofing pipeline

```
Frame arrives via WebSocket
  └─ RecognitionService.process_frame()
       ├─ face_engine.detect_faces()         # bbox + embedding
       ├─ identity match (cosine/euclidean)
       └─ spoof_detector.analyze_temporal()  # CNN PAD with sliding window
            ├─ state="verifying"  → skip (still collecting)
            ├─ state="live"       → upsert attendance
            └─ state="spoof"      → broadcast warning, no attendance
```

**Models:** `2.7_80x80_MiniFASNetV2.onnx` + `4_0_0_80x80_MiniFASNetV1SE.onnx`  
**Temporal window:** 6 frames, 4 must be live to pass (`ANTISPOOF_WINDOW_FRAMES` / `ANTISPOOF_REQUIRED_LIVE_FRAMES`)  
**Live threshold:** 0.55 per-frame (`ANTISPOOF_LIVE_THRESHOLD`)  
**Track TTL:** 8 s — idle tracks pruned from history (`ANTISPOOF_TRACK_TTL_SEC`)

---

## VPS environment

### Services (Docker Compose)
- `ams_backend` — GPU FastAPI backend (InsightFace + ONNX Runtime CUDA)
- `ams_frontend` — nginx serving the React build
- `ams_nginx` — reverse proxy + SSL termination (Let's Encrypt)
- `ams_sqlserver` — SQL Server 2022

### Key env vars on VPS (`/opt/attendify/.env`)

```env
AI_MODE=gpu
GPU_COSINE_THRESHOLD=0.55
RECOGNITION_FRAME_STRIDE=1
ANTISPOOF_ENABLED=true
ANTISPOOF_LIVE_THRESHOLD=0.55
ANTISPOOF_WINDOW_FRAMES=6
ANTISPOOF_REQUIRED_LIVE_FRAMES=4
ANTISPOOF_TRACK_TTL_SEC=8.0
ENROLLMENT_POSE_DISTANCE_THRESHOLD=0.15
```

### Redeploy after a git push

```bash
./deploy.sh 165.245.235.190
```

`deploy.sh` rsyncs the repo to `/opt/attendify`, ships the prebuilt backend image over SSH, and runs `docker compose up -d --build`.

### Generate PAD models (one-time, if rebuilding from scratch)

Run on the **host** (not inside Docker — container lacks torch):

```bash
pip install "torch==2.1.*" --index-url https://download.pytorch.org/whl/cpu
pip install "numpy<2"   # torch 2.1 incompatible with numpy 2.x
python scripts/convert_pad_models.py
```

Outputs `backend/app/models/pad/2.7_80x80_MiniFASNetV2.onnx` and `4_0_0_80x80_MiniFASNetV1SE.onnx`. These are gitignored; copy them to the VPS manually or via the deploy script.

---

## Enrollment flow

1. 5 poses required: `front`, `left`, `right`, `up`, `down`
2. Each pose: detect face → validate head angle (InsightFace pose tuple) → hold for 2 consecutive valid frames → check embedding distance from neutral (`front`) ≥ 0.15
3. Final diversity check across all 5 poses
4. CNN PAD is **not** run during enrollment — pose diversity provides the spoof protection here

---

## Known issues / pending work

| Issue | Status | Notes |
|-------|--------|-------|
| `pad_cnn.py` fix not committed locally | **Open** | Two critical fixes on VPS only — see "Critical" section above |
| MiniFASNetV1SE key mismatch warnings | Low priority | SE module uses `se_fc1` vs `se_module.fc1`; model still loads and functions well because V2 score dominates the ensemble |
| CNN PAD disabled during enrollment | By design | Can be re-added later; pose diversity is sufficient for now |

---

## UI notes

- **Danger zone** (Settings): uses inline red `<h3>`/`<p>`, `bg-red-500/5` card, all text red — no shared `SectionHeader` component
- **Kurdish toggle**: `Toggle` component has an `rtl` prop. When `rtl=true`, translate values are swapped so ON=`translate-x-[4px]` (start) and OFF=`translate-x-[22px]` (end). The button also has `dir="ltr"` to prevent the RTL document direction from pushing the thumb off-screen.
- **Language/RTL**: `i18n.jsx` sets `document.documentElement.dir = 'rtl'` for Kurdish (`ckb`)

---

## DNS

| Record | Value |
|--------|-------|
| `attendify.tech` | `165.245.235.190` |
| `api.attendify.tech` | `165.245.235.190` |
