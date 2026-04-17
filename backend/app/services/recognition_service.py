from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

from ..config import settings
from .face_engine import FaceEngine
from .spoof_detector import SpoofDetector


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


# ── Pose liveness constants ───────────────────────────────────────────────────
# Window in which a student must match 2+ distinct stored poses.
_POSE_LIVENESS_WINDOW_SEC = 10.0
_POSE_LIVENESS_MIN_POSES = 2
# How much slack around the best-matching pose counts as "also matched".
# 0.0 was too strict — only the single best pose ever accumulated so a real
# face that moved subtly never got a second pose credited.
# GPU cosine similarity space: 0.05 gives ~5% slack around best sim.
# CPU L2 distance space: same constant works as an additive margin.
_POSE_MATCH_MARGIN = 0.05


class RecognitionService:
    def __init__(self, repository: Any, face_engine: FaceEngine, spoof_detector: Optional[SpoofDetector] = None) -> None:
        self.repository = repository
        self.face_engine = face_engine
        self.spoof_detector = spoof_detector

        self._embedding_cache: Dict[Tuple[int, str], Dict] = {}
        self._last_event_by_student: Dict[Tuple[str, int], datetime] = {}
        self._last_unknown_event_by_session: Dict[str, datetime] = {}

        # Pose-based liveness per (session_id, student_id).
        self._pose_observations: Dict[Tuple[str, int], Dict] = {}

        # Confirmed-present fast-path: skip all spoof checks once a student passes.
        self._confirmed_students: Dict[str, set] = {}

    @staticmethod
    def _session_absent_hours(session_start: datetime, event_time: datetime, grace_minutes: int) -> int:
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

    @staticmethod
    def _group_faces_by_student(faces: List[Dict]) -> Dict[int, List[Dict]]:
        grouped: Dict[int, List[Dict]] = {}
        for face in faces:
            grouped.setdefault(face["student_id"], []).append(face)
        return grouped

    def _check_pose_liveness(
        self,
        session_id: str,
        student_id: int,
        candidate: np.ndarray,
        known_poses: List[Dict],
    ) -> Tuple[bool, bool]:
        """Require the face to match 2+ distinct stored poses within the window.

        A held-up photo always matches the same stored pose. A real face shifts
        which pose it best matches as the person makes natural micro-movements.

        Returns (warmed_up, is_live):
          warmed_up=False → still accumulating, show "verifying"
          warmed_up=True, is_live=True  → passed
          warmed_up=True, is_live=False → only one pose seen, likely a photo
        """
        if len(known_poses) < 2:
            return True, True  # Can't do pose liveness with only one stored pose.

        now = datetime.now(timezone.utc)
        key = (session_id, student_id)
        obs = self._pose_observations.get(key)
        if obs is None:
            obs = {"poses": {}, "first_seen": now}
            self._pose_observations[key] = obs

        # Find which stored poses this candidate is close to.
        if self.face_engine.mode == "cpu":
            scores = [(p["pose_label"], float(np.linalg.norm(candidate - p["embedding"]))) for p in known_poses]
            scores.sort(key=lambda x: x[1])
            best = scores[0][1]
            matched = {lbl for lbl, d in scores if d <= best + _POSE_MATCH_MARGIN}
        else:
            cand_norm = candidate / (np.linalg.norm(candidate) + 1e-9)
            scores = [(p["pose_label"], float(np.dot(cand_norm, p["embedding"] / (np.linalg.norm(p["embedding"]) + 1e-9)))) for p in known_poses]
            scores.sort(key=lambda x: x[1], reverse=True)
            best = scores[0][1]
            matched = {lbl for lbl, s in scores if s >= best - _POSE_MATCH_MARGIN}

        for lbl in matched:
            obs["poses"][lbl] = now

        # Expire old observations outside the window.
        cutoff = now.timestamp() - _POSE_LIVENESS_WINDOW_SEC
        obs["poses"] = {k: v for k, v in obs["poses"].items() if v.timestamp() > cutoff}

        elapsed = (now - obs["first_seen"]).total_seconds()
        distinct = len(obs["poses"])

        if distinct >= _POSE_LIVENESS_MIN_POSES:
            return True, True
        if elapsed < _POSE_LIVENESS_WINDOW_SEC:
            return False, True  # Still accumulating.
        return True, False  # Timed out with only one pose — photo.

    def known_face_count_for_session(self, session_id: str) -> int:
        session = self.repository.get_session(session_id)
        if not session:
            return 0
        return len(self._load_known_embeddings(int(session["CourseID"])))

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
        known_grouped = self._group_faces_by_student(known_faces)

        event_time = recognized_at or datetime.now(timezone.utc)
        if event_time.tzinfo is None:
            event_time = event_time.replace(tzinfo=timezone.utc)
        event_time_db = self._to_utc_naive(event_time)

        session_start = session.get("StartedAt")
        grace_minutes = 10
        if session_start is not None and getattr(session_start, "tzinfo", None) is None:
            session_start = session_start.replace(tzinfo=timezone.utc)

        for detection in detections:
            absent_hours = (
                self._session_absent_hours(session_start, event_time, grace_minutes)
                if session_start is not None else 0
            )

            # ── Step 1: Match identity ─────────────────────────────────
            match = None
            if known_grouped:
                match = self.face_engine.match_embedding_multi(detection.embedding, known_grouped)
            if match is None and known_faces:
                flat = self.face_engine.match_embedding(detection.embedding, known_faces)
                if flat:
                    from .face_engine import MultiMatchResult
                    match = MultiMatchResult(
                        student_id=flat.student_id,
                        full_name=flat.full_name,
                        best_score=flat.score,
                        score_variance=0.0,
                        is_suspicious=False,
                    )

            if match is None:
                output.overlays.append(FaceOverlay(
                    event_type="unknown", student_id=None, full_name="Unknown",
                    confidence=None, left=detection.left, top=detection.top,
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

            # ── Step 2: Confirmed fast-path ────────────────────────────
            if match.student_id in self._confirmed_students.get(session_id, set()):
                output.overlays.append(FaceOverlay(
                    event_type="recognized", student_id=match.student_id,
                    full_name=match.full_name, confidence=match.best_score,
                    left=detection.left, top=detection.top,
                    right=detection.right, bottom=detection.bottom,
                    engine_mode=self.face_engine.mode, session_absent_hours=absent_hours,
                ))
                continue

            # ── Step 3: Texture spoof check ────────────────────────────
            if self.spoof_detector and self.spoof_detector.enabled:
                crop = SpoofDetector.extract_face_crop(
                    frame_bgr, detection.left, detection.top, detection.right, detection.bottom,
                )
                if crop is not None:
                    spoof_result = self.spoof_detector.analyze(crop)
                    if not spoof_result.is_live:
                        output.overlays.append(FaceOverlay(
                            event_type="spoof", student_id=match.student_id,
                            full_name=f"{match.full_name} (Spoof)",
                            confidence=spoof_result.confidence,
                            left=detection.left, top=detection.top,
                            right=detection.right, bottom=detection.bottom,
                            engine_mode=self.face_engine.mode, session_absent_hours=absent_hours,
                        ))
                        self.repository.add_recognition_event(
                            session_id=session_id, student_id=match.student_id,
                            confidence=match.best_score, engine_mode=self.face_engine.mode,
                            notes=f"spoof-rejected:{spoof_result.reason}",
                            recognized_at=event_time_db,
                        )
                        continue

            # ── Step 4: Variance check ─────────────────────────────────
            if match.is_suspicious:
                # Also reset pose observations so a photo can't accumulate
                # pose matches on frames that slipped past the variance check.
                self._pose_observations.pop((session_id, match.student_id), None)
                output.overlays.append(FaceOverlay(
                    event_type="spoof", student_id=match.student_id,
                    full_name=f"{match.full_name} (Suspicious)",
                    confidence=match.best_score,
                    left=detection.left, top=detection.top,
                    right=detection.right, bottom=detection.bottom,
                    engine_mode=self.face_engine.mode, session_absent_hours=absent_hours,
                ))
                self.repository.add_recognition_event(
                    session_id=session_id, student_id=match.student_id,
                    confidence=match.best_score, engine_mode=self.face_engine.mode,
                    notes=f"spoof-suspicious:variance={match.score_variance:.6f}",
                    recognized_at=event_time_db,
                )
                continue

            # ── Step 5: Pose liveness ──────────────────────────────────
            student_poses = known_grouped.get(match.student_id, [])
            warmed_up, is_live = self._check_pose_liveness(
                session_id, match.student_id, detection.embedding, student_poses,
            )
            if not warmed_up:
                output.overlays.append(FaceOverlay(
                    event_type="verifying", student_id=match.student_id,
                    full_name=match.full_name, confidence=match.best_score,
                    left=detection.left, top=detection.top,
                    right=detection.right, bottom=detection.bottom,
                    engine_mode=self.face_engine.mode, session_absent_hours=absent_hours,
                ))
                continue
            if not is_live:
                output.overlays.append(FaceOverlay(
                    event_type="spoof", student_id=match.student_id,
                    full_name=f"{match.full_name} (Static)",
                    confidence=match.best_score,
                    left=detection.left, top=detection.top,
                    right=detection.right, bottom=detection.bottom,
                    engine_mode=self.face_engine.mode, session_absent_hours=absent_hours,
                ))
                self.repository.add_recognition_event(
                    session_id=session_id, student_id=match.student_id,
                    confidence=match.best_score, engine_mode=self.face_engine.mode,
                    notes="spoof-static:pose-liveness-failed",
                    recognized_at=event_time_db,
                )
                continue

            # ── Step 6: All checks passed — mark attendance ────────────
            output.overlays.append(FaceOverlay(
                event_type="recognized", student_id=match.student_id,
                full_name=match.full_name, confidence=match.best_score,
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
                confidence=match.best_score, engine_mode=self.face_engine.mode,
                notes="recognized", recognized_at=event_time_db,
            )
            self.repository.upsert_attendance_from_recognition(session_id, match.student_id, event_time_db)
            self._confirmed_students.setdefault(session_id, set()).add(match.student_id)

            attendance = self.repository.get_attendance_row(session_id, match.student_id) or {}
            self._last_event_by_student[cooldown_key] = event_time

            if attendance.get("_ManualLock"):
                continue

            output.notifications.append(RecognitionEvent(
                event_type="recognized", student_id=match.student_id,
                full_name=match.full_name, confidence=match.best_score,
                is_present=bool(attendance.get("IsPresent", False)),
                recognized_at=event_time.isoformat(), engine_mode=self.face_engine.mode,
                session_absent_hours=absent_hours,
            ))

        return output
