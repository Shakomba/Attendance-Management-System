from __future__ import annotations

from dataclasses import dataclass, field
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
class MultiMatchResult:
    student_id: int
    full_name: str
    best_score: float  # best match confidence (same scale as MatchResult.score)
    score_variance: float  # variance across pose matches — low = suspicious
    is_suspicious: bool  # True if variance too low (possible photo spoof)


@dataclass
class FaceDetection:
    left: int
    top: int
    right: int
    bottom: int
    embedding: np.ndarray
    # Head pose in degrees from InsightFace 3D landmarks (GPU mode only).
    # Convention: pitch=+down/-up, yaw=+right/-left (subject frame), roll=tilt.
    pose: Optional[tuple] = None  # (pitch, yaw, roll) or None


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
                import onnxruntime as ort  # type: ignore
            except Exception as exc:  # pragma: no cover
                raise RuntimeError(
                    "GPU mode requires insightface + onnxruntime-gpu. Install backend requirements first."
                ) from exc

            providers = ort.get_available_providers()
            if "CUDAExecutionProvider" not in providers:
                raise RuntimeError(
                    f"GPU mode requested but CUDAExecutionProvider is unavailable. Providers: {providers}"
                )

            self.face_analysis = FaceAnalysis(
                name="buffalo_l",
                providers=["CUDAExecutionProvider"],
            )
            self.face_analysis.prepare(ctx_id=0, det_thresh=0.35, det_size=(960, 960))
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

    @staticmethod
    def _nms(detections: List[FaceDetection], iou_threshold: float = 0.45) -> List[FaceDetection]:
        """Remove duplicate detections using non-maximum suppression.

        Keeps the detection with the largest area when two boxes overlap
        more than iou_threshold.  Runs in O(n²) which is fine for the
        handful of faces expected per frame.
        """
        if len(detections) <= 1:
            return detections

        # Sort largest area first so we always keep the best-fitting box.
        ranked = sorted(
            detections,
            key=lambda d: FaceEngine._bbox_area(d.left, d.top, d.right, d.bottom),
            reverse=True,
        )

        kept: List[FaceDetection] = []
        for candidate in ranked:
            cx1, cy1, cx2, cy2 = candidate.left, candidate.top, candidate.right, candidate.bottom
            suppressed = False
            for kept_det in kept:
                kx1, ky1, kx2, ky2 = kept_det.left, kept_det.top, kept_det.right, kept_det.bottom
                inter_x1 = max(cx1, kx1)
                inter_y1 = max(cy1, ky1)
                inter_x2 = min(cx2, kx2)
                inter_y2 = min(cy2, ky2)
                inter_w = max(0, inter_x2 - inter_x1)
                inter_h = max(0, inter_y2 - inter_y1)
                inter_area = inter_w * inter_h
                area_c = FaceEngine._bbox_area(cx1, cy1, cx2, cy2)
                area_k = FaceEngine._bbox_area(kx1, ky1, kx2, ky2)
                union_area = area_c + area_k - inter_area
                # Use the larger of standard IoU and intersection-over-min-area.
                # The latter catches a small box that is fully contained inside a
                # large box (classic double-detection of the same face at two scales).
                iou = inter_area / union_area if union_area > 0 else 0.0
                iom = inter_area / min(area_c, area_k) if min(area_c, area_k) > 0 else 0.0
                if max(iou, iom) >= iou_threshold:
                    suppressed = True
                    break
            if not suppressed:
                kept.append(candidate)

        return kept

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
            return self._nms(detections)

        faces = self.face_analysis.get(frame_bgr)

        if not faces:
            return detections

        for face in faces:
            bbox = face.bbox.astype(int).tolist()
            pose = None
            raw_pose = getattr(face, 'pose', None)
            if raw_pose is not None:
                try:
                    pose = tuple(float(v) for v in raw_pose[:3])
                except Exception:
                    pose = None
            detections.append(
                FaceDetection(
                    left=int(bbox[0]),
                    top=int(bbox[1]),
                    right=int(bbox[2]),
                    bottom=int(bbox[3]),
                    embedding=np.asarray(face.normed_embedding, dtype=np.float32),
                    pose=pose,
                )
            )

        return self._nms(detections)

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

    def match_embedding_multi(
        self,
        candidate: np.ndarray,
        known_faces_grouped: Dict[int, List[Dict]],
    ) -> Optional[MultiMatchResult]:
        """Match a candidate embedding against grouped multi-pose embeddings.

        known_faces_grouped: {student_id: [{"embedding": np.ndarray, "full_name": str, "pose_label": str}, ...]}

        Returns the best-matching student with score variance across poses.
        A real face matches the front embedding well but side poses less well (high variance).
        A photo matches all poses almost equally (low variance = suspicious).
        """
        if not known_faces_grouped:
            return None

        # Minimum variance to consider "natural" — below this is suspicious.
        variance_threshold = 0.001 if self.mode == "cpu" else 0.0005

        best_student_id: Optional[int] = None
        best_full_name: str = ""
        best_overall_score: float
        best_variance: float = 0.0

        if self.mode == "cpu":
            best_overall_score = float("inf")
            for student_id, poses in known_faces_grouped.items():
                scores = []
                for pose in poses:
                    distance = float(np.linalg.norm(candidate - pose["embedding"]))
                    scores.append(distance)

                best_dist = min(scores)
                if best_dist < best_overall_score:
                    best_overall_score = best_dist
                    best_student_id = student_id
                    best_full_name = poses[0]["full_name"]
                    best_variance = float(np.var(scores)) if len(scores) > 1 else 0.0

            if best_student_id is None or best_overall_score > self.distance_threshold:
                return None

            confidence = max(0.0, 1.0 - best_overall_score)
            return MultiMatchResult(
                student_id=best_student_id,
                full_name=best_full_name,
                best_score=confidence,
                score_variance=best_variance,
                is_suspicious=best_variance < variance_threshold and len(known_faces_grouped.get(best_student_id, [])) > 1,
            )

        # GPU: cosine similarity (higher = better)
        best_overall_score = -1.0
        candidate_norm = candidate / (np.linalg.norm(candidate) + 1e-9)

        for student_id, poses in known_faces_grouped.items():
            scores = []
            for pose in poses:
                known_norm = pose["embedding"] / (np.linalg.norm(pose["embedding"]) + 1e-9)
                similarity = float(np.dot(candidate_norm, known_norm))
                scores.append(similarity)

            best_sim = max(scores)
            if best_sim > best_overall_score:
                best_overall_score = best_sim
                best_student_id = student_id
                best_full_name = poses[0]["full_name"]
                best_variance = float(np.var(scores)) if len(scores) > 1 else 0.0

        if best_student_id is None or best_overall_score < self.similarity_threshold:
            return None

        return MultiMatchResult(
            student_id=best_student_id,
            full_name=best_full_name,
            best_score=best_overall_score,
            score_variance=best_variance,
            is_suspicious=best_variance < variance_threshold and len(known_faces_grouped.get(best_student_id, [])) > 1,
        )

    def validate_pose_diversity(self, embeddings: Dict[str, np.ndarray]) -> Tuple[bool, str]:
        """Validate that captured pose embeddings are sufficiently diverse.

        Used during enrollment to ensure the subject is a real 3D face.
        A flat photo produces nearly identical embeddings regardless of
        the "angle" it's shown at, so pairwise distances will be very small.

        Returns (is_valid, reason).
        """
        if len(embeddings) < 2:
            return True, ""

        threshold = settings.enrollment_pose_distance_threshold
        labels = list(embeddings.keys())
        vectors = [embeddings[label] for label in labels]

        max_distance = 0.0
        pair_distances = []

        for i in range(len(vectors)):
            for j in range(i + 1, len(vectors)):
                if self.mode == "cpu":
                    dist = float(np.linalg.norm(vectors[i] - vectors[j]))
                else:
                    # Cosine distance = 1 - cosine_similarity
                    norm_i = vectors[i] / (np.linalg.norm(vectors[i]) + 1e-9)
                    norm_j = vectors[j] / (np.linalg.norm(vectors[j]) + 1e-9)
                    dist = 1.0 - float(np.dot(norm_i, norm_j))

                pair_distances.append((labels[i], labels[j], dist))
                max_distance = max(max_distance, dist)

        if max_distance < threshold:
            return False, (
                f"Insufficient pose variation (max distance {max_distance:.4f} < {threshold}). "
                f"A real face is required — photos/screens are not accepted."
            )

        # Check that at least some non-front poses differ meaningfully from front.
        if "front" in embeddings:
            front_vec = embeddings["front"]
            non_front_dists = []
            for label, vec in embeddings.items():
                if label == "front":
                    continue
                if self.mode == "cpu":
                    d = float(np.linalg.norm(front_vec - vec))
                else:
                    n1 = front_vec / (np.linalg.norm(front_vec) + 1e-9)
                    n2 = vec / (np.linalg.norm(vec) + 1e-9)
                    d = 1.0 - float(np.dot(n1, n2))
                non_front_dists.append(d)

            if non_front_dists and max(non_front_dists) < threshold:
                return False, (
                    f"Non-front poses too similar to front (max {max(non_front_dists):.4f}). "
                    f"Please turn your head as instructed."
                )

        return True, ""
