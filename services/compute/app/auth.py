"""Supabase-JWT-Prüfung und App-Rechte.

Ein Claim `apps` ({"sales": "viewer", "atr": "admin"}) wird von GoTrue über den
Custom Access Token Hook (Alembic 0001) in jedes Access-Token geschrieben.
Web-Middleware, RLS und dieser Dienst prüfen denselben Claim.
"""
from dataclasses import dataclass, field

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import settings

LEVELS = ("viewer", "editor", "admin")
_bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class Claims:
    sub: str
    email: str | None
    apps: dict[str, str] = field(default_factory=dict)

    def level(self, app: str) -> str | None:
        if self.apps.get("platform") == "admin":
            return "admin"
        return self.apps.get(app)

    def has(self, app: str, level: str = "viewer") -> bool:
        mine = self.level(app)
        return mine in LEVELS and LEVELS.index(mine) >= LEVELS.index(level)


def decode_token(token: str) -> Claims:
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET,
            algorithms=["HS256"],
            audience=settings.JWT_AUDIENCE,
            issuer=settings.API_EXTERNAL_URL,
            options={"require": ["exp", "iat", "sub", "aud", "iss"]},
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid token") from exc
    if payload.get("role") != "authenticated":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid token")
    apps = payload.get("apps") or {}
    if not isinstance(apps, dict):
        apps = {}
    return Claims(sub=payload["sub"], email=payload.get("email"), apps=dict(apps))


def get_claims(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> Claims:
    if creds is None or creds.scheme.lower() != "bearer":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing bearer token")
    claims = decode_token(creds.credentials)
    request.state.claims = claims
    return claims


def require_app(app: str, level: str = "viewer"):
    """Router-Gate: `dependencies=[Depends(require_app("sales"))]`."""
    if level not in LEVELS:
        raise ValueError(f"unknown level {level!r}")

    def _dep(claims: Claims = Depends(get_claims)) -> Claims:
        if not claims.has(app, level):
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"{app}:{level} required")
        return claims

    return _dep
