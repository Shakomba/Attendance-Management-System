"""
WebAuthn (passkey) registration and authentication helpers.
Uses py-webauthn 2.x (pip: webauthn).

Challenge lifecycle:
  begin_* → stores challenge keyed by a UUID session_id → returns (session_id, options_json)
  complete_* → pops challenge, verifies credential, raises ValueError on failure
"""
from __future__ import annotations

import time
from typing import Any, Dict, List, Optional, Tuple
from uuid import uuid4

import webauthn
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptor,
    PublicKeyCredentialType,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from .config import settings

# session_id → (challenge: bytes, expires_at: float, professor_id: int | None)
_challenges: Dict[str, Tuple[bytes, float, Optional[int]]] = {}
CHALLENGE_TTL = 300  # 5 minutes


def _purge_expired() -> None:
    now = time.time()
    for k in [k for k, v in _challenges.items() if v[1] < now]:
        del _challenges[k]


# ── Registration ────────────────────────────────────────────────────────────

def begin_registration(professor_id: int, username: str, full_name: str) -> Tuple[str, str]:
    """Return (session_id, options_json) to send to the browser."""
    _purge_expired()
    options = webauthn.generate_registration_options(
        rp_id=settings.webauthn_rp_id,
        rp_name=settings.webauthn_rp_name,
        user_id=str(professor_id).encode(),
        user_name=username,
        user_display_name=full_name,
        authenticator_selection=AuthenticatorSelectionCriteria(
            user_verification=UserVerificationRequirement.REQUIRED,
            resident_key=ResidentKeyRequirement.PREFERRED,
        ),
    )
    session_id = str(uuid4())
    _challenges[session_id] = (options.challenge, time.time() + CHALLENGE_TTL, professor_id)
    return session_id, webauthn.options_to_json(options)


def complete_registration(session_id: str, credential_json: str) -> Dict[str, Any]:
    """
    Verify the browser's registration response.
    Returns dict with keys: credential_id (str), public_key (bytes), sign_count (int).
    Raises ValueError on any failure.
    """
    entry = _challenges.pop(session_id, None)
    if entry is None or entry[1] < time.time():
        raise ValueError("Registration session expired or not found.")

    challenge, _, professor_id = entry
    try:
        verification = webauthn.verify_registration_response(
            credential=credential_json,
            expected_challenge=challenge,
            expected_rp_id=settings.webauthn_rp_id,
            expected_origin=settings.webauthn_origin,
            require_user_verification=True,
        )
    except Exception as exc:
        raise ValueError(f"Registration verification failed: {exc}") from exc

    return {
        "credential_id": webauthn.helpers.bytes_to_base64url(verification.credential_id),
        "public_key": verification.credential_public_key,
        "sign_count": verification.sign_count,
        "professor_id": professor_id,
    }


# ── Authentication ───────────────────────────────────────────────────────────

def begin_authentication(credential_ids: List[bytes]) -> Tuple[str, str]:
    """Return (session_id, options_json). Pass empty list for a discoverable-credential flow."""
    _purge_expired()
    allow = [
        PublicKeyCredentialDescriptor(id=cid, type=PublicKeyCredentialType.PUBLIC_KEY)
        for cid in credential_ids
    ]
    options = webauthn.generate_authentication_options(
        rp_id=settings.webauthn_rp_id,
        allow_credentials=allow,
        user_verification=UserVerificationRequirement.REQUIRED,
    )
    session_id = str(uuid4())
    _challenges[session_id] = (options.challenge, time.time() + CHALLENGE_TTL, None)
    return session_id, webauthn.options_to_json(options)


def complete_authentication(
    session_id: str,
    credential_json: str,
    public_key_bytes: bytes,
    sign_count: int,
) -> int:
    """
    Verify the browser's authentication assertion.
    Returns new sign_count on success.
    Raises ValueError on any failure.
    """
    entry = _challenges.pop(session_id, None)
    if entry is None or entry[1] < time.time():
        raise ValueError("Authentication session expired or not found.")

    challenge = entry[0]
    try:
        verification = webauthn.verify_authentication_response(
            credential=credential_json,
            expected_challenge=challenge,
            expected_rp_id=settings.webauthn_rp_id,
            expected_origin=settings.webauthn_origin,
            credential_public_key=public_key_bytes,
            credential_current_sign_count=sign_count,
            require_user_verification=True,
        )
    except Exception as exc:
        raise ValueError(f"Authentication verification failed: {exc}") from exc

    return verification.new_sign_count
