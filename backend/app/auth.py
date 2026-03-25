from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Dict, Optional

import jwt
from fastapi import Header, HTTPException, status

from .config import settings


def create_access_token(professor_id: int, username: str, course_id: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_access_token_expire_minutes)
    payload: Dict = {
        "sub": str(professor_id),
        "username": username,
        "course_id": course_id,
        "exp": expire,
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> Optional[Dict]:
    """Decode and validate a JWT. Returns the payload dict or None on failure."""
    try:
        return jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None


def get_current_professor(authorization: str = Header(default="")) -> Dict:
    """FastAPI dependency that validates the Bearer token and returns the payload."""
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = decode_token(token)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token is invalid or has expired.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return payload
