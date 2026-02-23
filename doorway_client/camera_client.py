#!/usr/bin/env python3
"""
Doorway camera client:
- Captures webcam frames
- Streams JPEG frames over WebSocket to FastAPI server

Usage:
python camera_client.py --server ws://localhost:8000 --session <SESSION_ID> --camera 0 --fps 5
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
from datetime import datetime, timezone

import cv2
import websockets


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Doorway WebSocket camera client")
    parser.add_argument("--server", default="ws://localhost:8000", help="WebSocket server base URL")
    parser.add_argument("--session", required=True, help="Active session ID")
    parser.add_argument("--camera", type=int, default=0, help="OpenCV camera index")
    parser.add_argument("--fps", type=float, default=5.0, help="Frame rate to stream")
    parser.add_argument("--jpeg-quality", type=int, default=65, help="JPEG quality (1-100)")
    return parser.parse_args()


async def stream_camera(args: argparse.Namespace) -> None:
    interval = max(0.05, 1.0 / max(args.fps, 0.1))
    ws_url = f"{args.server.rstrip('/')}/ws/camera/{args.session}"

    cap = cv2.VideoCapture(args.camera)
    if not cap.isOpened():
        raise RuntimeError(f"Unable to open camera index {args.camera}")

    print(f"Streaming camera {args.camera} to {ws_url} at {args.fps} FPS")

    try:
        async with websockets.connect(ws_url, max_size=8 * 1024 * 1024) as ws:
            while True:
                ok, frame = cap.read()
                if not ok:
                    await asyncio.sleep(interval)
                    continue

                ok, encoded = cv2.imencode(
                    ".jpg",
                    frame,
                    [int(cv2.IMWRITE_JPEG_QUALITY), int(args.jpeg_quality)],
                )
                if not ok:
                    await asyncio.sleep(interval)
                    continue

                payload = {
                    "type": "frame",
                    "image": base64.b64encode(encoded.tobytes()).decode("utf-8"),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
                await ws.send(json.dumps(payload))
                await asyncio.sleep(interval)
    finally:
        cap.release()


if __name__ == "__main__":
    args = parse_args()
    try:
        asyncio.run(stream_camera(args))
    except KeyboardInterrupt:
        print("Stopped camera client")
