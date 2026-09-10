"""FAIR gegen eine echte Datenbank.

Der Schwerpunkt liegt auf der Nummerierung. Im Altprojekt rechnet der Router
sie aus und schreibt nach einem Löschen alle Ballons in zwei Durchgängen um;
hier gehört sie der Datenbank, und die Prüfungen halten fest, dass es keinen
Weg gibt, auf dem Lücken oder Doppelnummern entstehen — auch nicht über
PostgREST, das an keinem Router vorbeikommt.
"""
from __future__ import annotations

import pytest
import pytest_asyncio
import sqlalchemy as sa

from app.db import SessionLocal
from tests._auth import USER_ID

LESER = '{"sub":"%s","role":"authenticated","apps":{"fair":"viewer"}}' % USER_ID
PRUEFER = '{"sub":"%s","role":"authenticated","apps":{"fair":"editor"}}' % USER_ID
FREMD = '{"sub":"%s","role":"authenticated","apps":{"hr":"admin"}}' % USER_ID


@pytest_asyncio.fixture
async def db(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")

    async def leeren():
        async with SessionLocal() as s:
            async with s.begin():
                await s.execute(sa.text("delete from public.fair_zeichnungen"))

    await leeren()
    yield
    await leeren()


async def als(claims: str, sql: str, **params):
    async with SessionLocal() as s:
        trans = await s.begin()
        try:
            await s.execute(sa.text("set local role authenticated"))
            await s.execute(
                sa.text("select set_config('request.jwt.claims', :c, true)"), {"c": claims}
            )
            ergebnis = await s.execute(sa.text(sql), params)
            return [dict(r) for r in ergebnis.mappings()] if ergebnis.returns_rows else []
        finally:
            await trans.rollback()


async def anlegen(sql: str, **params):
    async with SessionLocal() as s:
        async with s.begin():
            ergebnis = await s.execute(sa.text(sql), params)
            return [dict(r) for r in ergebnis.mappings()] if ergebnis.returns_rows else []


async def als_erwartet_fehler(claims: str, sql: str, **params) -> str:
    with pytest.raises(Exception) as fehler:
        await als(claims, sql, **params)
    return str(fehler.value).lower()


async def zeichnung() -> str:
    zeilen = await anlegen(
        "insert into public.fair_zeichnungen (name, pfad, art)"
        " values ('Welle 12x40', 'x/zeichnung.pdf', 'pdf') returning id")
    return str(zeilen[0]["id"])


BALLON = ("insert into public.fair_ballons (zeichnung_id, bereich_x, bereich_y,"
          " bereich_b, bereich_h, blase_x, blase_y, wert)"
          " values (cast(:z as uuid), 0.1, 0.1, 0.05, 0.02, 0.3, 0.3, :w)")


async def ballons(z: str) -> list[tuple[int, str]]:
    zeilen = await anlegen(
        "select nummer, wert from public.fair_ballons where zeichnung_id = cast(:z as uuid)"
        " order by nummer", z=z)
    return [(int(r["nummer"]), r["wert"]) for r in zeilen]


class TestNummerierung:
    async def test_die_datenbank_vergibt_die_nummer(self, db):
        z = await zeichnung()
        for wert in ("12,0 h7", "40 ±0,1", "Ra 1,6"):
            await anlegen(BALLON, z=z, w=wert)
        assert await ballons(z) == [(1, "12,0 h7"), (2, "40 ±0,1"), (3, "Ra 1,6")]

    async def test_loeschen_schliesst_die_luecke(self, db):
        """Der Trigger haengt an der Tabelle, nicht an einem Router — auch ein
        `delete` ueber PostgREST kommt daran nicht vorbei."""
        z = await zeichnung()
        for wert in ("A", "B", "C", "D"):
            await anlegen(BALLON, z=z, w=wert)
        await anlegen("delete from public.fair_ballons"
                      " where zeichnung_id = cast(:z as uuid) and nummer = 2", z=z)
        assert await ballons(z) == [(1, "A"), (2, "C"), (3, "D")]

    async def test_mehrere_auf_einmal_geloescht(self, db):
        z = await zeichnung()
        for wert in ("A", "B", "C", "D", "E"):
            await anlegen(BALLON, z=z, w=wert)
        await anlegen("delete from public.fair_ballons"
                      " where zeichnung_id = cast(:z as uuid) and nummer in (1, 3, 5)", z=z)
        assert await ballons(z) == [(1, "B"), (2, "D")]

    async def test_zeichnungen_zaehlen_getrennt(self, db):
        eins, zwei = await zeichnung(), await zeichnung()
        await anlegen(BALLON, z=eins, w="A")
        await anlegen(BALLON, z=zwei, w="X")
        await anlegen(BALLON, z=zwei, w="Y")
        assert await ballons(eins) == [(1, "A")]
        assert await ballons(zwei) == [(1, "X"), (2, "Y")]

    async def test_umsortieren_in_einem_zug(self, db):
        """Ohne die aufgeschobene Bedingung braeuchte das zwei Durchgaenge mit
        einem Zwischenwert, wie im Altprojekt."""
        z = await zeichnung()
        for wert in ("A", "B", "C"):
            await anlegen(BALLON, z=z, w=wert)
        ids = [r["id"] for r in await anlegen(
            "select id from public.fair_ballons where zeichnung_id = cast(:z as uuid)"
            " order by nummer desc", z=z)]
        await anlegen("select public.fair_reihenfolge(cast(:z as uuid), :ids)",
                      z=z, ids=ids)
        assert await ballons(z) == [(1, "C"), (2, "B"), (3, "A")]

    async def test_unvollstaendige_reihenfolge_wird_abgelehnt(self, db):
        """Lieber gar nichts aendern als eine halbe Reihenfolge."""
        z = await zeichnung()
        for wert in ("A", "B", "C"):
            await anlegen(BALLON, z=z, w=wert)
        ids = [r["id"] for r in await anlegen(
            "select id from public.fair_ballons where zeichnung_id = cast(:z as uuid)"
            " order by nummer", z=z)]
        with pytest.raises(Exception) as fehler:
            await anlegen("select public.fair_reihenfolge(cast(:z as uuid), :ids)",
                          z=z, ids=ids[:2])
        assert "alle ballons" in str(fehler.value).lower()
        assert await ballons(z) == [(1, "A"), (2, "B"), (3, "C")]

    async def test_doppelte_nummer_bleibt_verboten(self, db):
        """Aufgeschoben heisst spaeter geprueft, nicht gar nicht."""
        z = await zeichnung()
        await anlegen(BALLON, z=z, w="A")
        with pytest.raises(Exception) as fehler:
            await anlegen(
                "insert into public.fair_ballons (zeichnung_id, nummer, bereich_x,"
                " bereich_y, bereich_b, bereich_h, blase_x, blase_y)"
                " values (cast(:z as uuid), 1, 0.2, 0.2, 0.05, 0.02, 0.4, 0.4)", z=z)
        assert "unique" in str(fehler.value).lower() or "eindeutig" in str(fehler.value).lower()


class TestRechte:
    async def test_lesen_braucht_ein_fair_recht(self, db):
        z = await zeichnung()
        await anlegen(BALLON, z=z, w="A")
        assert len(await als(LESER, "select * from public.fair_zeichnungen")) == 1
        assert len(await als(LESER, "select * from public.fair_ballons")) == 1
        assert await als(FREMD, "select * from public.fair_zeichnungen") == []
        assert await als(FREMD, "select * from public.fair_ballons") == []

    async def test_wer_nur_liest_setzt_keinen_ballon(self, db):
        z = await zeichnung()
        text = await als_erwartet_fehler(LESER, BALLON, z=z, w="A")
        assert "row-level security" in text
        await als(PRUEFER, BALLON, z=z, w="A")

    async def test_wer_nur_liest_loescht_keine_zeichnung(self, db):
        await zeichnung()
        assert await als(LESER, "delete from public.fair_zeichnungen returning id") == []
        assert len(await als(
            PRUEFER, "delete from public.fair_zeichnungen returning id")) == 1

    async def test_ballons_erben_die_sichtbarkeit(self, db):
        z = await zeichnung()
        await anlegen(BALLON, z=z, w="A")
        assert await als(FREMD, "select * from public.fair_ballons") == []


class TestZeichnung:
    async def test_nur_pdf_oder_bild(self, db):
        with pytest.raises(Exception) as fehler:
            await anlegen("insert into public.fair_zeichnungen (name, pfad, art)"
                          " values ('X', 'a/b.txt', 'text')")
        assert "check" in str(fehler.value).lower()

    async def test_drehung_nur_in_vierteln(self, db):
        with pytest.raises(Exception) as fehler:
            await anlegen("insert into public.fair_zeichnungen (name, pfad, art, drehung)"
                          " values ('X', 'a/b.pdf', 'pdf', 45)")
        assert "check" in str(fehler.value).lower()

    async def test_ballons_gehen_mit_der_zeichnung(self, db):
        z = await zeichnung()
        await anlegen(BALLON, z=z, w="A")
        await anlegen("delete from public.fair_zeichnungen where id = cast(:z as uuid)", z=z)
        uebrig = await anlegen("select count(*) as n from public.fair_ballons")
        assert uebrig[0]["n"] == 0

    async def test_der_eimer_ist_nicht_oeffentlich(self, db):
        zeile = (await anlegen(
            "select public, allowed_mime_types from storage.buckets where id = 'fair'"))[0]
        assert zeile["public"] is False
        assert "application/pdf" in zeile["allowed_mime_types"]
