from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import numpy as np

from ..config import settings
from .face_engine import FaceEngine
from .spoof_detector import SpoofDetector

POSES: List[str] = ["front", "left", "right", "up", "down"]

# Number of consecutive valid frames required before a pose is accepted (~1.5 s at effective 2 fps).
MIN_POSE_HOLD_FRAMES: int = 3

POSE_INSTRUCTIONS: Dict[str, str] = {
    "front": "Look straight at the camera",
    "left": "Turn your head to the LEFT",
    "right": "Turn your head to the RIGHT",
    "up": "Tilt your head UP slightly",
    "down": "Tilt your head DOWN slightly",
}

# Required head pose angle ranges per instruction (GPU mode only, InsightFace convention).
# pitch: positive = looking down, negative = looking up
# yaw: positive = subject turns right (right cheek visible), negative = subject turns left
# A flat photo held in front of the camera reports near-zero yaw/pitch regardless of camera angle.
_POSE_ANGLE_REQUIREMENTS: Dict[str, Dict[str, tuple]] = {
    "front": {"yaw": (-25.0, 25.0),  "pitch": (-25.0, 25.0)},
    "left":  {"yaw": (-70.0, -12.0), "pitch": (-35.0, 35.0)},
    "right": {"yaw": (12.0, 70.0),   "pitch": (-35.0, 35.0)},
    "up":    {"yaw": (-35.0, 35.0),  "pitch": (-65.0, -12.0)},
    "down":  {"yaw": (-35.0, 35.0),  "pitch": (12.0, 65.0)},
}


def _pose_angle_ok(pose_tuple: Optional[tuple], instruction: str) -> bool:
    """Return True if the detected head pose matches the required instruction angle.

    pose_tuple is (pitch, yaw, roll) from InsightFace.  Returns True when pose
    data is unavailable (CPU mode) so the check is a no-op.
    """
    if pose_tuple is None:
        return True
    requirements = _POSE_ANGLE_REQUIREMENTS.get(instruction)
    if not requirements:
        return True
    try:
        pitch, yaw, _roll = pose_tuple
        yaw_min, yaw_max = requirements["yaw"]
        pitch_min, pitch_max = requirements["pitch"]
        return (yaw_min <= yaw <= yaw_max) and (pitch_min <= pitch <= pitch_max)
    except Exception:
        return True


@dataclass
class EnrollmentState:
    student_id: int
    model_name: str
    captured_poses: Dict[str, np.ndarray] = field(default_factory=dict)
    current_pose_index: int = 0
    started_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    pose_consecutive_valid: int = 0  # consecutive frames with face held at current pose

    @property
    def current_pose(self) -> Optional[str]:
        if self.current_pose_index >= len(POSES):
            return None
        return POSES[self.current_pose_index]

    @property
    def is_complete(self) -> bool:
        return len(self.captured_poses) >= settings.enrollment_required_poses

    @property
    def progress(self) -> int:
        return len(self.captured_poses)


class EnrollmentService:
    """Manages multi-angle enrollment flows for anti-spoofing."""

    def __init__(
        self,
        face_engine: FaceEngine,
        spoof_detector: SpoofDetector,
        repository: Any,
    ) -> None:
        self.face_engine = face_engine
        self.spoof_detector = spoof_detector
        self.repository = repository
        self._active: Dict[int, EnrollmentState] = {}

    def start_enrollment(self, student_id: int) -> Dict[str, Any]:
        """Initialize enrollment state for a student."""
        state = EnrollmentState(
            student_id=student_id,
            model_name=self.face_engine.model_name,
        )
        self._active[student_id] = state

        pose = state.current_pose
        return {
            "student_id": student_id,
            "current_pose": pose,
            "message": POSE_INSTRUCTIONS.get(pose, ""),
            "progress": 0,
            "total_poses": len(POSES),
        }

    def cancel_enrollment(self, student_id: int) -> None:
        """Cancel and clean up an active enrollment."""
        self._active.pop(student_id, None)

    def get_status(self, student_id: int) -> Dict[str, Any]:
        """Return the current enrollment progress for a student."""
        state = self._active.get(student_id)
        captured = list(state.captured_poses.keys()) if state else []
        remaining = [p for p in POSES if p not in captured]
        db_status = self.repository.get_student_enrollment_status(student_id)

        return {
            "student_id": student_id,
            "enrollment_status": db_status,
            "captured_poses": captured,
            "remaining_poses": remaining,
            "in_progress": state is not None,
        }

    def process_frame(self, student_id: int, frame_bgr: np.ndarray) -> Dict[str, Any]:
        """Process one frame during enrollment.

        Returns a status dict suitable for sending over WebSocket.
        """
        state = self._active.get(student_id)
        if not state:
            return {"type": "error", "message": "No active enrollment for this student."}

        if state.is_complete:
            return {"type": "error", "message": "Enrollment already complete."}

        current_pose = state.current_pose
        if current_pose is None:
            return {"type": "error", "message": "All poses captured."}

        # Detect the largest face in the frame.
        detections = self.face_engine.detect_faces(frame_bgr)
        if not detections:
            state.pose_consecutive_valid = 0  # reset hold counter
            return {
                "type": "pose_rejected",
                "pose": current_pose,
                "reason": "No face detected. Please position your face in the frame.",
                "progress": state.progress,
                "total_poses": len(POSES),
            }

        # Use the largest face.
        target = max(
            detections,
            key=lambda d: self.face_engine._bbox_area(d.left, d.top, d.right, d.bottom),
        )

        # Validate head pose angle (GPU only — pose is None in CPU mode).
        if not _pose_angle_ok(target.pose, current_pose):
            state.pose_consecutive_valid = 0
            return {
                "type": "pose_hold",
                "pose": current_pose,
                "message": POSE_INSTRUCTIONS.get(current_pose, ""),
                "frames_remaining": MIN_POSE_HOLD_FRAMES,
                "progress": state.progress,
                "total_poses": len(POSES),
            }

        # Run spoof detection on the face crop.
        crop = SpoofDetector.extract_face_crop(
            frame_bgr, target.left, target.top, target.right, target.bottom,
        )
        if crop is not None:
            spoof_result = self.spoof_detector.analyze(crop)
            if not spoof_result.is_live:
                state.pose_consecutive_valid = 0  # reset hold counter
                return {
                    "type": "spoof_detected",
                    "pose": current_pose,
                    "reason": f"Flat image detected ({spoof_result.reason}). Please use your real face.",
                    "progress": state.progress,
                    "total_poses": len(POSES),
                }

        embedding = target.embedding

        # Validate diversity against previously captured poses.
        if state.captured_poses:
            test_poses = {**state.captured_poses, current_pose: embedding}
            is_diverse, diversity_reason = self.face_engine.validate_pose_diversity(test_poses)
            # Only enforce diversity after we have front + at least one other pose.
            if not is_diverse and len(test_poses) >= 2:
                state.pose_consecutive_valid = 0  # reset hold counter
                return {
                    "type": "pose_rejected",
                    "pose": current_pose,
                    "reason": f"Pose too similar to previous captures. {diversity_reason}",
                    "progress": state.progress,
                    "total_poses": len(POSES),
                }

        # Require the user to hold the pose for MIN_POSE_HOLD_FRAMES consecutive valid frames.
        state.pose_consecutive_valid += 1
        if state.pose_consecutive_valid < MIN_POSE_HOLD_FRAMES:
            frames_left = MIN_POSE_HOLD_FRAMES - state.pose_consecutive_valid
            return {
                "type": "pose_hold",
                "pose": current_pose,
                "message": POSE_INSTRUCTIONS.get(current_pose, ""),
                "frames_remaining": frames_left,
                "progress": state.progress,
                "total_poses": len(POSES),
            }

        # Accept this pose — reset hold counter for the next pose.
        state.pose_consecutive_valid = 0
        state.captured_poses[current_pose] = embedding
        state.current_pose_index += 1

        if state.is_complete:
            return self._try_complete(student_id)

        next_pose = state.current_pose
        return {
            "type": "pose_captured",
            "pose": current_pose,
            "next_pose": next_pose,
            "message": POSE_INSTRUCTIONS.get(next_pose, ""),
            "progress": state.progress,
            "total_poses": len(POSES),
        }

    def _try_complete(self, student_id: int) -> Dict[str, Any]:
        """Validate all poses and persist embeddings."""
        state = self._active.get(student_id)
        if not state:
            return {"type": "error", "message": "No active enrollment."}

        # Final diversity check across all poses.
        is_diverse, reason = self.face_engine.validate_pose_diversity(state.captured_poses)
        if not is_diverse:
            # Reset — require re-enrollment.
            self._active.pop(student_id, None)
            return {
                "type": "enrollment_failed",
                "reason": reason,
            }

        # Persist each pose embedding.
        for pose_label, embedding in state.captured_poses.items():
            self.repository.upsert_face_embedding(
                student_id=student_id,
                model_name=state.model_name,
                embedding_data=self.face_engine.embedding_to_bytes(embedding),
                pose_label=pose_label,
            )

        self.repository.mark_student_enrolled(student_id)
        self._active.pop(student_id, None)

        return {
            "type": "enrollment_complete",
            "poses_captured": len(state.captured_poses),
        }
