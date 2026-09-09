"""Personen anlegen — Rechte, Fehlerwege und das erzeugte Passwort.

Der Endpunkt spricht mit GoTrue. Die HTTP-Antwort wird hier ersetzt, damit
der Test ohne Supabase-Stack laeuft; geprueft wird, was compute daraus macht.
"""
from __future__ import annotations

import pytest
import pytest_asyncio
from asgi_lifespan import LifespanManager
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.routers import verwaltung
from app.routers.verwaltung import erzeuge_passwort
from tests._auth import mint, mint_admin


@pytest_asyncio.fixture
async def client():
    async with LifespanManager(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            yield ac


def _gotrue(monkeypatch, status_code: int, koerper: dict | None = None, gesehen: dict | None = None):
    """Ersetzt genau die Naht zu GoTrue, nicht den HTTP-Client."""

    async def _ruf(email: str, passwort: str) -> tuple[int, dict]:
        if gesehen is not None:
            gesehen.update({"email": email, "passwort": passwort})
        return status_code, koerper or {}

    monkeypatch.setattr(verwaltung, "gotrue_nutzer_anlegen", _ruf)


class TestPasswort:
    def test_laenge_und_zeichenvorrat(self):
        pw = erzeuge_passwort()
        assert len(pw) == 20
        # Verwechselbare Zeichen sind draussen, weil das Passwort abgetippt wird.
        assert not set(pw) & set("0O1lI")

    def test_jedes_mal_anders(self):
        assert len({erzeuge_passwort() for _ in range(50)}) == 50


class TestRechte:
    async def test_ohne_token_401(self, client):
        antwort = await client.post("/api/verwaltung/nutzer", json={"email": "a@b.de"})
        assert antwort.status_code == 401

    async def test_ohne_plattformrecht_403(self, client, monkeypatch):
        _gotrue(monkeypatch, 201, {"id": "x", "email": "a@b.de"})
        antwort = await client.post(
            "/api/verwaltung/nutzer",
            json={"email": "a@b.de"},
            headers={"Authorization": f"Bearer {mint({'kpi': 'admin'})}"},
        )
        assert antwort.status_code == 403


class TestAnlegen:
    async def test_admin_legt_an(self, client, monkeypatch):
        gesehen: dict = {}
        _gotrue(monkeypatch, 201, {"id": "9c1f", "email": "neu@acm.local"}, gesehen)
        antwort = await client.post(
            "/api/verwaltung/nutzer",
            json={"email": "neu@acm.local"},
            headers={"Authorization": f"Bearer {mint_admin()}"},
        )
        assert antwort.status_code == 201
        koerper = antwort.json()
        assert koerper["id"] == "9c1f"
        assert koerper["email"] == "neu@acm.local"
        assert len(koerper["passwort"]) == 20
        # Das erzeugte Passwort geht genau so an GoTrue.
        assert gesehen["passwort"] == koerper["passwort"]
        assert gesehen["email"] == "neu@acm.local"

    async def test_doppelte_adresse_409(self, client, monkeypatch):
        _gotrue(monkeypatch, 422, {"msg": "already registered"})
        antwort = await client.post(
            "/api/verwaltung/nutzer",
            json={"email": "da@acm.local"},
            headers={"Authorization": f"Bearer {mint_admin()}"},
        )
        assert antwort.status_code == 409

    async def test_fremdfehler_wird_nicht_durchgereicht(self, client, monkeypatch):
        """Der Text von GoTrue kann den Schluessel enthalten — er bleibt drin."""
        _gotrue(monkeypatch, 500, {"msg": "apikey eyJhbGciOi..."})
        antwort = await client.post(
            "/api/verwaltung/nutzer",
            json={"email": "x@acm.local"},
            headers={"Authorization": f"Bearer {mint_admin()}"},
        )
        assert antwort.status_code == 502
        assert "eyJ" not in antwort.text

    async def test_ungueltige_adresse_422(self, client):
        antwort = await client.post(
            "/api/verwaltung/nutzer",
            json={"email": "keine-adresse"},
            headers={"Authorization": f"Bearer {mint_admin()}"},
        )
        assert antwort.status_code == 422
