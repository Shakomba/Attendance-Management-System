from __future__ import annotations

import asyncio
import base64
import json
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .demo_repo import DemoRepository
from .repos import Repository
from .schemas import (
    FinalizeSessionResponse,
    GradeUpdateRequest,
    GenericMessage,
    ManualAttendanceUpdateRequest,
    StartSessionRequest,
    StartSessionResponse,
    StudentCreateRequest,
)
from .services.email_service import EmailService
from .services.face_engine import FaceEngine
from .services.recognition_service import RecognitionService
from .websocket_manager import WebSocketManager


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

allow_origins = list(settings.cors_origins) if settings.cors_origins else ["*"]
if "*" in allow_origins:
    allow_origins = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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
def list_courses() -> dict:
    return {"items": repo.list_courses()}


@app.post("/api/students", response_model=GenericMessage)
def create_student(payload: StudentCreateRequest) -> GenericMessage:
    result = repo.create_student_and_enroll(payload.model_dump())
    return GenericMessage(message="Student created and enrolled.", data=result)


@app.post("/api/students/{student_id}/face", response_model=GenericMessage)
async def upload_student_face(student_id: int, image: UploadFile = File(...)) -> GenericMessage:
    if not face_engine:
        raise HTTPException(status_code=503, detail=face_engine_error or "Face engine not initialized.")

    image_bytes = await image.read()
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
def get_gradebook(course_id: int) -> dict:
    return {"items": repo.get_gradebook(course_id)}


@app.patch("/api/courses/{course_id}/students/{student_id}/grades", response_model=GenericMessage)
def update_student_grades(course_id: int, student_id: int, payload: GradeUpdateRequest) -> GenericMessage:
    try:
        updated = repo.update_student_grades(course_id, student_id, payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return GenericMessage(message="Grades updated.", data=updated)


@app.get("/api/debug/courses/{course_id}/embedding-count")
def get_embedding_count(course_id: int) -> dict:
    if not face_engine:
        return {"course_id": course_id, "model_name": None, "count": 0}

    rows = repo.list_known_embeddings(course_id, face_engine.model_name)
    return {"course_id": course_id, "model_name": face_engine.model_name, "count": len(rows)}


@app.post("/api/sessions/start", response_model=StartSessionResponse)
def start_session(payload: StartSessionRequest) -> StartSessionResponse:
    started_at = payload.started_at
    if started_at and started_at.tzinfo:
        started_at = started_at.astimezone(timezone.utc).replace(tzinfo=None)

    result = repo.start_session(payload.course_id, started_at)
    return StartSessionResponse(**result)


@app.get("/api/sessions/{session_id}/attendance")
def get_session_attendance(session_id: str) -> dict:
    return {"items": repo.get_session_attendance(session_id)}


@app.patch("/api/sessions/{session_id}/students/{student_id}/attendance", response_model=GenericMessage)
def update_session_attendance(
    session_id: str, student_id: int, payload: ManualAttendanceUpdateRequest
) -> GenericMessage:
    marked_at = payload.marked_at
    if marked_at and marked_at.tzinfo:
        marked_at = marked_at.astimezone(timezone.utc).replace(tzinfo=None)

    try:
        updated = repo.set_manual_attendance(
            session_id=session_id,
            student_id=student_id,
            is_present=payload.is_present,
            is_late=payload.is_late if payload.is_present else False,
            arrival_delay_minutes=payload.arrival_delay_minutes,
            marked_at=marked_at,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return GenericMessage(message="Attendance updated.", data=updated)


@app.post("/api/sessions/{session_id}/finalize-send-emails", response_model=FinalizeSessionResponse)
def finalize_and_email(session_id: str) -> FinalizeSessionResponse:
    repo.finalize_session(session_id)
    sent, failed = email_service.send_absentee_reports(session_id)
    return FinalizeSessionResponse(session_id=session_id, emails_sent=sent, email_failures=failed)


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


@app.websocket("/ws/dashboard/{session_id}")
async def dashboard_ws(websocket: WebSocket, session_id: str) -> None:
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
            # Keep-alive/read loop so the socket remains active.
            _ = await websocket.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect_dashboard(session_id, websocket)


@app.websocket("/ws/camera/{session_id}")
async def camera_ws(websocket: WebSocket, session_id: str) -> None:
    await ws_manager.connect_camera(session_id, websocket)

    frame_count = 0

    try:
        while True:
            raw_text = await websocket.receive_text()
            payload = json.loads(raw_text)
            message_type = payload.get("type")

            if message_type == "ping":
                await websocket.send_json({"type": "pong"})
                continue

            if message_type != "frame":
                continue

            image_b64 = payload.get("image", "")
            if not image_b64:
                continue

            await ws_manager.broadcast_dashboard(
                session_id,
                {
                    "type": "frame",
                    "image": image_b64,
                    "timestamp": payload.get("timestamp"),
                },
            )

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

            frame_bytes = _decode_base64_frame(image_b64)
            if not frame_bytes:
                continue

            frame = face_engine.decode_image_bytes(frame_bytes)
            if frame is None:
                continue

            recognized_at = _parse_timestamp(payload.get("timestamp"))

            frame_result = await asyncio.to_thread(
                recognition_service.process_frame,
                session_id,
                frame,
                recognized_at,
            )

            await ws_manager.broadcast_dashboard(
                session_id,
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
                            }
                            for item in frame_result.overlays
                        ],
                    },
                },
            )

            for recognition_event in frame_result.notifications:
                await ws_manager.broadcast_dashboard(
                    session_id,
                    {
                        "type": "presence",
                        "payload": {
                            "student_id": recognition_event.student_id,
                            "event_type": recognition_event.event_type,
                            "full_name": recognition_event.full_name,
                            "confidence": recognition_event.confidence,
                            "is_late": recognition_event.is_late,
                            "arrival_delay_minutes": recognition_event.arrival_delay_minutes,
                            "recognized_at": recognition_event.recognized_at,
                            "engine_mode": recognition_event.engine_mode,
                        },
                    },
                )

    except WebSocketDisconnect:
        ws_manager.disconnect_camera(session_id, websocket)
    except Exception as exc:
        ws_manager.disconnect_camera(session_id, websocket)
        await ws_manager.broadcast_dashboard(
            session_id,
            {"type": "warning", "message": f"Camera socket error: {exc}"},
        )
