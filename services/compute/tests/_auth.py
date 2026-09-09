"""Test-Helfer: Access-Tokens in der Form, die GoTrue ausstellt."""
from __future__ import annotations

import os
import time

import jwt

USER_ID = "11111111-1111-1111-1111-111111111111"


def mint(apps: dict[str, str] | None = None, **overrides) -> str:
    now = int(time.time())
    payload = {
        "sub": USER_ID,
        "email": "user@example.com",
        "role": "authenticated",
        "aud": "authenticated",
        "iss": os.environ["API_EXTERNAL_URL"],
        "iat": now,
        "exp": now + 3600,
        "apps": apps if apps is not None else {},
    }
    payload.update(overrides)
    payload = {k: v for k, v in payload.items() if v is not None}
    return jwt.encode(payload, os.environ["JWT_SECRET"], algorithm="HS256")


def mint_admin() -> str:
    """Plattform-Admin — hat damit jedes App-Recht."""
    return mint({"platform": "admin"})
