import asyncio
import base64
import csv
import io
import json
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Optional

from fastapi import Depends, FastAPI, File, HTTPException, Query, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

from .auth import create_access_token, decode_token, get_current_professor
from .config import settings
from . import webauthn_service as _wa
from .demo_repo import DemoRepository
from .repos import Repository
from .schemas import (
    BulkEmailRequest,
    BulkEmailResponse,
    EnrollmentStartResponse,
    EnrollmentStatusResponse,
    FinalizeSessionResponse,
    GradeUpdateRequest,
    GenericMessage,
    LoginRequest,
    LoginResponse,
    ManualAttendanceUpdateRequest,
    StartSessionRequest,
    StartSessionResponse,
    StudentCreateRequest,
)
from .services.email_service import EmailService
from .services.enrollment_service import EnrollmentService
from .services.face_engine import FaceEngine
from .services.recognition_service import RecognitionService
from .services.spoof_detector import SpoofDetector
from .websocket_manager import WebSocketManager

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
_MAX_IMAGE_BYTES = 10 * 1024 * 1024  # 10 MB
_ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}

# ---------------------------------------------------------------------------
# Infrastructure
# ---------------------------------------------------------------------------
repo = DemoRepository() if settings.demo_mode else Repository()
ws_manager = WebSocketManager()
email_service = EmailService(repo)

face_engine_error: Optional[str] = None
face_engine: Optional[FaceEngine] = None
spoof_detector: Optional[SpoofDetector] = None
recognition_service: Optional[RecognitionService] = None
enrollment_service: Optional[EnrollmentService] = None

try:
    face_engine = FaceEngine()
    spoof_detector = SpoofDetector()
    recognition_service = RecognitionService(repo, face_engine, spoof_detector)
    enrollment_service = EnrollmentService(face_engine, spoof_detector, repo)
except Exception as exc:  # pragma: no cover
    face_engine_error = str(exc)

limiter = Limiter(key_func=get_remote_address)


@asynccontextmanager
async def lifespan(application):
    """Run startup logic then yield to handle requests."""
    if settings.demo_mode and face_engine and hasattr(repo, "bootstrap_embeddings_from_folder"):
        try:
            stats = repo.bootstrap_embeddings_from_folder(face_engine)
            print(f"[startup] Demo embedding bootstrap: {stats}")
        except Exception as exc:  # pragma: no cover
            print(f"[startup] Demo embedding bootstrap failed: {exc}")
    repo.ensure_webauthn_table()
    yield


app = FastAPI(
    title="Distributed AI Attendance & Grade Management API",
    version="1.0.0",
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ---------------------------------------------------------------------------
# Security headers middleware
# ---------------------------------------------------------------------------
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response


app.add_middleware(SecurityHeadersMiddleware)

# ---------------------------------------------------------------------------
# CORS — explicit origins only; wildcard + credentials violates the spec
# ---------------------------------------------------------------------------
if settings.cors_origins:
    allow_origins = list(settings.cors_origins)
    allow_credentials = True
else:
    # Development fallback — no credentials required when no origin is pinned
    allow_origins = ["http://localhost:5173", "http://localhost:3000"]
    allow_credentials = False

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=allow_credentials,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

# ---------------------------------------------------------------------------
# Authorization helpers
# ---------------------------------------------------------------------------
def _require_course(professor: dict, course_id: int) -> None:
    if professor["course_id"] != course_id:
        raise HTTPException(status_code=403, detail="Access denied to this course.")


def _get_session_or_403(professor: dict, session_id: str):
    session = repo.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")
    if int(session["CourseID"]) != professor["course_id"]:
        raise HTTPException(status_code=403, detail="Access denied to this session.")
    return session


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.post("/api/auth/login", response_model=LoginResponse)
@limiter.limit("10/minute")
def login(request: Request, payload: LoginRequest) -> LoginResponse:
    result = repo.authenticate_professor(payload.username, payload.password)
    if not result:
        raise HTTPException(status_code=401, detail="Invalid username or password.")
    token = create_access_token(
        professor_id=result["professor_id"],
        username=result["username"],
        course_id=result["course_id"],
    )
    return LoginResponse(**result, access_token=token)


# ── WebAuthn / Passkey endpoints ────────────────────────────────────────────

@app.post("/api/auth/webauthn/register/begin")
def webauthn_register_begin(professor: dict = Depends(get_current_professor)) -> dict:
    prof_row = repo.get_professor_by_username(professor["username"])
    if not prof_row:
        raise HTTPException(status_code=404, detail="Professor not found.")
    session_id, options_json = _wa.begin_registration(
        professor_id=prof_row["ProfessorID"],
        username=professor["username"],
        full_name=prof_row["FullName"],
    )
    return {"session_id": session_id, "options": json.loads(options_json)}


@app.post("/api/auth/webauthn/register/complete")
def webauthn_register_complete(
    payload: dict,
    professor: dict = Depends(get_current_professor),
) -> dict:
    session_id = payload.get("session_id", "")
    credential_json = json.dumps(payload.get("credential", {}))
    device_name = str(payload.get("device_name", ""))[:100] or "Unknown device"
    try:
        data = _wa.complete_registration(session_id, credential_json)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    repo.save_webauthn_credential(
        professor_id=data["professor_id"],
        credential_id=data["credential_id"],
        public_key=data["public_key"],
        sign_count=data["sign_count"],
        device_name=device_name,
    )
    return {"ok": True, "credential_id": data["credential_id"], "device_name": device_name}


@app.post("/api/auth/webauthn/authenticate/begin")
def webauthn_authenticate_begin(payload: dict) -> dict:
    username = payload.get("username", "").strip()
    if not username:
        raise HTTPException(status_code=400, detail="username is required.")
    prof_row = repo.get_professor_by_username(username)
    if not prof_row:
        # Don't reveal whether user exists; return empty options
        session_id, options_json = _wa.begin_authentication([])
        return {"session_id": session_id, "options": json.loads(options_json)}
    creds = repo.get_webauthn_credentials_for_professor(prof_row["ProfessorID"])
    credential_ids = [
        base64.urlsafe_b64decode(c["CredentialID"] + "==") for c in creds
    ]
    session_id, options_json = _wa.begin_authentication(credential_ids)
    return {"session_id": session_id, "options": json.loads(options_json)}


@app.post("/api/auth/webauthn/authenticate/complete")
def webauthn_authenticate_complete(payload: dict) -> LoginResponse:
    username = payload.get("username", "").strip()
    session_id = payload.get("session_id", "")
    credential_json = json.dumps(payload.get("credential", {}))

    prof_row = repo.get_professor_by_username(username)
    if not prof_row:
        raise HTTPException(status_code=401, detail="Authentication failed.")

    credential_id = payload.get("credential", {}).get("id", "")
    stored = repo.get_webauthn_credential_by_id(credential_id)
    if not stored or int(stored["ProfessorID"]) != int(prof_row["ProfessorID"]):
        raise HTTPException(status_code=401, detail="Authentication failed.")

    try:
        new_sign_count = _wa.complete_authentication(
            session_id=session_id,
            credential_json=credential_json,
            public_key_bytes=bytes(stored["PublicKey"]),
            sign_count=int(stored["SignCount"]),
        )
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc))

    repo.update_webauthn_sign_count(credential_id, new_sign_count)

    token = create_access_token(
        professor_id=prof_row["ProfessorID"],
        username=prof_row["Username"],
        course_id=prof_row["CourseID"],
    )
    return LoginResponse(
        professor_id=prof_row["ProfessorID"],
        username=prof_row["Username"],
        full_name=prof_row["FullName"],
        course_id=prof_row["CourseID"],
        course_name=prof_row.get("CourseName", ""),
        course_code=prof_row.get("CourseCode", ""),
        access_token=token,
    )


@app.get("/api/auth/webauthn/credentials")
def webauthn_list_credentials(professor: dict = Depends(get_current_professor)) -> dict:
    creds = repo.list_webauthn_credentials(int(professor["sub"]))
    return {"items": [
        {
            "credential_id": c["CredentialID"],
            "device_name": c["DeviceName"],
            "created_at": c["CreatedAt"].isoformat() if hasattr(c["CreatedAt"], "isoformat") else str(c["CreatedAt"]),
        }
        for c in creds
    ]}


@app.delete("/api/auth/webauthn/credentials/{credential_id}")
def webauthn_delete_credential(
    credential_id: str,
    professor: dict = Depends(get_current_professor),
) -> dict:
    deleted = repo.delete_webauthn_credential(credential_id, int(professor["sub"]))
    if not deleted:
        raise HTTPException(status_code=404, detail="Credential not found.")
    return {"ok": True}


@app.get("/api/health")
def healthcheck() -> dict:
    db = repo.healthcheck()
    return {
        "status": "ok",
        "database": db,
        "ai_mode": settings.ai_mode,
        "ai_model": face_engine.model_name if face_engine else None,
        "ai_ready": recognition_service is not None,
        "ai_error": face_engine_error,
    }


@app.get("/api/courses")
def list_courses(professor: dict = Depends(get_current_professor)) -> dict:
    return {"items": repo.list_courses()}


@app.post("/api/students", response_model=GenericMessage)
def create_student(
    payload: StudentCreateRequest,
    professor: dict = Depends(get_current_professor),
) -> GenericMessage:
    _require_course(professor, payload.course_id)
    result = repo.create_student_and_enroll(payload.model_dump())
    return GenericMessage(message="Student created and enrolled.", data=result)


@app.post("/api/students/{student_id}/face", response_model=GenericMessage)
async def upload_student_face(
    student_id: int,
    image: UploadFile = File(...),
    pose_label: str = Query(default="front"),
    professor: dict = Depends(get_current_professor),
) -> GenericMessage:
    if not face_engine:
        raise HTTPException(status_code=503, detail=face_engine_error or "Face engine not initialized.")

    if image.content_type not in _ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="Only JPEG, PNG, and WebP images are supported.")

    if pose_label not in {"front", "left", "right", "up", "down"}:
        raise HTTPException(status_code=400, detail="pose_label must be one of: front, left, right, up, down.")

    image_bytes = await image.read()
    if len(image_bytes) > _MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image file too large (max 10 MB).")

    frame = face_engine.decode_image_bytes(image_bytes)
    if frame is None:
        raise HTTPException(status_code=400, detail="Could not decode image file.")

    embedding = face_engine.extract_embedding(frame)
    if embedding is None:
        raise HTTPException(status_code=400, detail="No face detected in uploaded image.")

    repo.upsert_face_embedding(
        student_id, face_engine.model_name, face_engine.embedding_to_bytes(embedding), pose_label=pose_label,
    )
    return GenericMessage(
        message="Face embedding saved.",
        data={
            "student_id": student_id,
            "model_name": face_engine.model_name,
            "ai_mode": face_engine.mode,
            "pose_label": pose_label,
        },
    )


# ---------------------------------------------------------------------------
# Enrollment endpoints (multi-angle anti-spoofing)
# ---------------------------------------------------------------------------
@app.post("/api/students/{student_id}/enrollment/start", response_model=EnrollmentStartResponse)
def start_enrollment(
    student_id: int,
    professor: dict = Depends(get_current_professor),
) -> EnrollmentStartResponse:
    if not enrollment_service:
        raise HTTPException(status_code=503, detail=face_engine_error or "Face engine not initialized.")
    result = enrollment_service.start_enrollment(student_id)
    return EnrollmentStartResponse(**result)


@app.get("/api/students/{student_id}/enrollment/status", response_model=EnrollmentStatusResponse)
def get_enrollment_status(
    student_id: int,
    professor: dict = Depends(get_current_professor),
) -> EnrollmentStatusResponse:
    if not enrollment_service:
        raise HTTPException(status_code=503, detail=face_engine_error or "Face engine not initialized.")
    result = enrollment_service.get_status(student_id)
    return EnrollmentStatusResponse(**result)


@app.websocket("/ws/enrollment/{student_id}")
async def enrollment_ws(
    websocket: WebSocket,
    student_id: int,
    token: Optional[str] = Query(default=None),
) -> None:
    professor = _validate_ws_token(token)
    if not professor:
        await websocket.close(code=4001)
        return

    if not enrollment_service or not face_engine:
        await websocket.accept()
        await websocket.send_json({"type": "error", "message": face_engine_error or "Face engine unavailable."})
        await websocket.close()
        return

    await websocket.accept()
    # Start enrollment flow.
    start_result = enrollment_service.start_enrollment(student_id)
    await websocket.send_json({"type": "pose_instruction", **start_result})

    frame_count = 0
    enrollment_stride = 4  # Process every 4th frame for responsiveness.

    try:
        while True:
            message = await websocket.receive()

            if message.get("type") == "websocket.disconnect":
                break

            # Handle text messages (ping/cancel).
            if "text" in message and message["text"]:
                try:
                    payload = json.loads(message["text"])
                    if payload.get("type") == "ping":
                        await websocket.send_json({"type": "pong"})
                    elif payload.get("type") == "cancel":
                        enrollment_service.cancel_enrollment(student_id)
                        await websocket.send_json({"type": "cancelled"})
                        break
                except Exception:
                    pass
                continue

            raw_bytes = message.get("bytes")
            if not raw_bytes:
                continue

            frame_count += 1
            if frame_count % enrollment_stride != 0:
                continue

            frame = await asyncio.to_thread(face_engine.decode_image_bytes, raw_bytes)
            if frame is None:
                continue

            result = await asyncio.to_thread(enrollment_service.process_frame, student_id, frame)
            await websocket.send_json(result)

            if result.get("type") in ("enrollment_complete", "enrollment_failed"):
                break

    except WebSocketDisconnect:
        enrollment_service.cancel_enrollment(student_id)
    except Exception as _exc:
        import logging, traceback
        logging.getLogger("enrollment").error("Enrollment WS error: %s\n%s", _exc, traceback.format_exc())
        enrollment_service.cancel_enrollment(student_id)


@app.get("/api/courses/{course_id}/students")
def list_course_students(
    course_id: int,
    professor: dict = Depends(get_current_professor),
) -> dict:
    _require_course(professor, course_id)
    return {"items": repo.list_course_students(course_id)}


@app.get("/api/courses/{course_id}/gradebook")
def get_gradebook(
    course_id: int,
    professor: dict = Depends(get_current_professor),
) -> dict:
    _require_course(professor, course_id)
    return {"items": repo.get_gradebook(course_id)}


@app.patch("/api/courses/{course_id}/students/{student_id}/grades", response_model=GenericMessage)
def update_student_grades(
    course_id: int,
    student_id: int,
    payload: GradeUpdateRequest,
    professor: dict = Depends(get_current_professor),
) -> GenericMessage:
    _require_course(professor, course_id)
    try:
        updated = repo.update_student_grades(course_id, student_id, payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return GenericMessage(message="Grades updated.", data=updated)


_GRADE_FIELDS = ["Quiz1", "Quiz2", "ProjectGrade", "AssignmentGrade", "MidtermGrade", "FinalExamGrade", "HoursAbsentTotal"]
_CSV_HEADERS = ["StudentID", "FullName", "Email"] + _GRADE_FIELDS


@app.get("/api/courses/{course_id}/gradebook/export")
def export_gradebook(
    course_id: int,
    professor: dict = Depends(get_current_professor),
) -> StreamingResponse:
    _require_course(professor, course_id)
    rows = repo.get_gradebook(course_id)

    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=_CSV_HEADERS, extrasaction="ignore", lineterminator="\n")
    writer.writeheader()
    for r in rows:
        writer.writerow({h: ("" if r.get(h) is None else r[h]) for h in _CSV_HEADERS})

    buf.seek(0)
    filename = f"gradebook_course_{course_id}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.post("/api/courses/{course_id}/gradebook/import")
async def import_gradebook(
    course_id: int,
    file: UploadFile = File(...),
    professor: dict = Depends(get_current_professor),
) -> dict:
    _require_course(professor, course_id)
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are accepted.")

    content = await file.read()
    try:
        text = content.decode("utf-8-sig")  # strip BOM if present
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="File must be UTF-8 encoded.")

    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames or "StudentID" not in reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV must contain a StudentID column.")

    updated, errors = 0, []
    for i, row in enumerate(reader, start=2):  # row 1 is header
        sid_raw = row.get("StudentID", "").strip()
        if not sid_raw:
            continue
        try:
            student_id = int(sid_raw)
        except ValueError:
            errors.append(f"Row {i}: invalid StudentID '{sid_raw}'")
            continue

        def _parse(val: Optional[str]) -> Optional[float]:
            if val is None or val.strip() == "":
                return None
            try:
                return float(val.strip())
            except ValueError:
                return None

        grades = {
            "quiz1": _parse(row.get("Quiz1")),
            "quiz2": _parse(row.get("Quiz2")),
            "project": _parse(row.get("ProjectGrade")),
            "assignment": _parse(row.get("AssignmentGrade")),
            "midterm": _parse(row.get("MidtermGrade")),
            "final_exam": _parse(row.get("FinalExamGrade")),
            "hours_absent_total": _parse(row.get("HoursAbsentTotal")),
        }

        try:
            repo.update_student_grades(course_id, student_id, grades)
            updated += 1
        except ValueError as exc:
            errors.append(f"Row {i} (StudentID {student_id}): {exc}")

    return {"updated": updated, "errors": errors}


@app.post("/api/sessions/start", response_model=StartSessionResponse)
def start_session(
    payload: StartSessionRequest,
    professor: dict = Depends(get_current_professor),
) -> StartSessionResponse:
    _require_course(professor, payload.course_id)
    started_at = payload.started_at
    if started_at and started_at.tzinfo:
        started_at = started_at.astimezone(timezone.utc).replace(tzinfo=None)

    result = repo.start_session(payload.course_id, started_at)
    return StartSessionResponse(**result)


@app.get("/api/sessions/{session_id}/attendance")
def get_session_attendance(
    session_id: str,
    professor: dict = Depends(get_current_professor),
) -> dict:
    _get_session_or_403(professor, session_id)
    return {"items": repo.get_session_attendance(session_id)}


@app.patch("/api/sessions/{session_id}/students/{student_id}/attendance", response_model=GenericMessage)
def update_session_attendance(
    session_id: str,
    student_id: int,
    payload: ManualAttendanceUpdateRequest,
    professor: dict = Depends(get_current_professor),
) -> GenericMessage:
    _get_session_or_403(professor, session_id)
    marked_at = payload.marked_at
    if marked_at and marked_at.tzinfo:
        marked_at = marked_at.astimezone(timezone.utc).replace(tzinfo=None)

    try:
        updated = repo.set_manual_attendance(
            session_id=session_id,
            student_id=student_id,
            is_present=payload.is_present,
            marked_at=marked_at,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return GenericMessage(message="Attendance updated.", data=updated)


@app.post("/api/sessions/{session_id}/finalize-send-emails", response_model=FinalizeSessionResponse)
async def finalize_and_email(
    session_id: str,
    send_emails: bool = Query(default=True),
    professor: dict = Depends(get_current_professor),
) -> FinalizeSessionResponse:
    _get_session_or_403(professor, session_id)
    repo.finalize_session(session_id)

    if send_emails:
        async def _send():
            await asyncio.to_thread(email_service.send_absentee_reports, session_id)
        asyncio.create_task(_send())

    return FinalizeSessionResponse(session_id=session_id, emails_sent=0, email_failures=0)


@app.get("/api/courses/{course_id}/sessions/history")
def get_sessions_history(
    course_id: int,
    professor: dict = Depends(get_current_professor),
) -> dict:
    _require_course(professor, course_id)
    sessions = repo.list_sessions_with_summary(course_id)
    return {"sessions": sessions}


@app.post("/api/courses/{course_id}/reset")
def reset_course_data(
    course_id: int,
    professor: dict = Depends(get_current_professor),
) -> dict:
    _require_course(professor, course_id)
    repo.reset_course_data(course_id)
    return {"ok": True, "course_id": course_id}


@app.post("/api/courses/{course_id}/emails/send", response_model=BulkEmailResponse)
def send_bulk_email(
    course_id: int,
    payload: BulkEmailRequest,
    professor: dict = Depends(get_current_professor),
) -> BulkEmailResponse:
    _require_course(professor, course_id)
    if payload.email_type not in ("grade_report", "absence_report"):
        raise HTTPException(status_code=400, detail="email_type must be 'grade_report' or 'absence_report'.")
    if not payload.student_ids:
        raise HTTPException(status_code=400, detail="student_ids must not be empty.")

    students = repo.get_gradebook_for_students(course_id, payload.student_ids)
    if not students:
        raise HTTPException(status_code=404, detail="No matching students found for this course.")

    result = email_service.send_bulk_emails(students, payload.email_type)
    return BulkEmailResponse(**result)


# ---------------------------------------------------------------------------
# WebSocket helpers
# ---------------------------------------------------------------------------
def _parse_timestamp(value: Optional[str]) -> datetime:
    if not value:
        return datetime.now(timezone.utc)

    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except Exception:
        return datetime.now(timezone.utc)


def _decode_base64_frame(image_b64: str) -> Optional[bytes]:
    try:
        payload = image_b64
        if "," in payload:
            payload = payload.split(",", 1)[1]
        return base64.b64decode(payload)
    except Exception:
        return None


def _validate_ws_token(token: Optional[str]) -> Optional[dict]:
    """Return decoded payload if valid, else None."""
    if not token:
        return None
    return decode_token(token)


@app.websocket("/ws/dashboard/{session_id}")
async def dashboard_ws(
    websocket: WebSocket,
    session_id: str,
    token: Optional[str] = Query(default=None),
) -> None:
    professor = _validate_ws_token(token)
    if not professor:
        await websocket.close(code=4001)
        return
    if int(professor.get("course_id", -1)) != _ws_session_course(session_id):
        await websocket.close(code=4003)
        return

    await ws_manager.connect_dashboard(session_id, websocket)
    await ws_manager.broadcast_dashboard(
        session_id,
        {
            "type": "info",
            "message": f"Dashboard connected to session {session_id}",
            "server_time": datetime.now(timezone.utc).isoformat(),
        },
    )

    try:
        while True:
            _ = await websocket.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect_dashboard(session_id, websocket)


def _ws_session_course(session_id: str) -> int:
    """Return the course_id for a session, or -1 if not found."""
    session = repo.get_session(session_id)
    if not session:
        return -1
    return int(session["CourseID"])


_recognition_locks: dict = {}
_latest_frames: dict = {}


async def _run_recognition(sid: str) -> None:
    """Run recognition on the latest available frame for a session."""
    try:
        while True:
            raw_bytes = _latest_frames.pop(sid, None)
            if raw_bytes is None:
                break

            frame = await asyncio.to_thread(face_engine.decode_image_bytes, raw_bytes)
            if frame is None:
                continue

            recognized_at = datetime.now(timezone.utc)
            frame_result = await asyncio.to_thread(
                recognition_service.process_frame,
                sid,
                frame,
                recognized_at,
            )

            await ws_manager.broadcast_dashboard(
                sid,
                {
                    "type": "overlay",
                    "payload": {
                        "frame_width": int(frame.shape[1]),
                        "frame_height": int(frame.shape[0]),
                        "faces": [
                            {
                                "event_type": item.event_type,
                                "student_id": item.student_id,
                                "full_name": item.full_name,
                                "confidence": item.confidence,
                                "left": item.left,
                                "top": item.top,
                                "right": item.right,
                                "bottom": item.bottom,
                                "engine_mode": item.engine_mode,
                                "session_absent_hours": item.session_absent_hours,
                            }
                            for item in frame_result.overlays
                        ],
                    },
                },
            )

            for recognition_event in frame_result.notifications:
                await ws_manager.broadcast_dashboard(
                    sid,
                    {
                        "type": "presence",
                        "payload": {
                            "student_id": recognition_event.student_id,
                            "event_type": recognition_event.event_type,
                            "full_name": recognition_event.full_name,
                            "confidence": recognition_event.confidence,
                            "is_present": recognition_event.is_present,
                            "recognized_at": recognition_event.recognized_at,
                            "engine_mode": recognition_event.engine_mode,
                            "session_absent_hours": recognition_event.session_absent_hours,
                        },
                    },
                )
    except Exception:
        pass
    finally:
        _recognition_locks[sid] = False
        if _latest_frames.get(sid) is not None and not _recognition_locks.get(sid, False):
            _recognition_locks[sid] = True
            asyncio.create_task(_run_recognition(sid))


@app.websocket("/ws/camera/{session_id}")
async def camera_ws(
    websocket: WebSocket,
    session_id: str,
    token: Optional[str] = Query(default=None),
) -> None:
    professor = _validate_ws_token(token)
    if not professor:
        await websocket.close(code=4001)
        return
    if int(professor.get("course_id", -1)) != _ws_session_course(session_id):
        await websocket.close(code=4003)
        return

    await ws_manager.connect_camera(session_id, websocket)

    frame_count = 0

    try:
        while True:
            message = await websocket.receive()

            if message.get("type") == "websocket.disconnect":
                break

            if "text" in message and message["text"]:
                try:
                    payload = json.loads(message["text"])
                    if payload.get("type") == "ping":
                        await websocket.send_json({"type": "pong"})
                except Exception:
                    pass
                continue

            raw_bytes = message.get("bytes")
            if not raw_bytes:
                continue

            if not recognition_service or not face_engine:
                if frame_count % 120 == 0:
                    await ws_manager.broadcast_dashboard(
                        session_id,
                        {
                            "type": "warning",
                            "message": face_engine_error or "Face engine is unavailable.",
                        },
                    )
                frame_count += 1
                continue

            frame_count += 1
            if frame_count % max(settings.recognition_frame_stride, 1) != 0:
                continue

            _latest_frames[session_id] = raw_bytes

            if _recognition_locks.get(session_id, False):
                continue

            if frame_count % 120 == 0:
                known_count = recognition_service.known_face_count_for_session(session_id)
                if known_count == 0:
                    await ws_manager.broadcast_dashboard(
                        session_id,
                        {
                            "type": "warning",
                            "message": (
                                "No registered face embeddings for this course. "
                                "Upload student photos and register them at /api/students/{id}/face."
                            ),
                        },
                    )

            _recognition_locks[session_id] = True
            asyncio.create_task(_run_recognition(session_id))

    except WebSocketDisconnect:
        _latest_frames.pop(session_id, None)
        ws_manager.disconnect_camera(session_id, websocket)
    except Exception as exc:
        _latest_frames.pop(session_id, None)
        ws_manager.disconnect_camera(session_id, websocket)
        await ws_manager.broadcast_dashboard(
            session_id,
            {"type": "warning", "message": f"Camera socket error: {exc}"},
        )
