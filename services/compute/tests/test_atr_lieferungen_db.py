"""ATR-Lieferungen gegen eine echte Datenbank.

Zwei Eigenschaften stehen im Blick. Erstens: eine freigegebene Lieferung wird
nicht mehr geändert, und das hängt an der Tabelle, nicht an der Oberfläche —
über PostgREST gäbe es sonst einen Weg daran vorbei. Zweitens: eine Position
trägt ihre Werte selbst, damit ein aufgeräumter Katalog einen freigegebenen
ATR nicht rückwirkend verändert.
"""
from __future__ import annotations

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


class TestFreigabe:
    async def test_ein_entwurf_laesst_sich_aendern(self, db):
        l = await lieferung("entwurf")
        await anlegen(POSITION, l=l, r=1, p=10, t="VR-1", b="Halter", g=1.5)
        await anlegen("update public.atr_positionen set gewicht_kg = 2.0")
        zeile = (await anlegen("select gewicht_kg from public.atr_positionen"))[0]
        assert float(zeile["gewicht_kg"]) == 2.0

    async def test_freigegeben_ist_fest(self, db):
        """Der Riegel haengt an der Tabelle, nicht an der Oberflaeche."""
        l = await lieferung("entwurf")
        await anlegen(POSITION, l=l, r=1, p=10, t="VR-1", b="Halter", g=1.5)
        await anlegen("update public.atr_lieferungen set status = 'freigegeben'")

        for anweisung in (
            "update public.atr_positionen set gewicht_kg = 9.9",
            "delete from public.atr_positionen",
        ):
            with pytest.raises(Exception) as fehler:
                await anlegen(anweisung)
            assert "freigegeben" in str(fehler.value).lower()

        with pytest.raises(Exception) as fehler:
            await anlegen(POSITION, l=l, r=2, p=20, t="VR-2", b="Neu", g=1.0)
        assert "freigegeben" in str(fehler.value).lower()

    async def test_zuruecknehmen_bleibt_moeglich(self, db):
        """Sonst waere ein Tippfehler endgueltig."""
        l = await lieferung("entwurf")
        await anlegen(POSITION, l=l, r=1, p=10, t="VR-1", b="Halter", g=1.5)
        await anlegen("update public.atr_lieferungen set status = 'freigegeben'")
        await anlegen("update public.atr_lieferungen set status = 'entwurf'")
        await anlegen("update public.atr_positionen set gewicht_kg = 3.0")
        zeile = (await anlegen("select gewicht_kg from public.atr_positionen"))[0]
        assert float(zeile["gewicht_kg"]) == 3.0

    async def test_die_lieferung_selbst_bleibt_aenderbar(self, db):
        """Der Riegel gilt den Positionen. Kopfdaten wie die Containernummer
        traegt man auch nach der Freigabe noch nach."""
        l = await lieferung("freigegeben")
        await anlegen(
            "update public.atr_lieferungen set containernummer = 'C-77'")
        zeile = (await anlegen(
            "select containernummer from public.atr_lieferungen"))[0]
        assert zeile["containernummer"] == "C-77"


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

    async def test_freigeben_braucht_editor(self, db):
        await lieferung()
        assert await als(
            LESER,
            "update public.atr_lieferungen set status = 'freigegeben' returning id") == []
        assert len(await als(
            BEARBEITER,
            "update public.atr_lieferungen set status = 'freigegeben' returning id")) == 1

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
