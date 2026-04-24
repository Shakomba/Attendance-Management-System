"""Passive anti-spoofing for the attendance pipeline.

Primary detector: CNN-based PAD using MiniFASNet (see pad_cnn.py).  The old
hand-crafted Laplacian / LBP / FFT combo has been removed — those heuristics
were trivially defeated by good-quality phone screens and routinely rejected
legitimate users.

Two public entry points:

* ``analyze(frame_bgr, bbox)`` — single-frame live/spoof decision, used during
  enrollment where each captured pose already enforces diversity over time.

* ``analyze_temporal(frame_bgr, bbox, track_key)`` — sliding-window aggregate
  over the last ``antispoof_window_frames`` CNN predictions for the given
  track_key.  Passes when at least ``antispoof_required_live_frames`` are live;
  fails fast when enough spoof frames accumulate that the threshold can no
  longer be reached.  Used by the real-time recognition path so a single noisy
  frame doesn't flip a verdict.

When no ONNX models are loaded (e.g. first-run before running
scripts/convert_pad_models.py) the detector logs a warning and reports every
frame as live.  That keeps attendance usable but means no anti-spoof protection
is in place; check the startup logs if you care about that.
"""

from __future__ import annotations

import logging
import time
from collections import deque
from dataclasses import dataclass
from typing import Any, Deque, Dict, List, Tuple

import numpy as np

from ..config import settings
from .pad_cnn import CnnPadDetector, PadPrediction

_log = logging.getLogger("spoof")


@dataclass
class SpoofResult:
    is_live: bool
    confidence: float  # 0..1 — higher = more confident live
    reason: str        # non-empty when is_live=False or degraded
    cnn_available: bool = True


@dataclass
class TemporalSpoofResult:
    # state ∈ {"live", "spoof", "verifying"}
    state: str
    confidence: float
    reason: str
    live_frames: int
    total_frames: int
    last_score: float


class SpoofDetector:
    def __init__(self) -> None:
        self.enabled: bool = settings.antispoof_enabled
        self.window_size: int = max(1, settings.antispoof_window_frames)
        self.required_live: int = max(1, settings.antispoof_required_live_frames)
        self.live_threshold: float = settings.antispoof_live_threshold
        self.track_ttl_sec: float = max(1.0, settings.antispoof_track_ttl_sec)

        if self.required_live > self.window_size:
            _log.warning(
                "antispoof_required_live_frames (%d) > window (%d); clamping.",
                self.required_live, self.window_size,
            )
            self.required_live = self.window_size

        self.pad = CnnPadDetector(live_threshold=self.live_threshold) if self.enabled else None

        if self.enabled and self.pad is not None and not self.pad.available:
            _log.warning(
                "CNN PAD weights missing — spoof checks DISABLED at runtime. "
                "Attendance will still work; run scripts/convert_pad_models.py to enable protection."
            )

        # track_key -> deque[(ts, is_live, live_score)]
        self._history: Dict[Any, Deque[Tuple[float, bool, float]]] = {}
        self._last_prune: float = time.time()

    # ── public API ────────────────────────────────────────────────────────────

    def analyze(
        self,
        frame_bgr: np.ndarray,
        bbox: Tuple[int, int, int, int],
    ) -> SpoofResult:
        """Single-frame live/spoof decision."""
        if not self._effective_enabled():
            return SpoofResult(
                is_live=True, confidence=1.0, reason="",
                cnn_available=bool(self.pad and self.pad.available),
            )

        pred = self.pad.predict(frame_bgr, bbox)  # type: ignore[union-attr]
        return self._result_from_prediction(pred)

    def analyze_temporal(
        self,
        frame_bgr: np.ndarray,
        bbox: Tuple[int, int, int, int],
        track_key: Any,
    ) -> TemporalSpoofResult:
        """Sliding-window aggregate of recent CNN predictions for this track."""
        if not self._effective_enabled():
            return TemporalSpoofResult(
                state="live", confidence=1.0, reason="",
                live_frames=0, total_frames=0, last_score=1.0,
            )

        pred = self.pad.predict(frame_bgr, bbox)  # type: ignore[union-attr]

        now = time.time()
        hist = self._history.setdefault(track_key, deque(maxlen=self.window_size))
        hist.append((now, pred.is_live, pred.live_score))
        self._prune(now)

        total = len(hist)
        live_count = sum(1 for _, is_live, _ in hist if is_live)
        spoof_count = total - live_count
        avg_score = float(np.mean([s for _, _, s in hist])) if hist else 0.0

        # Enough live frames — pass.
        if live_count >= self.required_live:
            return TemporalSpoofResult(
                state="live",
                confidence=round(avg_score, 4),
                reason="",
                live_frames=live_count,
                total_frames=total,
                last_score=pred.live_score,
            )

        # Mathematically cannot reach required_live even if every remaining slot
        # were live — fail fast.
        max_reachable_live = live_count + (self.window_size - total)
        if max_reachable_live < self.required_live:
            return TemporalSpoofResult(
                state="spoof",
                confidence=round(1.0 - avg_score, 4),
                reason=(
                    f"cnn-pad avg={avg_score:.2f} live={live_count}/{total} "
                    f"thr={self.live_threshold:.2f}"
                ),
                live_frames=live_count,
                total_frames=total,
                last_score=pred.live_score,
            )

        # Still collecting evidence.
        return TemporalSpoofResult(
            state="verifying",
            confidence=round(avg_score, 4),
            reason=f"verifying {live_count}/{self.required_live}",
            live_frames=live_count,
            total_frames=total,
            last_score=pred.live_score,
        )

    def reset_track(self, track_key: Any) -> None:
        self._history.pop(track_key, None)

    def reset_all(self) -> None:
        self._history.clear()

    # ── internals ────────────────────────────────────────────────────────────

    def _effective_enabled(self) -> bool:
        return bool(self.enabled and self.pad is not None and self.pad.available)

    def _result_from_prediction(self, pred: PadPrediction) -> SpoofResult:
        if not pred.available:
            return SpoofResult(
                is_live=True, confidence=pred.live_score, reason="cnn-unavailable",
                cnn_available=False,
            )
        reason = "" if pred.is_live else (
            f"cnn-pad={pred.live_score:.3f}<{self.live_threshold:.2f}"
        )
        return SpoofResult(
            is_live=pred.is_live,
            confidence=round(pred.live_score, 4),
            reason=reason,
            cnn_available=True,
        )

    def _prune(self, now: float) -> None:
        if now - self._last_prune < 2.0:
            return
        self._last_prune = now
        stale: List[Any] = []
        for key, dq in self._history.items():
            while dq and (now - dq[0][0]) > self.track_ttl_sec:
                dq.popleft()
            if not dq:
                stale.append(key)
        for key in stale:
            self._history.pop(key, None)
