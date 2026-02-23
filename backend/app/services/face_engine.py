from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np

from ..config import settings


@dataclass
class MatchResult:
    student_id: int
    full_name: str
    score: float


@dataclass
class FaceDetection:
    left: int
    top: int
    right: int
    bottom: int
    embedding: np.ndarray


class FaceEngine:
    def __init__(self) -> None:
        self.mode = settings.ai_mode
        self.model_name: str
        self.distance_threshold = settings.cpu_distance_threshold
        self.similarity_threshold = settings.gpu_cosine_threshold

        if self.mode not in {"cpu", "gpu"}:
            raise ValueError("AI_MODE must be either 'cpu' or 'gpu'.")

        if self.mode == "cpu":
            try:
                import face_recognition  # type: ignore
            except Exception as exc:  # pragma: no cover
                raise RuntimeError(
                    "CPU mode requires face_recognition + dlib. Install backend requirements first."
                ) from exc

            self.face_recognition = face_recognition
            self.model_name = "hog-128"
        else:
            try:
                from insightface.app import FaceAnalysis  # type: ignore
            except Exception as exc:  # pragma: no cover
                raise RuntimeError(
                    "GPU mode requires insightface + onnxruntime-gpu. Install backend requirements first."
                ) from exc

            # CUDA provider first, CPU provider fallback
            self.face_analysis = FaceAnalysis(
                name="buffalo_l",
                providers=["CUDAExecutionProvider", "CPUExecutionProvider"],
            )
            self.face_analysis.prepare(ctx_id=0, det_size=(640, 640))
            self.model_name = "insightface-512"

    @staticmethod
    def decode_image_bytes(image_bytes: bytes) -> Optional[np.ndarray]:
        array = np.frombuffer(image_bytes, dtype=np.uint8)
        frame = cv2.imdecode(array, cv2.IMREAD_COLOR)
        return frame

    @staticmethod
    def embedding_to_bytes(embedding: np.ndarray) -> bytes:
        return embedding.astype(np.float32).tobytes()

    @staticmethod
    def bytes_to_embedding(raw: bytes) -> np.ndarray:
        return np.frombuffer(raw, dtype=np.float32)

    @staticmethod
    def _bbox_area(left: int, top: int, right: int, bottom: int) -> int:
        width = max(0, right - left)
        height = max(0, bottom - top)
        return width * height

    def detect_faces(self, frame_bgr: np.ndarray) -> List[FaceDetection]:
        detections: List[FaceDetection] = []

        if self.mode == "cpu":
            rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
            locations = self.face_recognition.face_locations(rgb, model=settings.cpu_face_detect_model)
            if not locations:
                return detections

            encodings = self.face_recognition.face_encodings(rgb, locations)
            for idx, loc in enumerate(locations):
                if idx >= len(encodings):
                    continue
                top, right, bottom, left = loc
                detections.append(
                    FaceDetection(
                        left=int(left),
                        top=int(top),
                        right=int(right),
                        bottom=int(bottom),
                        embedding=np.asarray(encodings[idx], dtype=np.float32),
                    )
                )
            return detections

        faces = self.face_analysis.get(frame_bgr)
        if not faces:
            return detections

        for face in faces:
            bbox = face.bbox.astype(int).tolist()
            detections.append(
                FaceDetection(
                    left=int(bbox[0]),
                    top=int(bbox[1]),
                    right=int(bbox[2]),
                    bottom=int(bbox[3]),
                    embedding=np.asarray(face.normed_embedding, dtype=np.float32),
                )
            )

        return detections

    def extract_embedding(self, frame_bgr: np.ndarray) -> Optional[np.ndarray]:
        detections = self.detect_faces(frame_bgr)
        if not detections:
            return None

        # Registration endpoint stores one embedding; choose the largest face in frame.
        target = max(
            detections,
            key=lambda item: self._bbox_area(item.left, item.top, item.right, item.bottom),
        )
        return target.embedding

    def match_embedding(self, candidate: np.ndarray, known_faces: List[Dict]) -> Optional[MatchResult]:
        if not known_faces:
            return None

        best_id: Optional[int] = None
        best_name: str = ""
        best_score: float

        if self.mode == "cpu":
            # Lower is better (L2 distance)
            best_score = float("inf")
            for item in known_faces:
                known = item["embedding"]
                distance = float(np.linalg.norm(candidate - known))
                if distance < best_score:
                    best_score = distance
                    best_id = int(item["student_id"])
                    best_name = str(item["full_name"])

            if best_id is None or best_score > self.distance_threshold:
                return None

            # Invert distance to a confidence-like score for display.
            confidence = max(0.0, 1.0 - best_score)
            return MatchResult(student_id=best_id, full_name=best_name, score=confidence)

        # Higher is better (cosine similarity with normalized embeddings)
        best_score = -1.0
        candidate_norm = candidate / (np.linalg.norm(candidate) + 1e-9)

        for item in known_faces:
            known = item["embedding"]
            known_norm = known / (np.linalg.norm(known) + 1e-9)
            similarity = float(np.dot(candidate_norm, known_norm))
            if similarity > best_score:
                best_score = similarity
                best_id = int(item["student_id"])
                best_name = str(item["full_name"])

        if best_id is None or best_score < self.similarity_threshold:
            return None

        return MatchResult(student_id=best_id, full_name=best_name, score=best_score)
