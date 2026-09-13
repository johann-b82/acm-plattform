"""Das Personio-Foto im Organigramm.

Die Person wird über ihre Personio-Kennung gefunden — dieselbe Zahl, die als
`id` im Organigramm steht —, nie über den Namen. Das Bild ist ein
Personendatum und hängt deshalb am Recht `hr`, wie die Zeilen daneben.
"""
from __future__ import annotations

import pytest
import pytest_asyncio
from asgi_lifespan import LifespanManager
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.personio import zugang
from app.personio.client import PersonioFehler
from tests._auth import mint

pytestmark = pytest.mark.asyncio


class Klient:
    def __init__(self, bilder: dict[int, tuple[bytes, str]], fehler: bool = False):
        self.bilder = bilder
        self.fehler = fehler
        self.gefragt: list[int] = []
        self.geschlossen = False

    async def profilbild(self, employee_id: int):
        self.gefragt.append(employee_id)
        if self.fehler:
            raise PersonioFehler("gedrosselt", status=429)
        return self.bilder.get(employee_id)

    async def schliessen(self) -> None:
        self.geschlossen = True


@pytest_asyncio.fixture
async def client():
    async with LifespanManager(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            yield ac


def mit_klient(monkeypatch, klient: Klient | None) -> None:
    async def liefern():
        return klient

    monkeypatch.setattr(zugang, "klient", liefern)


def kopf(apps: dict[str, str]) -> dict[str, str]:
    return {"Authorization": f"Bearer {mint(apps)}"}


class TestFoto:
    async def test_ohne_token_abgewiesen(self, client):
        r = await client.get("/api/hr/foto/42")
        assert r.status_code in (401, 403)

    async def test_ohne_hr_recht_abgewiesen(self, client, monkeypatch):
        mit_klient(monkeypatch, Klient({42: (b"bild", "image/png")}))
        r = await client.get("/api/hr/foto/42", headers=kopf({"kpi": "admin"}))
        assert r.status_code == 403

    async def test_bild_zur_personio_kennung(self, client, monkeypatch):
        klient = Klient({42: (b"\x89PNG-bild", "image/png")})
        mit_klient(monkeypatch, klient)
        r = await client.get("/api/hr/foto/42", headers=kopf({"hr": "viewer"}))
        assert r.status_code == 200
        assert r.content == b"\x89PNG-bild"
        assert r.headers["content-type"] == "image/png"
        # Privat zwischenspeichern: das Organigramm lädt dieselben Bilder oft.
        assert r.headers["cache-control"].startswith("private")
        assert klient.gefragt == [42]
        assert klient.geschlossen

    async def test_ohne_bild_404(self, client, monkeypatch):
        mit_klient(monkeypatch, Klient({}))
        r = await client.get("/api/hr/foto/7", headers=kopf({"hr": "viewer"}))
        assert r.status_code == 404

    async def test_ohne_personio_zugang_404(self, client, monkeypatch):
        mit_klient(monkeypatch, None)
        r = await client.get("/api/hr/foto/7", headers=kopf({"hr": "viewer"}))
        assert r.status_code == 404

    async def test_personio_fehler_502(self, client, monkeypatch):
        klient = Klient({}, fehler=True)
        mit_klient(monkeypatch, klient)
        r = await client.get("/api/hr/foto/7", headers=kopf({"hr": "viewer"}))
        assert r.status_code == 502
        assert klient.geschlossen
