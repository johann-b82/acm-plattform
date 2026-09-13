"""Nachweise nach Personio (SET-09) — nur gegen eine Attrappe.

Geprüft wird, was das Register verlangt: Schalter standardmäßig aus, die
lokale Änderung bleibt bei einem Fehler stehen, und wiederholte Läufe erzeugen
keine doppelten Nachweise.
"""
from __future__ import annotations

from datetime import date

import httpx
import pytest
import pytest_asyncio
import sqlalchemy as sa
from asgi_lifespan import LifespanManager
from httpx import ASGITransport, AsyncClient

from app.config import settings
from app.db import SessionLocal
from app.main import app
from app.personio import nachweise, zugang
from app.personio.client import PersonioClient

pytestmark = pytest.mark.asyncio

MITARBEITER = 905201


class Personio:
    def __init__(self) -> None:
        self.hochgeladen: list[httpx.Request] = []
        self.status = 200

    def __call__(self, anfrage: httpx.Request) -> httpx.Response:
        if anfrage.url.path.endswith("/auth"):
            return httpx.Response(200, json={"data": {"token": "t"}})
        if anfrage.url.path.endswith("/company/documents"):
            self.hochgeladen.append(anfrage)
            return httpx.Response(self.status, json={"success": self.status < 400})
        return httpx.Response(404)


@pytest.fixture
def personio(monkeypatch):
    attrappe = Personio()

    async def klient():
        k = PersonioClient("id", "secret")
        k._http = httpx.AsyncClient(transport=httpx.MockTransport(attrappe))
        return k

    monkeypatch.setattr(zugang, "klient", klient)
    return attrappe


async def sql(text: str, **params):
    async with SessionLocal() as s:
        async with s.begin():
            ergebnis = await s.execute(sa.text(text), params)
            return [dict(r) for r in ergebnis.mappings()] if ergebnis.returns_rows else []


@pytest_asyncio.fixture
async def daten(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")

    async def weg():
        await sql("delete from public.personio_nachweise")
        await sql("delete from public.schulung_teilnahmen where employee_id = :m", m=MITARBEITER)
        await sql("delete from public.schulung_katalog where name = 'Löten 0051'")
        await sql("delete from public.personio_employees where id = :m", m=MITARBEITER)
        await sql("update public.plattform_einstellungen set personio_nachweis_aktiv = false,"
                  " personio_nachweis_kategorie = null")

    await weg()
    await sql("insert into public.personio_employees (id, first_name, last_name, synced_at)"
              " values (:m, 'Jürgen', 'Prüfer', now())", m=MITARBEITER)
    schulung = (await sql("insert into public.schulung_katalog (bereich, name)"
                          " values ('Test', 'Löten 0051') returning id::text"))[0]["id"]
    yield schulung
    await weg()


async def einschalten():
    await sql("update public.plattform_einstellungen set personio_nachweis_aktiv = true,"
              " personio_nachweis_kategorie = '4711'")


async def teilnahme(schulung: str, datum: str = "2026-09-01"):
    await sql("insert into public.schulung_teilnahmen (schulung_id, employee_id, aktuell_datum)"
              " values (cast(:s as uuid), :m, :d)"
              " on conflict (schulung_id, employee_id) where employee_id is not null"
              " do update set aktuell_datum = excluded.aktuell_datum",
              s=schulung, m=MITARBEITER, d=date.fromisoformat(datum))


async def auftraege():
    return await sql("select art, erledigt_am, versuche, fehler, inhalt_hash"
                     " from public.personio_nachweise order by id")


async def test_standard_aus_und_nichts_geht_hoch(daten, personio):
    stand = await sql("select personio_nachweis_aktiv from public.plattform_einstellungen")
    assert stand == [{"personio_nachweis_aktiv": False}]
    await teilnahme(daten)
    lauf = await nachweise.abarbeiten()
    assert (lauf.hochgeladen, lauf.fehlgeschlagen) == (0, 0)
    assert personio.hochgeladen == []


async def test_hochladen_mit_kategorie_und_pdf(daten, personio):
    await einschalten()
    await teilnahme(daten)
    lauf = await nachweise.abarbeiten()
    assert lauf.hochgeladen == 1
    [anfrage] = personio.hochgeladen
    koerper = anfrage.content
    assert b'name="employee_id"' in koerper and str(MITARBEITER).encode() in koerper
    assert b'name="document_category_id"\r\n\r\n4711' in koerper
    assert b"application/pdf" in koerper and b"%PDF-1.4" in koerper
    [auftrag] = await auftraege()
    assert auftrag["erledigt_am"] is not None and auftrag["inhalt_hash"]


async def test_zweiter_lauf_ohne_aenderung_laedt_nichts(daten, personio):
    await einschalten()
    await teilnahme(daten)
    await nachweise.abarbeiten()
    await nachweise.abarbeiten()
    assert len(personio.hochgeladen) == 1


async def test_gleicher_inhalt_geht_nicht_doppelt_hoch(daten, personio):
    await einschalten()
    await teilnahme(daten)
    await nachweise.abarbeiten()
    # Eine Änderung, die am Nachweis nichts ändert, merkt einen Auftrag vor …
    await sql("update public.schulung_teilnahmen set geaendert_am = now() where employee_id = :m",
              m=MITARBEITER)
    assert sum(1 for a in await auftraege() if a["erledigt_am"] is None) == 1
    lauf = await nachweise.abarbeiten()
    # … der ohne Upload erledigt wird.
    assert lauf.unveraendert == 1
    assert len(personio.hochgeladen) == 1


async def test_neuer_inhalt_geht_hoch(daten, personio):
    await einschalten()
    await teilnahme(daten)
    await nachweise.abarbeiten()
    await teilnahme(daten, "2026-09-10")
    await nachweise.abarbeiten()
    assert len(personio.hochgeladen) == 2
    assert b"10.09.2026" in personio.hochgeladen[1].content


async def test_fehler_laesst_lokale_aenderung_und_auftrag_stehen(daten, personio):
    await einschalten()
    personio.status = 403
    await teilnahme(daten, "2026-09-05")
    lauf = await nachweise.abarbeiten()
    assert lauf.fehlgeschlagen == 1
    [auftrag] = await auftraege()
    assert auftrag["erledigt_am"] is None
    assert auftrag["versuche"] == 1
    assert "403" in auftrag["fehler"]
    lokal = await sql("select aktuell_datum::text as d from public.schulung_teilnahmen where employee_id = :m",
                      m=MITARBEITER)
    assert lokal == [{"d": "2026-09-05"}]

    # Beim nächsten Lauf klappt es — genau ein Nachweis.
    personio.status = 200
    await nachweise.abarbeiten()
    assert [a.url.path for a in personio.hochgeladen].count("/v1/company/documents") == 2
    offen = [a for a in await auftraege() if a["erledigt_am"] is None]
    assert offen == []


async def test_nach_fuenf_versuchen_ruhe(daten, personio):
    await einschalten()
    personio.status = 500
    await teilnahme(daten)
    for _ in range(7):
        await nachweise.abarbeiten()
    assert len(personio.hochgeladen) == 5


async def test_ausgeschaltet_bleibt_der_auftrag_stehen(daten, personio):
    await einschalten()
    await teilnahme(daten)
    await sql("update public.plattform_einstellungen set personio_nachweis_aktiv = false")
    await nachweise.abarbeiten()
    assert personio.hochgeladen == []
    assert [a["erledigt_am"] for a in await auftraege()] == [None]


@pytest_asyncio.fixture
async def client():
    async with LifespanManager(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            yield ac


async def test_geplante_route_nur_mit_geheimnis(client, monkeypatch, daten, personio):
    monkeypatch.setattr(settings, "HR_SYNC_TOKEN", "streng-geheim")
    r = await client.post("/api/personio/nachweise/geplant")
    assert r.status_code == 403
    r = await client.post("/api/personio/nachweise/geplant", headers={"X-HR-Sync-Token": "streng-geheim"})
    assert r.status_code == 200
    assert r.json() == {"hochgeladen": 0, "unveraendert": 0, "fehlgeschlagen": 0}
