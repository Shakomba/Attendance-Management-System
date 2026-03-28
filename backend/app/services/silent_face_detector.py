"""Silent-Face-Anti-Spoofing wrapper using MiniFASNet models.

Replaces the passive texture-analysis SpoofDetector with a trained neural-network
liveness detector from https://github.com/minivision-ai/Silent-Face-Anti-Spoofing.

Usage:
    detector = SilentFaceDetector(models_dir="/app/silent_face_models")
    is_live, confidence = detector.is_live(frame_bgr, left, top, right, bottom)
"""
from __future__ import annotations

import os
import urllib.request
from typing import Tuple

import cv2
import numpy as np

# Model filenames → download URLs (official GitHub repo raw assets)
_MODEL_URLS: dict[str, str] = {
    "2.7_80x80_MiniFASNetV2.pth": (
        "https://github.com/minivision-ai/Silent-Face-Anti-Spoofing"
        "/raw/master/resources/anti_spoof_models/2.7_80x80_MiniFASNetV2.pth"
    ),
    "4_0_0_80x80_MiniFASNetV1SE.pth": (
        "https://github.com/minivision-ai/Silent-Face-Anti-Spoofing"
        "/raw/master/resources/anti_spoof_models/4_0_0_80x80_MiniFASNetV1SE.pth"
    ),
}

_DEFAULT_MODELS_DIR = "/app/silent_face_models"


class SilentFaceDetector:
    """Neural-network liveness detector using MiniFASNetV1SE + MiniFASNetV2.

    Inference is performed on CPU (80×80 patches — fast enough for real-time use).
    Models are downloaded automatically from GitHub on first use if not present.
    """

    def __init__(self, models_dir: str = _DEFAULT_MODELS_DIR, device_id: int = 0) -> None:
        self.models_dir = models_dir
        self.device_id = device_id
        self._predictor = None
        self._cropper = None
        self._model_paths: list[str] = []
        self._initialized = False

    # ------------------------------------------------------------------
    # Public interface (same shape as SpoofDetector for easy swapping)
    # ------------------------------------------------------------------

    @property
    def enabled(self) -> bool:
        return True

    def is_live(
        self,
        frame_bgr: np.ndarray,
        left: int,
        top: int,
        right: int,
        bottom: int,
    ) -> Tuple[bool, float]:
        """Run liveness check on the face region in *frame_bgr*.

        Args:
            frame_bgr: Full BGR camera frame.
            left, top, right, bottom: Face bounding box in pixel coordinates.

        Returns:
            (is_live, confidence) where confidence is the real-face probability in [0, 1].
        """
        if frame_bgr is None or frame_bgr.size == 0:
            return False, 0.0

        self._lazy_init()

        # Convert bounding box from (x1,y1,x2,y2) to (x,y,w,h) for CropImage.
        x = left
        y = top
        w = max(1, right - left)
        h = max(1, bottom - top)
        bbox = [x, y, w, h]

        prediction_sum: np.ndarray | None = None

        for model_path in self._model_paths:
            from .silent_face_src.utility import parse_model_name
            model_name = os.path.basename(model_path)
            h_input, w_input, _model_type, scale = parse_model_name(model_name)
            if scale is None:
                scale = 2.7  # fallback

            patch = self._cropper.crop(frame_bgr, bbox, scale, w_input, h_input)
            if patch is None or patch.size == 0:
                continue

            probs = self._predictor.predict(patch, model_path)  # shape (1, num_classes)
            if prediction_sum is None:
                prediction_sum = probs
            else:
                # Pad to the larger shape if num_classes differs between models.
                if probs.shape[1] != prediction_sum.shape[1]:
                    min_c = min(probs.shape[1], prediction_sum.shape[1])
                    prediction_sum = prediction_sum[:, :min_c] + probs[:, :min_c]
                else:
                    prediction_sum += probs

        if prediction_sum is None:
            # Could not crop any valid patch — assume live to avoid false blocks.
            return True, 1.0

        # label=1 is "real" in the original minivision implementation.
        label = int(np.argmax(prediction_sum))
        real_prob = float(prediction_sum[0, 1]) / float(prediction_sum.sum() + 1e-9)
        is_live = (label == 1)
        return is_live, round(real_prob, 4)

    # ------------------------------------------------------------------
    # Backwards-compatibility shim for code that calls .analyze() on SpoofDetector
    # ------------------------------------------------------------------

    def analyze(self, face_crop_bgr: np.ndarray) -> "_SpoofResult":
        """Compatibility wrapper: accepts a face crop (no full-frame bbox).

        Since MiniFASNet needs a full-frame crop at a specific scale, we treat
        the entire supplied crop as the "frame" and use a full-image bbox.
        This is less accurate than calling is_live() directly but avoids
        breaking callers that pass a pre-cropped image.
        """
        if face_crop_bgr is None or face_crop_bgr.size == 0:
            return _SpoofResult(is_live=False, confidence=0.0, reason="empty-crop")

        h, w = face_crop_bgr.shape[:2]
        is_live, confidence = self.is_live(face_crop_bgr, 0, 0, w, h)
        reason = "" if is_live else "minifasnet-spoof"
        return _SpoofResult(is_live=is_live, confidence=confidence, reason=reason)

    @staticmethod
    def extract_face_crop(
        frame_bgr: np.ndarray,
        left: int, top: int, right: int, bottom: int,
        padding_ratio: float = 0.15,
    ) -> np.ndarray | None:
        """Kept for API compatibility with SpoofDetector callers."""
        h, w = frame_bgr.shape[:2]
        face_w = right - left
        face_h = bottom - top
        pad_x = int(face_w * padding_ratio)
        pad_y = int(face_h * padding_ratio)
        x1 = max(0, left - pad_x)
        y1 = max(0, top - pad_y)
        x2 = min(w, right + pad_x)
        y2 = min(h, bottom + pad_y)
        crop = frame_bgr[y1:y2, x1:x2]
        return crop if crop.size > 0 else None

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _lazy_init(self) -> None:
        if self._initialized:
            return
        self._ensure_models()
        from .silent_face_src.anti_spoof_predict import AntiSpoofPredict
        from .silent_face_src.generate_patches import CropImage
        self._predictor = AntiSpoofPredict(device_id=self.device_id)
        self._cropper = CropImage()
        self._model_paths = [
            os.path.join(self.models_dir, name) for name in _MODEL_URLS
        ]
        self._initialized = True

    def _ensure_models(self) -> None:
        """Download model files from GitHub if not present."""
        os.makedirs(self.models_dir, exist_ok=True)
        for filename, url in _MODEL_URLS.items():
            dest = os.path.join(self.models_dir, filename)
            if not os.path.exists(dest):
                print(f"[SilentFace] Downloading {filename} …", flush=True)
                try:
                    urllib.request.urlretrieve(url, dest)
                    print(f"[SilentFace] Saved to {dest}", flush=True)
                except Exception as exc:
                    print(f"[SilentFace] WARNING: download failed ({exc}). "
                          f"Place {filename} in {self.models_dir} manually.", flush=True)


class _SpoofResult:
    """Minimal result object matching SpoofDetector.SpoofResult interface."""
    __slots__ = ("is_live", "confidence", "reason")

    def __init__(self, is_live: bool, confidence: float, reason: str) -> None:
        self.is_live = is_live
        self.confidence = confidence
        self.reason = reason
