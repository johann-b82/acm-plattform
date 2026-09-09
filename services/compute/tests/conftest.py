import os
import time

import jwt
import pytest

# Reine Unit-Tests: keine Datenbank. Werte vor dem Import von app.config setzen.
os.environ.setdefault("JWT_SECRET", "test-secret-with-at-least-32-characters!!")
os.environ.setdefault("API_EXTERNAL_URL", "http://localhost/supabase/auth/v1")
os.environ.setdefault("POSTGRES_PASSWORD", "unused")
os.environ.setdefault("POSTGRES_DB", "acm_test")


@pytest.fixture
def mint():
    """Erzeugt GoTrue-förmige Access-Tokens; Overrides ändern einzelne Claims."""

    def _mint(**overrides):
        now = int(time.time())
        payload = {
            "sub": "11111111-1111-1111-1111-111111111111",
            "email": "user@example.com",
            "role": "authenticated",
            "aud": "authenticated",
            "iss": os.environ["API_EXTERNAL_URL"],
            "iat": now,
            "exp": now + 3600,
            "apps": {"sales": "viewer"},
        }
        payload.update(overrides)
        payload = {k: v for k, v in payload.items() if v is not None}
        return jwt.encode(payload, os.environ["JWT_SECRET"], algorithm="HS256")

    return _mint
