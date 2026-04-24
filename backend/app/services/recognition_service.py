from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import numpy as np

from ..config import settings
from .face_engine import FaceEngine
from .spoof_detector import SpoofDetector

_log = logging.getLogger("recognition")


@dataclass
class RecognitionEvent:
    event_type: str
    student_id: Optional[int]
    full_name: str
    confidence: Optional[float]
    is_present: bool
    recognized_at: str
    engine_mode: str
    session_absent_hours: int = 0


@dataclass
class FaceOverlay:
    event_type: str  # "recognized", "unknown", "spoof", "verifying"
    student_id: Optional[int]
    full_name: str
    confidence: Optional[float]
    left: int
    top: int
    right: int
    bottom: int
    engine_mode: str
    session_absent_hours: int = 0


@dataclass
class ProcessFrameResult:
    overlays: List[FaceOverlay]
    notifications: List[RecognitionEvent]


class RecognitionService:
    """Real-time recognition pipeline.

    Per detected face, per frame:
      1. Match identity against cached course embeddings.
      2. Run CNN-based PAD with sliding-window temporal aggregation keyed by
         (session_id, student_id).  Only after enough live frames accumulate
         does attendance get marked.
      3. Emit overlays + notifications and upsert attendance.
    """

    def __init__(
        self,
        repository: Any,
        face_engine: FaceEngine,
        spoof_detector: Optional[SpoofDetector] = None,
    ) -> None:
        self.repository = repository
        self.face_engine = face_engine
        self.spoof_detector = spoof_detector

        self._embedding_cache: Dict[tuple, Dict] = {}
        self._last_event_by_student: Dict[tuple, datetime] = {}
        self._last_unknown_event_by_session: Dict[str, datetime] = {}

    # ── helpers ──────────────────────────────────────────────────────────────

    @staticmethod
    def _session_absent_hours(
        session_start: datetime, event_time: datetime, grace_minutes: int,
    ) -> int:
        elapsed_minutes = (event_time - session_start).total_seconds() / 60
        if elapsed_minutes <= grace_minutes:
            return 0
        return math.ceil((elapsed_minutes - grace_minutes) / 60)

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
            faces.append({
                "student_id": int(row["StudentID"]),
                "full_name": str(row["FullName"]),
                "embedding": FaceEngine.bytes_to_embedding(row["EmbeddingData"]),
                "pose_label": str(row.get("PoseLabel", "front")),
            })
        self._embedding_cache[cache_key] = {"loaded_at": now, "faces": faces}
        return faces

    def known_face_count_for_session(self, session_id: str) -> int:
        session = self.repository.get_session(session_id)
        if not session:
            return 0
        return len(self._load_known_embeddings(int(session["CourseID"])))

    # ── main entry point ─────────────────────────────────────────────────────

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
        if event_time.tzinfo is None:
            event_time = event_time.replace(tzinfo=timezone.utc)
        event_time_db = self._to_utc_naive(event_time)

        session_start = session.get("StartedAt")
        if session_start is not None and getattr(session_start, "tzinfo", None) is None:
            session_start = session_start.replace(tzinfo=timezone.utc)
        grace_minutes = 10

        for detection in detections:
            bbox = (detection.left, detection.top, detection.right, detection.bottom)
            absent_hours = (
                self._session_absent_hours(session_start, event_time, grace_minutes)
                if session_start is not None else 0
            )

            # 1. Identity match ────────────────────────────────────────────
            match = self.face_engine.match_embedding(detection.embedding, known_faces) if known_faces else None

            if match is None:
                output.overlays.append(FaceOverlay(
                    event_type="unknown", student_id=None, full_name="Unknown",
                    confidence=None,
                    left=detection.left, top=detection.top,
                    right=detection.right, bottom=detection.bottom,
                    engine_mode=self.face_engine.mode, session_absent_hours=0,
                ))
                last_unknown = self._last_unknown_event_by_session.get(session_id)
                if last_unknown and (event_time - last_unknown) < timedelta(seconds=settings.recognition_event_cooldown_sec):
                    continue
                self.repository.add_recognition_event(
                    session_id=session_id, student_id=None, confidence=None,
                    engine_mode=self.face_engine.mode, notes="unknown-face",
                    recognized_at=event_time_db,
                )
                self._last_unknown_event_by_session[session_id] = event_time
                output.notifications.append(RecognitionEvent(
                    event_type="unknown", student_id=None, full_name="Unknown Face",
                    confidence=None, is_present=False,
                    recognized_at=event_time.isoformat(), engine_mode=self.face_engine.mode,
                ))
                continue

            # 2. CNN PAD with temporal aggregation ─────────────────────────
            track_key = (session_id, match.student_id)
            pad_state = "live"
            pad_reason = ""
            pad_confidence: Optional[float] = match.score

            if self.spoof_detector is not None:
                pad_result = self.spoof_detector.analyze_temporal(
                    frame_bgr, bbox, track_key,
                )
                pad_state = pad_result.state
                pad_reason = pad_result.reason
                pad_confidence = pad_result.confidence

            _log.debug(
                "PAD session=%s student=%s state=%s last_score=%.3f live=%d/%d",
                session_id, match.student_id, pad_state,
                getattr(pad_result, "last_score", 1.0) if self.spoof_detector else 1.0,
                getattr(pad_result, "live_frames", 0) if self.spoof_detector else 0,
                getattr(pad_result, "total_frames", 0) if self.spoof_detector else 0,
            )

            if pad_state == "verifying":
                output.overlays.append(FaceOverlay(
                    event_type="verifying", student_id=match.student_id,
                    full_name=match.full_name, confidence=pad_confidence,
                    left=detection.left, top=detection.top,
                    right=detection.right, bottom=detection.bottom,
                    engine_mode=self.face_engine.mode, session_absent_hours=absent_hours,
                ))
                continue

            if pad_state == "spoof":
                output.overlays.append(FaceOverlay(
                    event_type="spoof", student_id=match.student_id,
                    full_name=f"{match.full_name} (Spoof)",
                    confidence=pad_confidence,
                    left=detection.left, top=detection.top,
                    right=detection.right, bottom=detection.bottom,
                    engine_mode=self.face_engine.mode, session_absent_hours=absent_hours,
                ))
                self.repository.add_recognition_event(
                    session_id=session_id, student_id=match.student_id,
                    confidence=match.score, engine_mode=self.face_engine.mode,
                    notes=f"spoof-rejected:{pad_reason}",
                    recognized_at=event_time_db,
                )
                continue

            # 3. Live — mark attendance ────────────────────────────────────
            output.overlays.append(FaceOverlay(
                event_type="recognized", student_id=match.student_id,
                full_name=match.full_name, confidence=match.score,
                left=detection.left, top=detection.top,
                right=detection.right, bottom=detection.bottom,
                engine_mode=self.face_engine.mode, session_absent_hours=absent_hours,
            ))

            cooldown_key = (session_id, match.student_id)
            last_event_time = self._last_event_by_student.get(cooldown_key)
            if last_event_time and (event_time - last_event_time) < timedelta(seconds=settings.recognition_event_cooldown_sec):
                self.repository.upsert_attendance_from_recognition(session_id, match.student_id, event_time_db)
                continue

            self.repository.add_recognition_event(
                session_id=session_id, student_id=match.student_id,
                confidence=match.score, engine_mode=self.face_engine.mode,
                notes="recognized", recognized_at=event_time_db,
            )
            self.repository.upsert_attendance_from_recognition(session_id, match.student_id, event_time_db)

            attendance = self.repository.get_attendance_row(session_id, match.student_id) or {}
            self._last_event_by_student[cooldown_key] = event_time

            if attendance.get("_ManualLock"):
                continue

            output.notifications.append(RecognitionEvent(
                event_type="recognized", student_id=match.student_id,
                full_name=match.full_name, confidence=match.score,
                is_present=bool(attendance.get("IsPresent", False)),
                recognized_at=event_time.isoformat(), engine_mode=self.face_engine.mode,
                session_absent_hours=absent_hours,
            ))

        return output
