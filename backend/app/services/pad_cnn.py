"""CNN-based Presentation Attack Detection (PAD) via MiniFASNet ONNX models.

Uses MiniVision's Silent-Face-Anti-Spoofing pretrained models, exported to ONNX.
Two complementary scales run as an ensemble:
  - 2.7_80x80_MiniFASNetV2  — wider crop, captures screen bezels / hand / background
  - 4.0_0_0_80x80_MiniFASNetV1SE  — even wider, stronger against phone-screen replay

Each model outputs a 3-class score [fake_print, live, fake_3d_mask].  We softmax,
take the live probability, then average across the two models.  A frame is
classified live when the averaged live probability >= live_threshold.

Model files are loaded from `backend/app/models/pad/` at startup.  If they are
missing the detector reports available=False and the caller should fall back
gracefully.  See scripts/convert_pad_models.py for the one-time setup.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional, Tuple

import cv2
import numpy as np

_log = logging.getLogger("pad_cnn")

_MODEL_DIR = Path(__file__).resolve().parent.parent / "models" / "pad"

# (filename, crop_scale, input_size)
# Crop scale is the multiplier applied to max(face_w, face_h) to build a square
# context window around the face; MiniVision trained with these exact scales.
_MODEL_FILES: List[Tuple[str, float, int]] = [
    ("2.7_80x80_MiniFASNetV2.onnx", 2.7, 80),
    ("4_0_0_80x80_MiniFASNetV1SE.onnx", 4.0, 80),
]


@dataclass
class PadPrediction:
    is_live: bool
    live_score: float          # averaged live probability, 0..1
    available: bool            # False when no CNN weights are loaded
    per_model_scores: List[float] = field(default_factory=list)


class CnnPadDetector:
    """Low-level inference wrapper around the MiniFASNet ONNX ensemble."""

    def __init__(self, live_threshold: float = 0.55) -> None:
        self.live_threshold = live_threshold
        self._sessions: List[Tuple[object, float, int, str]] = []  # (session, scale, size, input_name)
        self.available = False
        self._load()

    def _load(self) -> None:
        try:
            import onnxruntime as ort  # noqa: F401
        except Exception as exc:  # pragma: no cover
            _log.warning("onnxruntime not installed — CNN PAD disabled: %s", exc)
            return

        import onnxruntime as ort  # second import so type checker sees it

        try:
            available_providers = ort.get_available_providers()
        except Exception:
            available_providers = ["CPUExecutionProvider"]

        providers: List[str] = []
        if "CUDAExecutionProvider" in available_providers:
            providers.append("CUDAExecutionProvider")
        providers.append("CPUExecutionProvider")

        so = ort.SessionOptions()
        so.log_severity_level = 3  # suppress noisy warnings

        loaded = 0
        for fname, scale, size in _MODEL_FILES:
            path = _MODEL_DIR / fname
            if not path.exists():
                _log.warning("PAD model file not found: %s", path)
                continue
            try:
                sess = ort.InferenceSession(str(path), sess_options=so, providers=providers)
                input_name = sess.get_inputs()[0].name
                self._sessions.append((sess, scale, size, input_name))
                loaded += 1
                _log.info(
                    "PAD model loaded: %s (scale=%.2f, size=%d, providers=%s)",
                    fname, scale, size, sess.get_providers(),
                )
            except Exception as exc:
                _log.error("Failed to load PAD model %s: %s", fname, exc)

        if loaded == 0:
            _log.error(
                "No CNN PAD models loaded — anti-spoofing DISABLED. "
                "Place .onnx files in %s, or run scripts/convert_pad_models.py",
                _MODEL_DIR,
            )
            return

        self.available = True

    @staticmethod
    def _crop_for_scale(
        frame_bgr: np.ndarray,
        bbox: Tuple[int, int, int, int],
        scale: float,
        out_size: int,
    ) -> np.ndarray:
        """Replicate Silent-Face-Anti-Spoofing's CropImage behaviour.

        Builds a square crop centered on the face, sized by
        max(face_w, face_h) * scale.  Regions that fall outside the frame are
        padded with zeros — this mimics the screen/bezel context the model was
        trained to expect.
        """
        left, top, right, bottom = bbox
        face_w = max(1, right - left)
        face_h = max(1, bottom - top)
        cx = (left + right) // 2
        cy = (top + bottom) // 2

        side = int(max(face_w, face_h) * scale)
        side = max(side, 8)

        x1 = cx - side // 2
        y1 = cy - side // 2
        x2 = x1 + side
        y2 = y1 + side

        frame_h, frame_w = frame_bgr.shape[:2]
        pad_l = max(0, -x1)
        pad_t = max(0, -y1)
        pad_r = max(0, x2 - frame_w)
        pad_b = max(0, y2 - frame_h)

        x1c = max(0, x1)
        y1c = max(0, y1)
        x2c = min(frame_w, x2)
        y2c = min(frame_h, y2)

        crop = frame_bgr[y1c:y2c, x1c:x2c]
        if pad_l or pad_t or pad_r or pad_b:
            crop = cv2.copyMakeBorder(
                crop, pad_t, pad_b, pad_l, pad_r,
                cv2.BORDER_CONSTANT, value=(0, 0, 0),
            )

        if crop.size == 0:
            return np.zeros((out_size, out_size, 3), dtype=np.uint8)

        return cv2.resize(crop, (out_size, out_size), interpolation=cv2.INTER_LINEAR)

    @staticmethod
    def _softmax(logits: np.ndarray) -> np.ndarray:
        shifted = logits - np.max(logits, axis=-1, keepdims=True)
        exp = np.exp(shifted)
        return exp / (np.sum(exp, axis=-1, keepdims=True) + 1e-9)

    def predict(self, frame_bgr: np.ndarray, bbox: Tuple[int, int, int, int]) -> PadPrediction:
        if not self.available or frame_bgr is None or frame_bgr.size == 0:
            return PadPrediction(is_live=True, live_score=1.0, available=False)

        scores: List[float] = []

        for sess, scale, size, input_name in self._sessions:
            try:
                crop = self._crop_for_scale(frame_bgr, bbox, scale, size)

                # MiniFASNet expects BGR, NCHW, float32 scaled to 0..1
                tensor = crop.astype(np.float32) / 255.0
                tensor = np.transpose(tensor, (2, 0, 1))
                tensor = np.expand_dims(tensor, axis=0)

                raw = sess.run(None, {input_name: tensor})[0]
                probs = self._softmax(raw)
                # Class 1 = live in MiniVision's convention
                live_prob = float(probs[0, 1])
                if not math.isfinite(live_prob):
                    continue
                scores.append(live_prob)
            except Exception as exc:
                _log.error("PAD inference error (scale=%.2f): %s", scale, exc)
                continue

        if not scores:
            # All inferences failed; be conservative and don't block the user,
            # but surface that the check was inconclusive.
            return PadPrediction(is_live=True, live_score=0.5, available=False)

        avg = float(sum(scores) / len(scores))
        return PadPrediction(
            is_live=avg >= self.live_threshold,
            live_score=round(avg, 4),
            available=True,
            per_model_scores=[round(s, 4) for s in scores],
        )
