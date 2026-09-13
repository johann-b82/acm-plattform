"""ATR-Lieferungen gegen eine echte Datenbank.

Zwei Eigenschaften stehen im Blick. Erstens: die Zustände sind die des
Altsystems — Entwurf, erzeugt, abgelegt — und keiner davon sperrt die
Positionen. Zweitens: eine Position trägt ihre Werte selbst, damit ein
aufgeräumter Katalog einen erzeugten ATR nicht rückwirkend verändert.
"""
from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest
import pytest_asyncio
import sqlalchemy as sa

from app.db import SessionLocal
from tests._auth import USER_ID

LESER = '{"sub":"%s","role":"authenticated","apps":{"atr":"viewer"}}' % USER_ID
BEARBEITER = '{"sub":"%s","role":"authenticated","apps":{"atr":"editor"}}' % USER_ID
FREMD = '{"sub":"%s","role":"authenticated","apps":{"hr":"admin"}}' % USER_ID


@pytest_asyncio.fixture
async def db(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")

    async def leeren():
        async with SessionLocal() as s:
            async with s.begin():
                await s.execute(sa.text("delete from public.atr_lieferungen"))
                await s.execute(sa.text("delete from public.atr_teile"))

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


async def lieferung(status: str = "entwurf") -> str:
    zeilen = await anlegen(
        "insert into public.atr_lieferungen (quelle_dateiname, lieferschein_nr, status)"
        " values ('ls.pdf', '704511', :s) returning id", s=status)
    return str(zeilen[0]["id"])


POSITION = (
    "insert into public.atr_positionen (lieferung_id, reihenfolge, pos,"
    " teilenummer, bezeichnung, menge, gewicht_kg)"
    " values (cast(:l as uuid), :r, :p, :t, :b, 1, :g)"
)


class TestStatus:
    """Die Zustände des Altsystems: `draft` → `generated` → `delivered`."""

    @pytest.mark.parametrize("status", ["entwurf", "erzeugt", "abgelegt"])
    async def test_die_drei_zustaende_gibt_es(self, db, status):
        await lieferung(status)

    async def test_freigegeben_gibt_es_nicht_mehr(self, db):
        with pytest.raises(Exception) as fehler:
            await lieferung("freigegeben")
        assert "check" in str(fehler.value).lower()

    async def test_nach_der_erzeugung_bleiben_positionen_aenderbar(self, db):
        """Im Altsystem sperrt `generated` nichts: Seriennummern und Gewichte
        werden nachgetragen und die Dokumente neu erzeugt."""
        l = await lieferung("erzeugt")
        await anlegen(POSITION, l=l, r=1, p=10, t="VR-1", b="Halter", g=1.5)
        await anlegen("update public.atr_positionen set seriennummern = '{A1,A2}'")
        await anlegen(POSITION, l=l, r=2, p=20, t="VR-2", b="Neu", g=1.0)
        await anlegen("delete from public.atr_positionen where reihenfolge = 2")
        zeile = (await anlegen("select seriennummern from public.atr_positionen"))[0]
        assert zeile["seriennummern"] == ["A1", "A2"]


def _migration():
    pfad = Path(__file__).parents[1] / "alembic" / "versions" / "0048_atr_abgleich.py"
    spec = importlib.util.spec_from_file_location("m0048", pfad)
    modul = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modul)
    return modul


class TestDatenkorrektur:
    """ATR-09: die Übernahme hat `generated` auf `entwurf` gelegt. Korrigiert
    wird nur aus dem, was dasteht — ein Erzeugungsdatum."""

    async def test_mit_erzeugungsdatum_ist_erzeugt(self, db):
        erzeugt = await lieferung("entwurf")
        offen = await lieferung("entwurf")
        await anlegen(
            "update public.atr_lieferungen set erzeugt_am = now(),"
            " mappe_pfad = 'erzeugt/x/atr.xlsx' where id = cast(:i as uuid)", i=erzeugt)
        vorher = {
            str(z["id"]): z["geaendert_am"]
            for z in await anlegen("select id, geaendert_am from public.atr_lieferungen")
        }

        await anlegen(_migration().KORREKTUR)

        zeilen = {
            str(z["id"]): z
            for z in await anlegen("select id, status, geaendert_am from public.atr_lieferungen")
        }
        assert zeilen[erzeugt]["status"] == "erzeugt"
        assert zeilen[offen]["status"] == "entwurf"
        # Eine Korrektur ist keine Änderung an der Lieferung — sonst meldete
        # die Maske jede übernommene Mappe als veraltet.
        assert {k: z["geaendert_am"] for k, z in zeilen.items()} == vorher

    async def test_abgelegt_bleibt_abgelegt(self, db):
        l = await lieferung("abgelegt")
        await anlegen("update public.atr_lieferungen set erzeugt_am = now()")
        await anlegen(_migration().KORREKTUR)
        zeile = (await anlegen("select status from public.atr_lieferungen"))[0]
        assert zeile["status"] == "abgelegt"


class TestPositionStehtAlleine:
    async def test_werte_bleiben_wenn_das_katalogteil_verschwindet(self, db):
        """Der Katalog aendert sich; ein ATR nicht."""
        teil = (await anlegen(
            "insert into public.atr_teile (teilenummer, bezeichnung, gewicht_kg)"
            " values ('VR-1234-56', 'Halter links', 1.25) returning id"))[0]["id"]
        l = await lieferung()
        await anlegen(
            "insert into public.atr_positionen (lieferung_id, reihenfolge, teilenummer,"
            " teil_id, bezeichnung, gewicht_kg, menge)"
            " values (cast(:l as uuid), 1, 'VR-1234-56', cast(:t as uuid),"
            " 'Halter links', 1.25, 1)", l=l, t=str(teil))

        await anlegen("delete from public.atr_teile")
        zeile = (await anlegen(
            "select teil_id, bezeichnung, gewicht_kg from public.atr_positionen"))[0]
        assert zeile["teil_id"] is None
        assert zeile["bezeichnung"] == "Halter links"
        assert float(zeile["gewicht_kg"]) == 1.25

    async def test_die_normierte_nummer_entsteht_auch_hier(self, db):
        l = await lieferung()
        await anlegen(POSITION, l=l, r=1, p=10, t="VR-1234-56", b="Halter", g=None)
        zeile = (await anlegen(
            "select teilenummer_norm from public.atr_positionen"))[0]
        assert zeile["teilenummer_norm"] == "123456"

    async def test_reihenfolge_ist_je_lieferung_eindeutig(self, db):
        l = await lieferung()
        await anlegen(POSITION, l=l, r=1, p=10, t="VR-1", b="A", g=None)
        with pytest.raises(Exception) as fehler:
            await anlegen(POSITION, l=l, r=1, p=20, t="VR-2", b="B", g=None)
        assert "unique" in str(fehler.value).lower() or "duplicate" in str(fehler.value).lower()

    async def test_positionen_gehen_mit_der_lieferung(self, db):
        l = await lieferung()
        await anlegen(POSITION, l=l, r=1, p=10, t="VR-1", b="A", g=None)
        await anlegen("delete from public.atr_lieferungen")
        uebrig = await anlegen("select count(*) as n from public.atr_positionen")
        assert uebrig[0]["n"] == 0


class TestRechte:
    async def test_lesen_braucht_ein_atr_recht(self, db):
        l = await lieferung()
        await anlegen(POSITION, l=l, r=1, p=10, t="VR-1", b="A", g=None)
        assert len(await als(LESER, "select * from public.atr_lieferungen")) == 1
        assert len(await als(LESER, "select * from public.atr_positionen")) == 1
        assert await als(FREMD, "select * from public.atr_lieferungen") == []
        assert await als(FREMD, "select * from public.atr_positionen") == []

    async def test_status_aendern_braucht_editor(self, db):
        await lieferung()
        assert await als(
            LESER,
            "update public.atr_lieferungen set status = 'erzeugt' returning id") == []
        assert len(await als(
            BEARBEITER,
            "update public.atr_lieferungen set status = 'erzeugt' returning id")) == 1

    async def test_unbekannter_status_wird_abgelehnt(self, db):
        with pytest.raises(Exception) as fehler:
            await anlegen(
                "insert into public.atr_lieferungen (quelle_dateiname, status)"
                " values ('x.pdf', 'irgendwas')")
        assert "check" in str(fehler.value).lower()


class TestErzeugungsstempel:
    """Das Ablegen der erzeugten Dateien ist keine Änderung an der Lieferung."""

    async def test_ablegen_zieht_geaendert_am_nicht_hoch(self, db):
        l = await lieferung()
        vorher = (await anlegen(
            "select geaendert_am from public.atr_lieferungen"))[0]["geaendert_am"]

        await anlegen(
            "update public.atr_lieferungen set mappe_pfad = 'erzeugt/a/atr.xlsx',"
            " pdf_pfad = 'erzeugt/a/atr.pdf', etikett_pfad = 'erzeugt/a/e.docx',"
            " erzeugt_am = now()")

        zeile = (await anlegen(
            "select geaendert_am, erzeugt_am from public.atr_lieferungen"))[0]
        assert zeile["geaendert_am"] == vorher
        # Und die Mappe gilt damit als frisch, nicht als veraltet.
        assert zeile["erzeugt_am"] >= zeile["geaendert_am"]

    async def test_der_status_der_erzeugung_zaehlt_auch_nicht(self, db):
        """Die Erzeugung setzt `erzeugt` im selben Schreibvorgang wie die Pfade."""
        l = await lieferung()
        vorher = (await anlegen(
            "select geaendert_am from public.atr_lieferungen"))[0]["geaendert_am"]
        await anlegen(
            "update public.atr_lieferungen set mappe_pfad = 'erzeugt/a/atr.xlsx',"
            " erzeugt_am = now(), status = 'erzeugt'")
        zeile = (await anlegen(
            "select geaendert_am, status from public.atr_lieferungen"))[0]
        assert (zeile["geaendert_am"], zeile["status"]) == (vorher, "erzeugt")

    async def test_eine_echte_aenderung_zaehlt_weiter(self, db):
        l = await lieferung()
        await anlegen(
            "update public.atr_lieferungen set erzeugt_am = now(),"
            " mappe_pfad = 'erzeugt/a/atr.xlsx'")
        nach_erzeugung = (await anlegen(
            "select geaendert_am from public.atr_lieferungen"))[0]["geaendert_am"]

        await anlegen("update public.atr_lieferungen set containernummer = 'C-1'")
        zeile = (await anlegen(
            "select geaendert_am, erzeugt_am from public.atr_lieferungen"))[0]
        assert zeile["geaendert_am"] > nach_erzeugung
        # Jetzt ist die Mappe älter als ihre Daten — genau das soll die
        # Oberfläche anzeigen.
        assert zeile["erzeugt_am"] < zeile["geaendert_am"]
