from __future__ import annotations

from collections import defaultdict
from typing import Dict, Set

from fastapi import WebSocket


class WebSocketManager:
    def __init__(self) -> None:
        self.dashboard_clients: Dict[str, Set[WebSocket]] = defaultdict(set)
        self.camera_clients: Dict[str, Set[WebSocket]] = defaultdict(set)

    async def connect_dashboard(self, session_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self.dashboard_clients[session_id].add(websocket)

    async def connect_camera(self, session_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self.camera_clients[session_id].add(websocket)

    def disconnect_dashboard(self, session_id: str, websocket: WebSocket) -> None:
        if session_id in self.dashboard_clients:
            self.dashboard_clients[session_id].discard(websocket)

    def disconnect_camera(self, session_id: str, websocket: WebSocket) -> None:
        if session_id in self.camera_clients:
            self.camera_clients[session_id].discard(websocket)

    async def broadcast_dashboard(self, session_id: str, payload: dict) -> None:
        dead = []
        for ws in self.dashboard_clients.get(session_id, set()):
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append(ws)

        for ws in dead:
            self.dashboard_clients[session_id].discard(ws)
