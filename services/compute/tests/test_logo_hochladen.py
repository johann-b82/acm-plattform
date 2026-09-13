"""Das Logo über compute hochladen (SET-07). Der Speicher ist eine Attrappe."""
from __future__ import annotations

from io import BytesIO
from xml.etree import ElementTree as ET

import pytest
import pytest_asyncio
import sqlalchemy as sa
from asgi_lifespan import LifespanManager
from httpx import ASGITransport, AsyncClient
from PIL import Image

from app.db import SessionLocal, plattform_logo
from app.dokumente import logo
from app.main import app
from tests._auth import USER_ID, mint, mint_admin

pytestmark = pytest.mark.asyncio

ADMIN = {"Authorization": f"Bearer {mint_admin()}"}

BOESES_SVG = (
    b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20" onload="alert(1)">'
    b"<script>alert(2)</script><rect width=\"40\" height=\"20\" fill=\"#0041F6\"/></svg>"
)


def png() -> bytes:
    puffer = BytesIO()
    Image.new("RGB", (40, 20), (0, 65, 246)).save(puffer, format="PNG")
    return puffer.getvalue()


@pytest.fixture
def speicher(monkeypatch):
    abgelegt: dict[str, tuple[bytes, str]] = {}
    entfernt: list[str] = []

    async def ablegen(pfad, daten, mime):
        abgelegt[pfad] = (daten, mime)

    async def entfernen(pfade):
        entfernt.extend(pfade)

    monkeypatch.setattr(logo, "_ablegen", ablegen)
    monkeypatch.setattr(logo, "_entfernen", entfernen)
    return abgelegt, entfernt


@pytest_asyncio.fixture
async def leer(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")

    async def zurueck():
        async with SessionLocal() as s:
            async with s.begin():
                await s.execute(sa.update(plattform_logo).values(
                    pfad=None, raster_pfad=None, dateiname=None, mime=None))

    await zurueck()
    yield
    await zurueck()


@pytest_asyncio.fixture
async def client():
    async with LifespanManager(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            yield ac


async def zeile() -> dict:
    async with SessionLocal() as s:
        return dict((await s.execute(sa.select(plattform_logo))).mappings().one())


async def test_nur_plattform_verwaltung(client, leer, speicher):
    r = await client.post("/api/einstellungen/logo", files={"datei": ("a.png", png(), "image/png")},
                          headers={"Authorization": f"Bearer {mint({'hr': 'admin'})}"})
    assert r.status_code == 403
    assert speicher[0] == {}


async def test_png_unter_eigener_kennung(client, leer, speicher):
    r = await client.post("/api/einstellungen/logo", files={"datei": ("logo.png", png(), "image/png")},
                          headers=ADMIN)
    assert r.status_code == 200, r.text
    z = await zeile()
    assert z["mime"] == "image/png"
    assert z["pfad"].startswith(f"{USER_ID}/") and z["pfad"].endswith(".png")
    assert z["raster_pfad"] == z["pfad"]
    assert list(speicher[0]) == [z["pfad"]]


async def test_svg_gereinigt_mit_raster(client, leer, speicher):
    # Als PNG ausgegeben — entschieden wird am Inhalt.
    r = await client.post("/api/einstellungen/logo",
                          files={"datei": ("logo.png", BOESES_SVG, "image/png")}, headers=ADMIN)
    assert r.status_code == 200, r.text
    z = await zeile()
    assert z["mime"] == "image/svg+xml"
    svg, svg_typ = speicher[0][z["pfad"]]
    assert svg_typ == "image/svg+xml"
    assert b"script" not in svg and b"onload" not in svg
    assert ET.fromstring(svg).tag.endswith("svg")
    raster, raster_typ = speicher[0][z["raster_pfad"]]
    assert raster_typ == "image/png" and raster.startswith(b"\x89PNG")


async def test_falscher_typ_und_zu_gross_abgelehnt(client, leer, speicher):
    r = await client.post("/api/einstellungen/logo",
                          files={"datei": ("logo.png", b"GIF89a....", "image/png")}, headers=ADMIN)
    assert r.status_code == 422
    gross = png() + b"\0" * (5 * 1024 * 1024)
    r = await client.post("/api/einstellungen/logo",
                          files={"datei": ("logo.png", gross, "image/png")}, headers=ADMIN)
    assert r.status_code == 422
    assert "5 MB" in r.json()["detail"]
    assert speicher[0] == {}


async def test_ersetzen_entfernt_die_alten_dateien(client, leer, speicher):
    await client.post("/api/einstellungen/logo", files={"datei": ("a.svg", BOESES_SVG, "image/svg+xml")},
                      headers=ADMIN)
    alt = await zeile()
    await client.post("/api/einstellungen/logo", files={"datei": ("b.png", png(), "image/png")},
                      headers=ADMIN)
    assert sorted(speicher[1]) == sorted([alt["pfad"], alt["raster_pfad"]])
