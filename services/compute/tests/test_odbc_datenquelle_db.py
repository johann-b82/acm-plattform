"""Der Umschalter Datenquelle und seine Wirkung auf Import und ODBC-Sync.

Zwei Tore, gegenläufig: steht `plattform_einstellungen.datenquelle` auf
'odbc', sind die manuellen Uploads (`/api/uploads/*`) gesperrt und nur der
ODBC-Sync (`/api/odbc/*`) nimmt an; auf 'extrakte' ist es umgekehrt. Der
ODBC-Sync authentifiziert sich wie der Personio-Cron über ein gemeinsames
Geheimnis (`X-ODBC-Token`).
"""
from __future__ import annotations

import pytest
import pytest_asyncio
import sqlalchemy as sa
from asgi_lifespan import LifespanManager
from httpx import ASGITransport, AsyncClient

from app.config import settings
from app.db import SessionLocal
from app.main import app
from tests._auth import mint

pytestmark = pytest.mark.asyncio

DATEI = {"file": ("x.txt", b"Typ\tVorgang Nr.\n", "text/plain")}
UPLOADS_ADMIN = {"Authorization": f"Bearer {mint({'uploads': 'admin'})}"}


@pytest_asyncio.fixture
async def client():
    async with LifespanManager(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            yield ac


@pytest.fixture
def token(monkeypatch):
    monkeypatch.setattr(settings, "ODBC_SYNC_TOKEN", "sync-geheim")
    return "sync-geheim"


async def datenquelle_setzen(wert: str) -> None:
    async with SessionLocal() as s:
        async with s.begin():
            await s.execute(
                sa.text("update public.plattform_einstellungen set datenquelle = :q"), {"q": wert}
            )


@pytest_asyncio.fixture
async def db(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")
    await datenquelle_setzen("extrakte")
    yield
    await datenquelle_setzen("extrakte")


class TestOdbcTuer:
    """Auth des ODBC-Sync — braucht keine Datenbank, die Dependencies greifen zuerst."""

    async def test_ohne_geheimnis_in_der_umgebung_ist_zu(self, client, monkeypatch):
        monkeypatch.setattr(settings, "ODBC_SYNC_TOKEN", "")
        r = await client.post("/api/odbc/umsatz", headers={"X-ODBC-Token": "x"}, files=DATEI)
        assert r.status_code == 503

    async def test_falsches_geheimnis(self, client, token):
        r = await client.post("/api/odbc/umsatz", headers={"X-ODBC-Token": "falsch"}, files=DATEI)
        assert r.status_code == 403

    async def test_ohne_kopfzeile(self, client, token):
        r = await client.post("/api/odbc/umsatz", files=DATEI)
        assert r.status_code == 403

    async def test_nicht_in_der_openapi_liste(self, client):
        paths = (await client.get("/openapi.json")).json()["paths"]
        assert not any(p.startswith("/api/odbc") for p in paths)


class TestUmschalter:
    """Die gegenläufigen Tore — gegen eine echte Datenbank."""

    async def test_odbc_sync_bei_extrakte_abgewiesen(self, client, token, db):
        await datenquelle_setzen("extrakte")
        r = await client.post("/api/odbc/umsatz", headers={"X-ODBC-Token": token}, files=DATEI)
        assert r.status_code == 409

    async def test_odbc_sync_bei_odbc_kommt_durch_die_tore(self, client, token, db):
        await datenquelle_setzen("odbc")
        r = await client.post("/api/odbc/umsatz", headers={"X-ODBC-Token": token}, files=DATEI)
        # Vorbei an Token- und Datenquelle-Tor; was der Parser dann meldet, ist egal.
        assert r.status_code not in (403, 409, 503)

    async def test_upload_bei_odbc_gesperrt(self, client, db):
        await datenquelle_setzen("odbc")
        r = await client.post("/api/uploads/umsatz", headers=UPLOADS_ADMIN, files=DATEI)
        assert r.status_code == 409

    async def test_upload_bei_extrakte_nicht_gesperrt(self, client, db):
        await datenquelle_setzen("extrakte")
        r = await client.post("/api/uploads/umsatz", headers=UPLOADS_ADMIN, files=DATEI)
        assert r.status_code != 409


class TestSteuerung:
    """Konfig (Pull) und Status (Push) — unabhängig vom Datenquelle-Tor."""

    async def test_konfig_braucht_token(self, client, monkeypatch):
        monkeypatch.setattr(settings, "ODBC_SYNC_TOKEN", "")
        r = await client.get("/api/odbc/konfig", headers={"X-ODBC-Token": "x"})
        assert r.status_code == 503

    async def test_status_braucht_token(self, client, token):
        r = await client.post(
            "/api/odbc/status", headers={"X-ODBC-Token": "falsch"}, json={}
        )
        assert r.status_code == 403

    async def test_konfig_liefert_vorgabe_auch_bei_extrakte(self, client, token, db):
        await datenquelle_setzen("extrakte")  # bewusst NICHT odbc
        r = await client.get("/api/odbc/konfig", headers={"X-ODBC-Token": token})
        assert r.status_code == 200
        daten = r.json()
        assert daten["intervall_min"] == 60
        assert "umsatz" in daten["aktive_arten"]

    async def test_status_schreibt_herzschlag_und_lauf(self, client, token, db):
        await datenquelle_setzen("extrakte")  # Herzschlag muss auch so durchgehen
        r = await client.post(
            "/api/odbc/status",
            headers={"X-ODBC-Token": token},
            json={
                "worker_version": "test-1",
                "host": "vm-test",
                "laeufe": [{"art": "umsatz", "status": "ok", "zeilen": 42, "dauer_ms": 7}],
            },
        )
        assert r.status_code == 200
        async with SessionLocal() as s:
            status_row = (
                await s.execute(
                    sa.text("select worker_version, host, gesehen_am from public.odbc_worker_status")
                )
            ).one()
            assert status_row.worker_version == "test-1"
            assert status_row.gesehen_am is not None
            lauf = (
                await s.execute(
                    sa.text(
                        "select status, zeilen from public.odbc_sync_lauf where art = 'umsatz'"
                    )
                )
            ).one()
            assert lauf.status == "ok"
            assert lauf.zeilen == 42

    async def test_unbekannte_art_im_lauf_wird_ignoriert(self, client, token, db):
        r = await client.post(
            "/api/odbc/status",
            headers={"X-ODBC-Token": token},
            json={"laeufe": [{"art": "gibtsnicht", "status": "ok"}]},
        )
        assert r.status_code == 200  # Herzschlag zählt, Unbekanntes fällt weg
