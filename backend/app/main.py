import asyncio
import base64
import json
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Optional

from fastapi import Depends, FastAPI, File, HTTPException, Query, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

from .auth import create_access_token, decode_token, get_current_professor
from .config import settings
from .demo_repo import DemoRepository
from .repos import Repository
from .schemas import (
    BulkEmailRequest,
    BulkEmailResponse,
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
from .services.face_engine import FaceEngine
from .services.recognition_service import RecognitionService
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
recognition_service: Optional[RecognitionService] = None

try:
    face_engine = FaceEngine()
    recognition_service = RecognitionService(repo, face_engine)
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
    professor: dict = Depends(get_current_professor),
) -> GenericMessage:
    if not face_engine:
        raise HTTPException(status_code=503, detail=face_engine_error or "Face engine not initialized.")

    if image.content_type not in _ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="Only JPEG, PNG, and WebP images are supported.")

    image_bytes = await image.read()
    if len(image_bytes) > _MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image file too large (max 10 MB).")

    frame = face_engine.decode_image_bytes(image_bytes)
    if frame is None:
        raise HTTPException(status_code=400, detail="Could not decode image file.")

    embedding = face_engine.extract_embedding(frame)
    if embedding is None:
        raise HTTPException(status_code=400, detail="No face detected in uploaded image.")

    repo.upsert_face_embedding(student_id, face_engine.model_name, face_engine.embedding_to_bytes(embedding))
    return GenericMessage(
        message="Face embedding saved.",
        data={"student_id": student_id, "model_name": face_engine.model_name, "ai_mode": face_engine.mode},
    )


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
    professor: dict = Depends(get_current_professor),
) -> FinalizeSessionResponse:
    _get_session_or_403(professor, session_id)
    repo.finalize_session(session_id)

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
