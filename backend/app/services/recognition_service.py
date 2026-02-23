from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple

import numpy as np

from ..config import settings
from ..repos import Repository
from .face_engine import FaceEngine


@dataclass
class RecognitionEvent:
    event_type: str
    student_id: Optional[int]
    full_name: str
    confidence: Optional[float]
    is_late: bool
    arrival_delay_minutes: Optional[int]
    recognized_at: str
    engine_mode: str


@dataclass
class FaceOverlay:
    event_type: str
    student_id: Optional[int]
    full_name: str
    confidence: Optional[float]
    left: int
    top: int
    right: int
    bottom: int
    engine_mode: str


@dataclass
class ProcessFrameResult:
    overlays: List[FaceOverlay]
    notifications: List[RecognitionEvent]


class RecognitionService:
    def __init__(self, repository: Repository, face_engine: FaceEngine) -> None:
        self.repository = repository
        self.face_engine = face_engine

        self._embedding_cache: Dict[Tuple[int, str], Dict] = {}
        self._last_event_by_student: Dict[Tuple[str, int], datetime] = {}
        self._last_unknown_event_by_session: Dict[str, datetime] = {}

    @staticmethod
    def _to_utc_naive(value: datetime) -> datetime:
        if value.tzinfo is None:
            return value
        return value.astimezone(timezone.utc).replace(tzinfo=None)

    def _load_known_embeddings(self, course_id: int) -> List[Dict]:
        cache_key = (course_id, self.face_engine.model_name)
        now = datetime.now(timezone.utc)

        cached = self._embedding_cache.get(cache_key)
        if cached and (now - cached["loaded_at"]).total_seconds() < 60:
            return cached["faces"]

        raw_rows = self.repository.list_known_embeddings(course_id, self.face_engine.model_name)
        faces: List[Dict] = []

        for row in raw_rows:
            faces.append(
                {
                    "student_id": int(row["StudentID"]),
                    "full_name": str(row["FullName"]),
                    "embedding": FaceEngine.bytes_to_embedding(row["EmbeddingData"]),
                }
            )

        self._embedding_cache[cache_key] = {"loaded_at": now, "faces": faces}
        return faces

    def known_face_count_for_session(self, session_id: str) -> int:
        session = self.repository.get_session(session_id)
        if not session:
            return 0
        course_id = int(session["CourseID"])
        return len(self._load_known_embeddings(course_id))

    def process_frame(
        self,
        session_id: str,
        frame_bgr: np.ndarray,
        recognized_at: Optional[datetime] = None,
    ) -> ProcessFrameResult:
        output = ProcessFrameResult(overlays=[], notifications=[])

        session = self.repository.get_session(session_id)
        if not session or str(session["Status"]).lower() != "active":
            return output

        course_id = int(session["CourseID"])
        detections = self.face_engine.detect_faces(frame_bgr)
        if not detections:
            return output

        known_faces = self._load_known_embeddings(course_id)
        event_time = recognized_at or datetime.now(timezone.utc)
        event_time_db = self._to_utc_naive(event_time)

        for detection in detections:
            match = self.face_engine.match_embedding(detection.embedding, known_faces) if known_faces else None
            if match is None:
                output.overlays.append(
                    FaceOverlay(
                        event_type="unknown",
                        student_id=None,
                        full_name="Unknown",
                        confidence=None,
                        left=detection.left,
                        top=detection.top,
                        right=detection.right,
                        bottom=detection.bottom,
                        engine_mode=self.face_engine.mode,
                    )
                )

                last_unknown = self._last_unknown_event_by_session.get(session_id)
                if last_unknown and (event_time - last_unknown) < timedelta(
                    seconds=settings.recognition_event_cooldown_sec
                ):
                    continue

                self.repository.add_recognition_event(
                    session_id=session_id,
                    student_id=None,
                    confidence=None,
                    engine_mode=self.face_engine.mode,
                    notes="unknown-face",
                    recognized_at=event_time_db,
                )
                self._last_unknown_event_by_session[session_id] = event_time
                output.notifications.append(
                    RecognitionEvent(
                        event_type="unknown",
                        student_id=None,
                        full_name="Unknown Face",
                        confidence=None,
                        is_late=False,
                        arrival_delay_minutes=None,
                        recognized_at=event_time.isoformat(),
                        engine_mode=self.face_engine.mode,
                    )
                )
                continue

            output.overlays.append(
                FaceOverlay(
                    event_type="recognized",
                    student_id=match.student_id,
                    full_name=match.full_name,
                    confidence=match.score,
                    left=detection.left,
                    top=detection.top,
                    right=detection.right,
                    bottom=detection.bottom,
                    engine_mode=self.face_engine.mode,
                )
            )

            # Cooldown to avoid repeated toasts for the same student every frame.
            cooldown_key = (session_id, match.student_id)
            last_event_time = self._last_event_by_student.get(cooldown_key)
            if last_event_time and (event_time - last_event_time) < timedelta(
                seconds=settings.recognition_event_cooldown_sec
            ):
                self.repository.upsert_attendance_from_recognition(session_id, match.student_id, event_time_db)
                continue

            self.repository.add_recognition_event(
                session_id=session_id,
                student_id=match.student_id,
                confidence=match.score,
                engine_mode=self.face_engine.mode,
                notes="recognized",
                recognized_at=event_time_db,
            )
            self.repository.upsert_attendance_from_recognition(session_id, match.student_id, event_time_db)

            attendance = self.repository.get_attendance_row(session_id, match.student_id) or {}
            self._last_event_by_student[cooldown_key] = event_time
            output.notifications.append(
                RecognitionEvent(
                    event_type="recognized",
                    student_id=match.student_id,
                    full_name=match.full_name,
                    confidence=match.score,
                    is_late=bool(attendance.get("IsLate", False)),
                    arrival_delay_minutes=attendance.get("ArrivalDelayMinutes"),
                    recognized_at=event_time.isoformat(),
                    engine_mode=self.face_engine.mode,
                )
            )

        return output
