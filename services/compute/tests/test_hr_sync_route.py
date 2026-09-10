"""Wer den Abgleich auslösen darf.

Zwei Türen, zwei Schlüssel: die Oberfläche zeigt ein Supabase-Token, der
nächtliche pg_cron-Job ein gemeinsames Geheimnis. Beide Türen müssen für den
jeweils anderen Schlüssel zu sein.
"""
from __future__ import annotations

import pytest
import pytest_asyncio
from asgi_lifespan import LifespanManager
from httpx import ASGITransport, AsyncClient

from app.config import settings
from app.main import app
from tests._auth import mint, mint_admin

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def client():
    async with LifespanManager(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            yield ac


@pytest.fixture
def geheimnis(monkeypatch):
    monkeypatch.setattr(settings, "HR_SYNC_TOKEN", "streng-geheim")
    return "streng-geheim"


@pytest.fixture
def ohne_personio(monkeypatch):
    """Ohne Zugangsdaten kommt der Abgleich bis zur 503 — genau weit genug,
    um zu zeigen, dass die Tür offen war."""
    monkeypatch.setattr(settings, "PERSONIO_CLIENT_ID", "")
    monkeypatch.setattr(settings, "PERSONIO_CLIENT_SECRET", "")


class TestVonHand:
    async def test_ohne_token_abgewiesen(self, client):
        r = await client.post("/api/hr/sync")
        assert r.status_code in (401, 403)

    async def test_hr_viewer_reicht_nicht(self, client):
        r = await client.post(
            "/api/hr/sync", headers={"Authorization": f"Bearer {mint({'hr': 'viewer'})}"}
        )
        assert r.status_code == 403

    async def test_admin_einer_anderen_app_reicht_nicht(self, client):
        r = await client.post(
            "/api/hr/sync", headers={"Authorization": f"Bearer {mint({'kpi': 'admin'})}"}
        )
        assert r.status_code == 403

    async def test_hr_admin_kommt_durch(self, client, ohne_personio):
        r = await client.post(
            "/api/hr/sync", headers={"Authorization": f"Bearer {mint({'hr': 'admin'})}"}
        )
        # 503: die Tür war offen, es fehlen nur die Personio-Zugangsdaten.
        assert r.status_code == 503
        assert "PERSONIO_CLIENT_ID" in r.json()["detail"]

    async def test_plattform_admin_kommt_durch(self, client, ohne_personio):
        r = await client.post("/api/hr/sync", headers={"Authorization": f"Bearer {mint_admin()}"})
        assert r.status_code == 503


class TestGeplant:
    async def test_ohne_geheimnis_in_der_umgebung_ist_die_tuer_zu(self, client, monkeypatch):
        monkeypatch.setattr(settings, "HR_SYNC_TOKEN", "")
        r = await client.post("/api/hr/sync/geplant", headers={"X-HR-Sync-Token": "irgendwas"})
        assert r.status_code == 503

    async def test_falsches_geheimnis(self, client, geheimnis):
        r = await client.post("/api/hr/sync/geplant", headers={"X-HR-Sync-Token": "falsch"})
        assert r.status_code == 403

    async def test_ohne_kopfzeile(self, client, geheimnis):
        r = await client.post("/api/hr/sync/geplant")
        assert r.status_code == 403

    async def test_richtiges_geheimnis(self, client, geheimnis, ohne_personio):
        r = await client.post("/api/hr/sync/geplant", headers={"X-HR-Sync-Token": geheimnis})
        assert r.status_code == 503

    async def test_nutzer_token_oeffnet_die_cron_tuer_nicht(self, client, geheimnis):
        r = await client.post(
            "/api/hr/sync/geplant", headers={"Authorization": f"Bearer {mint_admin()}"}
        )
        assert r.status_code == 403

    async def test_taucht_nicht_in_der_openapi_liste_auf(self, client):
        r = await client.get("/openapi.json")
        assert "/api/hr/sync/geplant" not in r.json()["paths"]
        assert "/api/hr/sync" in r.json()["paths"]
