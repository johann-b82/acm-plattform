import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.auth import Claims, decode_token, get_claims, require_app
from fastapi import HTTPException


def test_decode_valid_token_reads_apps(mint):
    claims = decode_token(mint(apps={"sales": "editor", "atr": "admin"}))
    assert claims.sub == "11111111-1111-1111-1111-111111111111"
    assert claims.email == "user@example.com"
    assert claims.apps == {"sales": "editor", "atr": "admin"}


@pytest.mark.parametrize(
    "override",
    [
        {"exp": None},                       # Ablauf ist Pflicht
        {"iat": None},
        {"iss": "http://evil/auth/v1"},      # Issuer wird geprüft
        {"aud": "service_role"},             # Audience wird geprüft
        {"role": "anon"},                    # nur eingeloggte Nutzer
        {"exp": 1},                          # abgelaufen
    ],
)
def test_decode_rejects_bad_tokens(mint, override):
    with pytest.raises(HTTPException) as exc:
        decode_token(mint(**override))
    assert exc.value.status_code == 401


def test_wrong_secret_is_rejected(mint, monkeypatch):
    import jwt as pyjwt
    import time

    token = pyjwt.encode(
        {"sub": "x", "role": "authenticated", "aud": "authenticated",
         "iss": "http://localhost/supabase/auth/v1", "iat": int(time.time()), "exp": int(time.time()) + 60},
        "another-secret", algorithm="HS256",
    )
    with pytest.raises(HTTPException):
        decode_token(token)


def test_levels_are_ordered_and_platform_admin_is_global():
    c = Claims(sub="s", email=None, apps={"sales": "editor"})
    assert c.has("sales", "viewer") and c.has("sales", "editor") and not c.has("sales", "admin")
    assert not c.has("hr")
    admin = Claims(sub="s", email=None, apps={"platform": "admin"})
    assert admin.has("hr", "admin") and admin.level("anything") == "admin"


def _app():
    api = FastAPI()

    @api.get("/me")
    def me(claims: Claims = Depends(get_claims)):
        return claims.apps

    @api.get("/sales", dependencies=[Depends(require_app("sales"))])
    def sales():
        return {"ok": True}

    @api.get("/sales-admin", dependencies=[Depends(require_app("sales", "admin"))])
    def sales_admin():
        return {"ok": True}

    return TestClient(api)


def test_gates(mint):
    client = _app()
    assert client.get("/me").status_code == 401
    h = {"Authorization": f"Bearer {mint()}"}
    assert client.get("/me", headers=h).json() == {"sales": "viewer"}
    assert client.get("/sales", headers=h).status_code == 200
    assert client.get("/sales-admin", headers=h).status_code == 403
    h_admin = {"Authorization": f"Bearer {mint(apps={'platform': 'admin'})}"}
    assert client.get("/sales-admin", headers=h_admin).status_code == 200


def test_unknown_level_is_a_programming_error():
    with pytest.raises(ValueError):
        require_app("sales", "owner")
