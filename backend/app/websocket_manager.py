from __future__ import annotations

import logging
from collections import defaultdict
from typing import Dict, Set

from fastapi import WebSocket
from starlette.websockets import WebSocketState

logger = logging.getLogger(__name__)


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

    async def _broadcast(self, clients: Dict[str, Set[WebSocket]], session_id: str, payload: dict) -> None:
        dead = []
        for ws in list(clients.get(session_id, set())):
            try:
                await ws.send_json(payload)
            except Exception as exc:
                dead.append(ws)
                # Only log truly unexpected errors; closed/disconnected sockets are normal.
                if ws.client_state not in (WebSocketState.DISCONNECTED,):
                    logger.warning("WebSocket send error (session=%s): %s", session_id, exc)

        for ws in dead:
            clients[session_id].discard(ws)

    async def broadcast_dashboard(self, session_id: str, payload: dict) -> None:
        await self._broadcast(self.dashboard_clients, session_id, payload)

    async def broadcast_camera(self, session_id: str, payload: dict) -> None:
        await self._broadcast(self.camera_clients, session_id, payload)
