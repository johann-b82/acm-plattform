"""KPI-Bewertung gegen eine echte Datenbank.

Zwei Dinge stehen im Blick: dass die Registry wirklich `zielwerte` ist (eine
Bewertung ohne Kennzahl darf nicht entstehen), und dass die Rechte stimmen —
lesen darf, wer die Zahlen sieht, schreiben nur, wer die Einstellungen
bearbeiten darf.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest
import pytest_asyncio
import sqlalchemy as sa

from app.db import SessionLocal
from tests._auth import USER_ID

LESER = '{"sub":"%s","role":"authenticated","apps":{"kpi":"viewer"}}' % USER_ID
SCHREIBER = ('{"sub":"%s","role":"authenticated",'
             '"apps":{"kpi":"viewer","settings":"editor"}}') % USER_ID
FREMD = '{"sub":"%s","role":"authenticated","apps":{"hr":"admin"}}' % USER_ID

SCHLUESSEL = "einkauf_otd"


@pytest_asyncio.fixture
async def db(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")

    async def leeren():
        async with SessionLocal() as s:
            async with s.begin():
                await s.execute(sa.text("delete from public.kpi_massnahmen"))
                await s.execute(sa.text("delete from public.kpi_kommentare"))
                await s.execute(sa.text(
                    "insert into auth.users (id, email) values (cast(:i as uuid), :m)"
                    " on conflict (id) do nothing"), {"i": USER_ID, "m": "u@example.com"})

    await leeren()
    yield
    await leeren()


async def als(claims: str, sql: str, **params):
    """Fuehrt SQL als `authenticated` mit diesen Claims aus. Gibt Zeilen oder
    die Ausnahme zurueck — RLS meldet sich je nach Fall verschieden."""
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


async def anlegen(sql: str, **params) -> None:
    """Daten einrichten, ohne Rechte zu pruefen.

    `als` rollt immer zurueck — das ist fuer eine RLS-Probe richtig und fuers
    Einrichten falsch. Wer beides mischt, prueft am Ende gegen eine leere
    Tabelle und merkt es nicht.
    """
    async with SessionLocal() as s:
        async with s.begin():
            await s.execute(sa.text(sql), params)


async def als_erwartet_fehler(claims: str, sql: str, **params) -> str:
    with pytest.raises(Exception) as fehler:
        await als(claims, sql, **params)
    return str(fehler.value).lower()


class TestRegistry:
    async def test_kommentar_braucht_eine_bekannte_kennzahl(self, db):
        """Der Fremdschluessel auf `zielwerte` ist die Registry. Ohne ihn
        entstuende eine zweite Liste, die auseinanderlaufen kann."""
        text = await als_erwartet_fehler(
            SCHREIBER,
            "insert into public.kpi_kommentare (schluessel, text)"
            " values ('gibt_es_nicht', 'Test')",
        )
        assert "foreign key" in text or "verletzt" in text or "violates" in text

    async def test_leerer_text_wird_abgelehnt(self, db):
        text = await als_erwartet_fehler(
            SCHREIBER,
            "insert into public.kpi_kommentare (schluessel, text) values (:s, '   ')",
            s=SCHLUESSEL,
        )
        assert "check" in text

    async def test_uebersicht_kennt_jede_kennzahl_mit_zielwert(self, db):
        zeilen = await als(LESER, "select * from public.kpi_bewertung_uebersicht()")
        async with SessionLocal() as s:
            anzahl = await s.scalar(sa.text("select count(*) from public.zielwerte"))
        assert len(zeilen) == anzahl
        assert all(z["kommentare"] == 0 for z in zeilen)


class TestMassnahmen:
    async def test_erledigt_setzt_das_datum_von_selbst(self, db):
        await anlegen("insert into public.kpi_massnahmen (schluessel, titel, status)"
                      " values (:s, 'Lieferanten anschreiben', 'erledigt')", s=SCHLUESSEL)
        zeilen = await als(LESER, "select status, erledigt_am from public.kpi_massnahmen")
        assert zeilen[0]["erledigt_am"] == date.today()

    async def test_wieder_geoeffnet_verliert_das_datum(self, db):
        async with SessionLocal() as s:
            async with s.begin():
                await s.execute(sa.text(
                    "insert into public.kpi_massnahmen (schluessel, titel, status)"
                    " values (:s, 'T', 'erledigt')"), {"s": SCHLUESSEL})
                await s.execute(sa.text(
                    "update public.kpi_massnahmen set status = 'laeuft'"))
                zeile = (await s.execute(sa.text(
                    "select status, erledigt_am from public.kpi_massnahmen"))).mappings().one()
        assert zeile["erledigt_am"] is None

    async def test_unbekannter_status_wird_abgelehnt(self, db):
        text = await als_erwartet_fehler(
            SCHREIBER,
            "insert into public.kpi_massnahmen (schluessel, titel, status)"
            " values (:s, 'T', 'vielleicht')", s=SCHLUESSEL)
        assert "check" in text

    async def test_uebersicht_zaehlt_offen_ueberfaellig_erledigt(self, db):
        gestern = date.today() - timedelta(days=1)
        morgen = date.today() + timedelta(days=1)
        async with SessionLocal() as s:
            async with s.begin():
                for titel, status, faellig in (
                    ("A", "offen", gestern),      # ueberfaellig
                    ("B", "laeuft", morgen),      # offen, nicht ueberfaellig
                    ("C", "erledigt", gestern),   # zaehlt nicht als offen
                    ("D", "verworfen", gestern),  # zaehlt nirgends
                ):
                    await s.execute(sa.text(
                        "insert into public.kpi_massnahmen (schluessel, titel, status, faellig_am)"
                        " values (:s, :t, :st, :f)"),
                        {"s": SCHLUESSEL, "t": titel, "st": status, "f": faellig})

        zeile = next(z for z in await als(LESER, "select * from public.kpi_bewertung_uebersicht()")
                     if z["schluessel"] == SCHLUESSEL)
        assert zeile["offen"] == 2
        assert zeile["ueberfaellig"] == 1
        assert zeile["erledigt"] == 1

    async def test_kommentar_und_zeitpunkt_in_der_uebersicht(self, db):
        await anlegen("insert into public.kpi_kommentare (schluessel, text)"
                      " values (:s, 'Erster')", s=SCHLUESSEL)
        zeile = next(z for z in await als(LESER, "select * from public.kpi_bewertung_uebersicht()")
                     if z["schluessel"] == SCHLUESSEL)
        assert zeile["kommentare"] == 1
        assert zeile["letzter_kommentar"] is not None

    async def test_geloeschter_zielwert_nimmt_alles_mit(self, db):
        """`on delete cascade`: eine Bewertung ohne Kennzahl bleibt nicht liegen."""
        async with SessionLocal() as s:
            async with s.begin():
                await s.execute(sa.text(
                    "insert into public.zielwerte"
                    " (schluessel, bereich, label, wert, einheit, richtung)"
                    " values ('probe_kennzahl', 'test', 'Probe', 1, 'anzahl', 'min')"))
                await s.execute(sa.text(
                    "insert into public.kpi_kommentare (schluessel, text)"
                    " values ('probe_kennzahl', 'Test')"))
                await s.execute(sa.text(
                    "delete from public.zielwerte where schluessel = 'probe_kennzahl'"))
                rest = await s.scalar(sa.text("select count(*) from public.kpi_kommentare"))
        assert rest == 0


class TestRechte:
    async def test_schreiber_darf_schreiben(self, db):
        """Gegenprobe zur Absage unten — sonst prueft der Test nur, dass
        ueberhaupt niemand schreiben kann."""
        async with SessionLocal() as s:
            trans = await s.begin()
            try:
                await s.execute(sa.text("set local role authenticated"))
                await s.execute(
                    sa.text("select set_config('request.jwt.claims', :c, true)"),
                    {"c": SCHREIBER})
                await s.execute(sa.text(
                    "insert into public.kpi_kommentare (schluessel, text)"
                    " values (:s, 'Geht')"), {"s": SCHLUESSEL})
                anzahl = await s.scalar(sa.text("select count(*) from public.kpi_kommentare"))
            finally:
                await trans.rollback()
        assert anzahl == 1

    async def test_leser_sieht_aber_schreibt_nicht(self, db):
        await anlegen("insert into public.kpi_kommentare (schluessel, text)"
                      " values (:s, 'Da')", s=SCHLUESSEL)
        assert len(await als(LESER, "select * from public.kpi_kommentare")) == 1

        text = await als_erwartet_fehler(
            LESER,
            "insert into public.kpi_kommentare (schluessel, text) values (:s, 'Nicht')",
            s=SCHLUESSEL)
        assert "row-level security" in text or "policy" in text

    async def test_ohne_kpi_recht_keine_zeilen(self, db):
        await anlegen("insert into public.kpi_kommentare (schluessel, text)"
                      " values (:s, 'Da')", s=SCHLUESSEL)
        assert await als(FREMD, "select * from public.kpi_kommentare") == []
        assert await als(FREMD, "select * from public.kpi_bewertung_uebersicht()") == []

    async def test_leser_darf_keine_massnahme_aendern(self, db):
        async with SessionLocal() as s:
            async with s.begin():
                await s.execute(sa.text(
                    "insert into public.kpi_massnahmen (schluessel, titel)"
                    " values (:s, 'Bleibt')"), {"s": SCHLUESSEL})
        # Kein Fehler, aber auch keine geaenderte Zeile — so sieht RLS aus.
        async with SessionLocal() as s:
            trans = await s.begin()
            try:
                await s.execute(sa.text("set local role authenticated"))
                await s.execute(
                    sa.text("select set_config('request.jwt.claims', :c, true)"), {"c": LESER})
                ergebnis = await s.execute(sa.text(
                    "update public.kpi_massnahmen set titel = 'Geaendert'"))
                betroffen = ergebnis.rowcount
            finally:
                await trans.rollback()
        assert betroffen == 0
