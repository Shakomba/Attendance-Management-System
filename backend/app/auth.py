from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Dict, Optional

import jwt
from fastapi import Header, HTTPException, status

from .config import settings


def create_access_token(professor_id: int, username: str, course_id: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=settings.jwt_access_token_expire_minutes
    )
    payload: Dict = {
        "sub": str(professor_id),
        "role": "professor",
        "username": username,
        "course_id": course_id,
        "exp": expire,
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def create_student_token(
    student_id: int,
    full_name: str,
    full_name_kurdish: Optional[str],
    password_set: bool = True,
    expire_minutes: Optional[int] = None,
) -> str:
    if expire_minutes is None:
        expire_minutes = settings.jwt_access_token_expire_minutes
    expire = datetime.now(timezone.utc) + timedelta(minutes=expire_minutes)
    payload: Dict = {
        "sub": str(student_id),
        "role": "student",
        "full_name": full_name,
        "full_name_kurdish": full_name_kurdish,
        "password_set": password_set,
        "exp": expire,
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> Optional[Dict]:
    """Decode and validate a JWT. Returns the payload dict or None on failure."""
    try:
        return jwt.decode(
            token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm]
        )
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None


def get_current_professor(authorization: str = Header(default="")) -> Dict:
    """FastAPI dependency — validates Bearer token, asserts professor role."""
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
    if payload.get("role") != "professor":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Professor access only.",
        )
    return payload


def get_current_student(authorization: str = Header(default="")) -> Dict:
    """FastAPI dependency — validates Bearer token, asserts student role with password set."""
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
    if payload.get("role") != "student":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Student access only.",
        )
    if not payload.get("password_set", True):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Password setup required before accessing this resource.",
        )
    return payload


def get_current_student_invite(authorization: str = Header(default="")) -> Dict:
    """FastAPI dependency — one-time invite JWT for the set-password endpoint only."""
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
    if payload.get("role") != "student":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Student access only.",
        )
    if payload.get("password_set", True):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This endpoint is for first-time password setup only.",
        )
    return payload
