from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

import cv2
import numpy as np

from ..config import settings

logger = logging.getLogger(__name__)


@dataclass
class SpoofResult:
    is_live: bool
    confidence: float  # 0.0 (certain spoof) to 1.0 (certain live)
    laplacian_var: float
    lbp_score: float
    frequency_score: float
    reason: str  # empty if live


class SpoofDetector:
    """Passive anti-spoofing using texture and frequency analysis.

    Three complementary checks on face crops:
    1. Laplacian variance — real skin has richer micro-texture than prints/screens
    2. LBP texture histogram — printed photos show dot patterns; screens show pixel grids
    3. FFT frequency analysis — screens/prints produce moiré patterns detectable in frequency domain
    """

    # Weights for combining the three scores into a single confidence.
    _W_LAPLACIAN = 0.40
    _W_LBP = 0.35
    _W_FREQUENCY = 0.25

    def __init__(self) -> None:
        self.laplacian_threshold = settings.antispoof_laplacian_threshold
        self.lbp_threshold = settings.antispoof_lbp_threshold
        self.frequency_threshold = settings.antispoof_frequency_threshold
        self.combined_threshold = settings.antispoof_combined_threshold
        self.enabled = settings.antispoof_enabled

    def analyze(self, face_crop_bgr: np.ndarray) -> SpoofResult:
        """Run all checks on a BGR face crop and return a combined result."""
        if not self.enabled:
            return SpoofResult(
                is_live=True, confidence=1.0,
                laplacian_var=0, lbp_score=0, frequency_score=0, reason="",
            )

        if face_crop_bgr is None or face_crop_bgr.size == 0:
            return SpoofResult(
                is_live=False, confidence=0.0,
                laplacian_var=0, lbp_score=0, frequency_score=0,
                reason="empty-crop",
            )

        # Resize to standard analysis size for consistent thresholds.
        crop = cv2.resize(face_crop_bgr, (128, 128), interpolation=cv2.INTER_AREA)
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)

        lap_var = self._laplacian_variance(gray)
        lbp_score = self._lbp_texture_score(gray)
        freq_score = self._frequency_analysis(gray)

        # Normalize each metric to 0..1 where 1 = live.
        lap_norm = min(1.0, lap_var / max(self.laplacian_threshold * 2, 1e-9))
        lbp_norm = min(1.0, lbp_score / max(self.lbp_threshold * 2, 1e-9))
        freq_norm = min(1.0, freq_score / max(self.frequency_threshold * 2, 1e-9))

        confidence = (
            self._W_LAPLACIAN * lap_norm
            + self._W_LBP * lbp_norm
            + self._W_FREQUENCY * freq_norm
        )

        reasons = []
        if lap_var < self.laplacian_threshold:
            reasons.append(f"laplacian={lap_var:.1f}")
        if lbp_score < self.lbp_threshold:
            reasons.append(f"lbp={lbp_score:.3f}")
        if freq_score < self.frequency_threshold:
            reasons.append(f"freq={freq_score:.3f}")

        is_live = confidence >= self.combined_threshold
        reason = ";".join(reasons) if not is_live else ""

        logger.warning("SPOOF lap=%.1f lbp=%.4f freq=%.4f conf=%.3f live=%s", lap_var, lbp_score, freq_score, confidence, is_live)

        return SpoofResult(
            is_live=is_live,
            confidence=round(confidence, 4),
            laplacian_var=round(lap_var, 2),
            lbp_score=round(lbp_score, 4),
            frequency_score=round(freq_score, 4),
            reason=reason,
        )

    @staticmethod
    def _laplacian_variance(gray: np.ndarray) -> float:
        """Laplacian variance measures micro-texture sharpness.

        Real skin has rich, high-variance texture at the pixel level.
        Printed photos and screens have lower sharpness variance due to
        ink dots, pixel grids, and paper/glass surface smoothing.
        """
        laplacian = cv2.Laplacian(gray, cv2.CV_64F)
        return float(laplacian.var())

    @staticmethod
    def _lbp_texture_score(gray: np.ndarray) -> float:
        """Local Binary Pattern texture analysis (8-neighbor, radius=1).

        Computes LBP for each pixel by comparing to its 8 neighbors,
        then builds a histogram. Real skin has a characteristic LBP
        distribution; printed photos show periodic dot patterns and
        screens show pixel grid patterns that produce different histograms.

        Returns the standard deviation of the LBP histogram — higher
        values indicate more varied texture (real face).
        """
        h, w = gray.shape
        if h < 3 or w < 3:
            return 0.0

        center = gray[1:-1, 1:-1].astype(np.int16)

        # 8 neighbors in circular order.
        neighbors = [
            gray[0:-2, 0:-2],  # top-left
            gray[0:-2, 1:-1],  # top
            gray[0:-2, 2:],    # top-right
            gray[1:-1, 2:],    # right
            gray[2:, 2:],      # bottom-right
            gray[2:, 1:-1],    # bottom
            gray[2:, 0:-2],    # bottom-left
            gray[1:-1, 0:-2],  # left
        ]

        lbp = np.zeros_like(center, dtype=np.uint8)
        for i, nb in enumerate(neighbors):
            lbp |= ((nb.astype(np.int16) >= center).astype(np.uint8) << i)

        # Build histogram (256 bins for 8-bit LBP).
        hist, _ = np.histogram(lbp, bins=256, range=(0, 256))
        hist = hist.astype(np.float64)
        hist /= hist.sum() + 1e-9

        # Standard deviation of the normalized histogram.
        # Real faces produce a more spread distribution; flat images concentrate in fewer bins.
        return float(hist.std())

    @staticmethod
    def _frequency_analysis(gray: np.ndarray) -> float:
        """FFT-based frequency analysis for moiré pattern detection.

        Computes the 2D FFT and analyzes the ratio of mid-frequency energy
        to total energy. Screens and printed photos produce characteristic
        periodic patterns (moiré) that concentrate energy in specific
        frequency bands. Real faces have a more uniform frequency distribution.

        Returns a score where higher = more natural (live face).
        """
        f = np.fft.fft2(gray.astype(np.float64))
        fshift = np.fft.fftshift(f)
        magnitude = np.abs(fshift)

        h, w = magnitude.shape
        cy, cx = h // 2, w // 2

        # Define frequency bands.
        y_coords, x_coords = np.ogrid[:h, :w]
        dist = np.sqrt((y_coords - cy) ** 2 + (x_coords - cx) ** 2)
        max_radius = min(cy, cx)

        # Low: 0-20% radius, Mid: 20-60%, High: 60-100%
        low_mask = dist <= max_radius * 0.2
        mid_mask = (dist > max_radius * 0.2) & (dist <= max_radius * 0.6)
        high_mask = dist > max_radius * 0.6

        total_energy = magnitude.sum() + 1e-9
        low_energy = magnitude[low_mask].sum()
        mid_energy = magnitude[mid_mask].sum()
        high_energy = magnitude[high_mask].sum()

        # Ratio of mid-frequency to total: screens/prints have higher mid-frequency
        # peaks from periodic patterns. Real faces have smoother falloff.
        mid_ratio = mid_energy / total_energy

        # A natural face has mid_ratio around 0.3-0.5; periodic patterns push it higher.
        # We invert so that higher score = more natural.
        # Also check high-frequency energy which is suppressed by print/screen.
        high_ratio = high_energy / total_energy
        naturalness = high_ratio / (mid_ratio + 1e-9)

        return float(min(1.0, naturalness))

    @staticmethod
    def extract_face_crop(
        frame_bgr: np.ndarray,
        left: int, top: int, right: int, bottom: int,
        padding_ratio: float = 0.15,
    ) -> Optional[np.ndarray]:
        """Extract a face crop from a frame with padding."""
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
        if crop.size == 0:
            return None
        return crop
