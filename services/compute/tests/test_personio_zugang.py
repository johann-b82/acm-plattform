"""Die Personio-Zugangsdaten: verschlüsselt in der Datenbank, Umgebung als Rückfall.

Zwei Dinge müssen stimmen, sonst ist die Maske eine Falle: dass die
Zugangsdaten nirgends im Klartext liegen und dass sie nie wieder herauskommen —
die Antwort des Dienstes sagt nur, dass etwas hinterlegt ist.
"""
from __future__ import annotations

import pytest
import pytest_asyncio
import sqlalchemy as sa
from asgi_lifespan import LifespanManager
from cryptography.fernet import Fernet
from httpx import ASGITransport, AsyncClient

from app.config import settings
from app.db import SessionLocal, geheimnisse
from app.main import app
from app.personio import zugang
from tests._auth import mint, mint_admin

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def client():
    async with LifespanManager(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            yield ac


@pytest.fixture
def schluessel(monkeypatch):
    monkeypatch.setattr(settings, "GEHEIM_SCHLUESSEL", Fernet.generate_key().decode())
    monkeypatch.setattr(settings, "SENSOR_SCHLUESSEL", "")


@pytest.fixture
def ohne_umgebung(monkeypatch):
    monkeypatch.setattr(settings, "PERSONIO_CLIENT_ID", "")
    monkeypatch.setattr(settings, "PERSONIO_CLIENT_SECRET", "")


@pytest_asyncio.fixture
async def leer(datenbank_da):
    """Ein sauberer Tisch vor und nach jedem Test."""
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")

    async def _weg():
        async with SessionLocal() as sitzung:
            async with sitzung.begin():
                await sitzung.execute(sa.delete(geheimnisse))

    await _weg()
    yield
    await _weg()


ADMIN = {"Authorization": f"Bearer {mint_admin()}"}


class TestAblage:
    async def test_hin_und_zurueck(self, leer, schluessel, ohne_umgebung):
        await zugang.setzen("papi-kennung", "sehr-geheim", None)
        gelesen = await zugang.lesen()
        assert gelesen is not None
        assert (gelesen.client_id, gelesen.client_secret) == ("papi-kennung", "sehr-geheim")
        assert gelesen.aus_datenbank

    async def test_klartext_steht_nirgends(self, leer, schluessel, ohne_umgebung):
        await zugang.setzen("papi-kennung", "sehr-geheim", None)
        async with SessionLocal() as sitzung:
            texte = (
                await sitzung.execute(sa.select(geheimnisse.c.geheimtext))
            ).scalars().all()
        assert texte
        for t in texte:
            assert b"sehr-geheim" not in bytes(t)
            assert b"papi-kennung" not in bytes(t)

    async def test_umgebung_gilt_ohne_ablage(self, leer, schluessel, monkeypatch):
        monkeypatch.setattr(settings, "PERSONIO_CLIENT_ID", "aus-der-umgebung")
        monkeypatch.setattr(settings, "PERSONIO_CLIENT_SECRET", "auch-daher")
        gelesen = await zugang.lesen()
        assert gelesen is not None
        assert gelesen.client_id == "aus-der-umgebung"
        assert not gelesen.aus_datenbank

    async def test_ablage_schlaegt_umgebung(self, leer, schluessel, monkeypatch):
        monkeypatch.setattr(settings, "PERSONIO_CLIENT_ID", "aus-der-umgebung")
        monkeypatch.setattr(settings, "PERSONIO_CLIENT_SECRET", "auch-daher")
        await zugang.setzen("papi-kennung", "sehr-geheim", None)
        gelesen = await zugang.lesen()
        assert gelesen is not None
        assert gelesen.client_id == "papi-kennung"

    async def test_ohne_alles_nichts(self, leer, schluessel, ohne_umgebung):
        assert await zugang.lesen() is None
        assert await zugang.klient() is None

    async def test_falscher_schluessel_faellt_auf_umgebung_zurueck(
        self, leer, schluessel, monkeypatch
    ):
        await zugang.setzen("papi-kennung", "sehr-geheim", None)
        monkeypatch.setattr(settings, "GEHEIM_SCHLUESSEL", Fernet.generate_key().decode())
        monkeypatch.setattr(settings, "PERSONIO_CLIENT_ID", "aus-der-umgebung")
        monkeypatch.setattr(settings, "PERSONIO_CLIENT_SECRET", "auch-daher")
        gelesen = await zugang.lesen()
        assert gelesen is not None
        assert gelesen.client_id == "aus-der-umgebung"

    async def test_loeschen_faellt_zurueck(self, leer, schluessel, ohne_umgebung):
        await zugang.setzen("papi-kennung", "sehr-geheim", None)
        assert await zugang.loeschen() is True
        assert await zugang.lesen() is None
        assert await zugang.loeschen() is False


class TestTuer:
    async def test_ohne_token_zu(self, client, leer):
        assert (await client.get("/api/einstellungen/personio")).status_code in (401, 403)

    async def test_hr_admin_reicht_nicht(self, client, leer):
        r = await client.get(
            "/api/einstellungen/personio",
            headers={"Authorization": f"Bearer {mint({'hr': 'admin'})}"},
        )
        assert r.status_code == 403

    async def test_setzen_braucht_plattform_admin(self, client, leer, schluessel):
        r = await client.put(
            "/api/einstellungen/personio",
            headers={"Authorization": f"Bearer {mint({'hr': 'admin'})}"},
            json={"client_id": "a", "client_secret": "b"},
        )
        assert r.status_code == 403


class TestMaske:
    async def test_stand_ohne_alles(self, client, leer, schluessel, ohne_umgebung):
        r = await client.get("/api/einstellungen/personio", headers=ADMIN)
        assert r.status_code == 200
        assert r.json()["gesetzt"] is False
        assert r.json()["quelle"] is None
        assert r.json()["schluessel_bereit"] is True

    async def test_setzen_und_stand(self, client, leer, schluessel, ohne_umgebung):
        r = await client.put(
            "/api/einstellungen/personio",
            headers=ADMIN,
            json={"client_id": "papi-kennung", "client_secret": "sehr-geheim"},
        )
        assert r.status_code == 200, r.text
        stand = r.json()
        assert stand["gesetzt"] is True
        assert stand["quelle"] == "datenbank"
        assert stand["geaendert_am"]
        # Nichts vom Geheimnis in der Antwort.
        assert "sehr-geheim" not in r.text
        assert "papi-kennung" not in r.text

    async def test_ohne_schluessel_keine_ablage(self, client, leer, monkeypatch, ohne_umgebung):
        monkeypatch.setattr(settings, "GEHEIM_SCHLUESSEL", "")
        monkeypatch.setattr(settings, "SENSOR_SCHLUESSEL", "")
        r = await client.put(
            "/api/einstellungen/personio",
            headers=ADMIN,
            json={"client_id": "a", "client_secret": "b"},
        )
        assert r.status_code == 503
        assert "GEHEIM_SCHLUESSEL" in r.json()["detail"]

    async def test_loeschen(self, client, leer, schluessel, ohne_umgebung):
        await zugang.setzen("papi-kennung", "sehr-geheim", None)
        r = await client.delete("/api/einstellungen/personio", headers=ADMIN)
        assert r.status_code == 200
        assert r.json()["gesetzt"] is False

    async def test_pruefen_ohne_zugangsdaten(self, client, leer, schluessel, ohne_umgebung):
        r = await client.post("/api/einstellungen/personio/pruefen", headers=ADMIN)
        assert r.status_code == 200
        assert r.json()["erreichbar"] is False
