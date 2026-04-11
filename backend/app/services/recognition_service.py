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
    event_type: str  # "recognized", "unknown", "spoof"
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


# Seconds within which a student must show distinct matching poses.
_POSE_LIVENESS_WINDOW_SEC = 10.0
# Minimum number of distinct poses the face must match to be considered live.
# Capped to the number of enrolled poses so students with fewer poses aren't
# permanently blocked.
_POSE_LIVENESS_MIN_POSES = 2
# Distance margin: a pose counts as "matched" if its distance is within this
# margin of the best-matching pose distance.
_POSE_MATCH_MARGIN = 0.0


class RecognitionService:
    def __init__(self, repository: Any, face_engine: FaceEngine, spoof_detector: Optional[SpoofDetector] = None) -> None:
        self.repository = repository
        self.face_engine = face_engine
        self.spoof_detector = spoof_detector

        self._embedding_cache: Dict[Tuple[int, str], Dict] = {}
        self._last_event_by_student: Dict[Tuple[str, int], datetime] = {}
        self._last_unknown_event_by_session: Dict[str, datetime] = {}

        # Pose-based liveness: track which pose labels matched per (session, student).
        # {(session_id, student_id): {"poses": {pose_label: last_seen_datetime}, "first_seen": datetime}}
        self._pose_observations: Dict[Tuple[str, int], Dict] = {}

        # Temporal embedding drift: circular buffer of recent (embedding, timestamp) pairs
        # per (session_id, student_id).  Pruned to antispoof_temporal_window_sec.
        self._temporal_embeddings: Dict[Tuple[str, int], List] = {}

        # Students confirmed present this session. Once in this set all spoof checks
        # are skipped — face just gets a green overlay with no DB writes or notifications.
        # {session_id: {student_id, ...}}
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
            faces.append(
                {
                    "student_id": int(row["StudentID"]),
                    "full_name": str(row["FullName"]),
                    "embedding": FaceEngine.bytes_to_embedding(row["EmbeddingData"]),
                    "pose_label": str(row.get("PoseLabel", "front")),
                }
            )

        self._embedding_cache[cache_key] = {"loaded_at": now, "faces": faces}
        return faces

    @staticmethod
    def _group_faces_by_student(faces: List[Dict]) -> Dict[int, List[Dict]]:
        """Group known faces by student_id for multi-pose matching."""
        grouped: Dict[int, List[Dict]] = {}
        for face in faces:
            sid = face["student_id"]
            grouped.setdefault(sid, []).append(face)
        return grouped

    def _check_pose_liveness(
        self,
        session_id: str,
        student_id: int,
        candidate: np.ndarray,
        known_poses: List[Dict],
    ) -> Tuple[bool, bool]:
        """Check liveness by requiring the face to match multiple distinct stored poses over time.

        A photo shown to the camera always matches the same stored pose (whichever angle
        the photo was taken at). A real face naturally cycles through poses as the person
        moves — even subtle head movement shifts the best-matching pose.

        Returns (warmed_up, is_live):
        - warmed_up=False: still accumulating pose observations, don't mark attendance yet.
        - warmed_up=True, is_live=True: matched enough distinct poses — real face.
        - warmed_up=True, is_live=False: only ever matched one pose — likely a photo.
        """
        if len(known_poses) < 2:
            # Only one pose enrolled — can't do pose liveness. Fall back to allow.
            return True, True

        now = datetime.now(timezone.utc)
        key = (session_id, student_id)
        obs = self._pose_observations.get(key)
        if obs is None:
            obs = {"poses": {}, "first_seen": now}
            self._pose_observations[key] = obs

        # Find best matching pose for this candidate.
        if self.face_engine.mode == "cpu":
            scores = [(p["pose_label"], float(np.linalg.norm(candidate - p["embedding"]))) for p in known_poses]
            scores.sort(key=lambda x: x[1])
            best_dist = scores[0][1]
            # All poses within margin of best are considered "matched".
            matched = {label for label, dist in scores if dist <= best_dist + _POSE_MATCH_MARGIN}
        else:
            cand_norm = candidate / (np.linalg.norm(candidate) + 1e-9)
            scores = []
            for p in known_poses:
                kn = p["embedding"] / (np.linalg.norm(p["embedding"]) + 1e-9)
                scores.append((p["pose_label"], float(np.dot(cand_norm, kn))))
            scores.sort(key=lambda x: x[1], reverse=True)
            best_sim = scores[0][1]
            matched = {label for label, sim in scores if sim >= best_sim - _POSE_MATCH_MARGIN}

        for pose_label in matched:
            obs["poses"][pose_label] = now

        # Expire observations older than the liveness window.
        cutoff = now.timestamp() - _POSE_LIVENESS_WINDOW_SEC
        obs["poses"] = {k: v for k, v in obs["poses"].items() if v.timestamp() > cutoff}

        elapsed = (now - obs["first_seen"]).total_seconds()
        distinct_poses = len(obs["poses"])

        # Never require more poses than the student actually has enrolled.
        effective_min = min(_POSE_LIVENESS_MIN_POSES, len(known_poses))

        if distinct_poses >= effective_min:
            return True, True  # Saw enough distinct poses — live.

        if elapsed < _POSE_LIVENESS_WINDOW_SEC:
            return False, True  # Still in window, keep watching.

        # Window expired without enough distinct poses — likely a photo.
        return True, False

    def _check_temporal_liveness(
        self,
        session_id: str,
        student_id: int,
        embedding: np.ndarray,
        event_time: datetime,
    ) -> Tuple[bool, bool]:
        """Check liveness by measuring embedding drift across a rolling time window.

        A genuine face produces natural micro-variation in its embedding over time
        (lighting shifts, micro-movements, slight expression changes).  A held photo
        or screen produces near-identical embeddings every frame.

        Returns (warmed_up, is_live):
        - warmed_up=False: still collecting frames — don't decide yet.
        - warmed_up=True, is_live=True: enough variation detected — real face.
        - warmed_up=True, is_live=False: near-zero variation — likely a static spoof.
        """
        key = (session_id, student_id)
        history = self._temporal_embeddings.get(key)
        if history is None:
            history = []
            self._temporal_embeddings[key] = history

        history.append({"embedding": embedding.copy(), "time": event_time})

        # Prune entries outside the rolling window.
        cutoff = event_time - timedelta(seconds=settings.antispoof_temporal_window_sec)
        del history[:next((i for i, e in enumerate(history) if e["time"] >= cutoff), len(history))]

        if len(history) < 5:
            return False, True  # still warming up

        embeds = [e["embedding"] for e in history]
        total_dist = 0.0
        count = 0

        if self.face_engine.mode == "cpu":
            for i in range(len(embeds)):
                for j in range(i + 1, len(embeds)):
                    total_dist += float(np.linalg.norm(embeds[i] - embeds[j]))
                    count += 1
            mean_dist = total_dist / count if count else 0.0
            is_live = mean_dist >= settings.antispoof_temporal_threshold_cpu
        else:
            for i in range(len(embeds)):
                for j in range(i + 1, len(embeds)):
                    n1 = embeds[i] / (np.linalg.norm(embeds[i]) + 1e-9)
                    n2 = embeds[j] / (np.linalg.norm(embeds[j]) + 1e-9)
                    total_dist += 1.0 - float(np.dot(n1, n2))
                    count += 1
            mean_dist = total_dist / count if count else 0.0
            is_live = mean_dist >= settings.antispoof_temporal_threshold_gpu

        return True, is_live

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
        known_grouped = self._group_faces_by_student(known_faces)

        # Normalise to timezone-aware UTC to prevent TypeError when comparing with stored datetimes.
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

            # ── Step 1: Texture-based spoof detection ──────────────────
            if self.spoof_detector and self.spoof_detector.enabled:
                crop = SpoofDetector.extract_face_crop(
                    frame_bgr, detection.left, detection.top, detection.right, detection.bottom,
                )
                if crop is not None:
                    spoof_result = self.spoof_detector.analyze(crop)
                    if not spoof_result.is_live:
                        output.overlays.append(
                            FaceOverlay(
                                event_type="spoof",
                                student_id=None,
                                full_name="Spoof Detected",
                                confidence=spoof_result.confidence,
                                left=detection.left,
                                top=detection.top,
                                right=detection.right,
                                bottom=detection.bottom,
                                engine_mode=self.face_engine.mode,
                            )
                        )
                        self.repository.add_recognition_event(
                            session_id=session_id,
                            student_id=None,
                            confidence=None,
                            engine_mode=self.face_engine.mode,
                            notes=f"spoof-rejected:{spoof_result.reason}",
                            recognized_at=event_time_db,
                        )
                        continue

            # ── Step 2: Multi-embedding matching ───────────────────────
            match = None
            if known_grouped:
                match = self.face_engine.match_embedding_multi(detection.embedding, known_grouped)

            # Fallback: if all students have only a single pose, also try flat matching for compat.
            if match is None and known_faces:
                flat_match = self.face_engine.match_embedding(detection.embedding, known_faces)
                if flat_match:
                    # Wrap as multi-match result with no variance info.
                    from .face_engine import MultiMatchResult
                    match = MultiMatchResult(
                        student_id=flat_match.student_id,
                        full_name=flat_match.full_name,
                        best_score=flat_match.score,
                        score_variance=0.0,
                        is_suspicious=False,
                    )

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
                        session_absent_hours=0,
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
                        is_present=False,
                        recognized_at=event_time.isoformat(),
                        engine_mode=self.face_engine.mode,
                    )
                )
                continue

            # ── Fast-path: already confirmed present this session ──────
            if match.student_id in self._confirmed_students.get(session_id, set()):
                output.overlays.append(
                    FaceOverlay(
                        event_type="recognized",
                        student_id=match.student_id,
                        full_name=match.full_name,
                        confidence=match.best_score,
                        left=detection.left,
                        top=detection.top,
                        right=detection.right,
                        bottom=detection.bottom,
                        engine_mode=self.face_engine.mode,
                        session_absent_hours=absent_hours,
                    )
                )
                continue

            # ── Step 3: Mark attendance ────────────────────────────────
            output.overlays.append(
                FaceOverlay(
                    event_type="recognized",
                    student_id=match.student_id,
                    full_name=match.full_name,
                    confidence=match.best_score,
                    left=detection.left,
                    top=detection.top,
                    right=detection.right,
                    bottom=detection.bottom,
                    engine_mode=self.face_engine.mode,
                    session_absent_hours=absent_hours,
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
                confidence=match.best_score,
                engine_mode=self.face_engine.mode,
                notes="recognized",
                recognized_at=event_time_db,
            )
            self.repository.upsert_attendance_from_recognition(session_id, match.student_id, event_time_db)

            # Mark as confirmed so future frames skip all checks.
            self._confirmed_students.setdefault(session_id, set()).add(match.student_id)

            attendance = self.repository.get_attendance_row(session_id, match.student_id) or {}
            self._last_event_by_student[cooldown_key] = event_time

            # Don't send a presence notification for manually-overridden students —
            # the overlay box still shows (added above), but the attendance table stays as set.
            if attendance.get("_ManualLock"):
                continue

            output.notifications.append(
                RecognitionEvent(
                    event_type="recognized",
                    student_id=match.student_id,
                    full_name=match.full_name,
                    confidence=match.best_score,
                    is_present=bool(attendance.get("IsPresent", False)),
                    recognized_at=event_time.isoformat(),
                    engine_mode=self.face_engine.mode,
                    session_absent_hours=absent_hours,
                )
            )

        return output
