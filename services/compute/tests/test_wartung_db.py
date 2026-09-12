"""Wartung gegen eine echte Datenbank.

Im Blick steht die Bedingung am Intervall: eine Wochenzahl gehört zu
`alle_n_wochen` — und nur dorthin.
"""
from __future__ import annotations

import pytest
import pytest_asyncio
import sqlalchemy as sa

from app.db import SessionLocal
from tests._auth import USER_ID

LESER = '{"sub":"%s","role":"authenticated","apps":{"production":"viewer"}}' % USER_ID
PFLEGER = '{"sub":"%s","role":"authenticated","apps":{"production":"editor"}}' % USER_ID
FREMD = '{"sub":"%s","role":"authenticated","apps":{"hr":"admin"}}' % USER_ID


@pytest_asyncio.fixture
async def db(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")

    async def leeren():
        async with SessionLocal() as s:
            async with s.begin():
                await s.execute(sa.text("delete from public.maschinen"))

    await leeren()
    async with SessionLocal() as s:
        async with s.begin():
            await s.execute(
                sa.text("insert into public.maschinen (name, standort) values ('Fräse 3', 'Halle 2')")
            )
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


async def maschine_id() -> str:
    async with SessionLocal() as s:
        return (await s.execute(sa.text("select id from public.maschinen limit 1"))).scalar()


class TestRechte:
    @pytest.mark.asyncio
    async def test_wer_produktion_hat_sieht_die_maschinen(self, db):
        assert len(await als(LESER, "select name from public.maschinen")) == 1

    @pytest.mark.asyncio
    async def test_ohne_recht_bleibt_die_liste_leer(self, db):
        assert await als(FREMD, "select name from public.maschinen") == []

    @pytest.mark.asyncio
    async def test_ein_leser_darf_nicht_anlegen(self, db):
        with pytest.raises(Exception, match="row-level security|violates"):
            await als(LESER, "insert into public.maschinen (name) values ('Neu')")

    @pytest.mark.asyncio
    async def test_ein_pfleger_darf(self, db):
        await als(PFLEGER, "insert into public.maschinen (name) values ('Neu')")


class TestIntervall:
    @pytest.mark.asyncio
    async def test_alle_n_wochen_ohne_zahl_geht_nicht(self, db):
        mid = await maschine_id()
        async with SessionLocal() as s:
            with pytest.raises(Exception, match="wochen_passend"):
                async with s.begin():
                    await s.execute(
                        sa.text(
                            "insert into public.wartungsaufgaben"
                            " (maschine_id, titel, intervall) values (:m, 'X', 'alle_n_wochen')"
                        ),
                        {"m": mid},
                    )

    @pytest.mark.asyncio
    async def test_eine_zahl_ohne_passendes_intervall_auch_nicht(self, db):
        """Im Altprojekt fehlt diese Haelfte: eine monatliche Aufgabe kann
        dort eine sinnlose „14" tragen."""
        mid = await maschine_id()
        async with SessionLocal() as s:
            with pytest.raises(Exception, match="wochen_passend"):
                async with s.begin():
                    await s.execute(
                        sa.text(
                            "insert into public.wartungsaufgaben"
                            " (maschine_id, titel, intervall, wochen)"
                            " values (:m, 'X', 'monatlich', 14)"
                        ),
                        {"m": mid},
                    )

    @pytest.mark.asyncio
    async def test_zusammen_passt_es(self, db):
        mid = await maschine_id()
        async with SessionLocal() as s:
            async with s.begin():
                await s.execute(
                    sa.text(
                        "insert into public.wartungsaufgaben"
                        " (maschine_id, titel, intervall, wochen)"
                        " values (:m, 'X', 'alle_n_wochen', 6)"
                    ),
                    {"m": mid},
                )
                anzahl = (
                    await s.execute(sa.text("select count(*) from public.wartungsaufgaben"))
                ).scalar()
        assert anzahl == 1


class TestKaskade:
    @pytest.mark.asyncio
    async def test_eine_geloeschte_maschine_nimmt_ihre_aufgaben_mit(self, db):
        mid = await maschine_id()
        async with SessionLocal() as s:
            async with s.begin():
                await s.execute(
                    sa.text(
                        "insert into public.wartungsaufgaben (maschine_id, titel, intervall)"
                        " values (:m, 'Ölstand', 'monatlich')"
                    ),
                    {"m": mid},
                )
                await s.execute(sa.text("delete from public.maschinen where id = :m"), {"m": mid})
                uebrig = (
                    await s.execute(sa.text("select count(*) from public.wartungsaufgaben"))
                ).scalar()
        assert uebrig == 0


class TestAnlageInEinemSchritt:
    """WAR-02: alle Stammdaten beim Anlegen — und die Abläufe dahinter mit
    Testdaten, weil der Bestand leer ist."""

    @pytest.mark.asyncio
    async def test_alle_felder_stehen_danach_drin(self, db):
        zeilen = await als(
            PFLEGER,
            "insert into public.maschinen"
            " (name, inventarnummer, standort, hersteller, modell, verantwortlich, status)"
            " values ('Fräse 4', 'INV-0815', 'Halle 1', 'DMG Mori', 'DMU 50', 'M. Muster',"
            " 'stillgelegt')"
            " returning name, inventarnummer, standort, hersteller, modell, verantwortlich, status",
        )
        assert zeilen == [{
            "name": "Fräse 4", "inventarnummer": "INV-0815", "standort": "Halle 1",
            "hersteller": "DMG Mori", "modell": "DMU 50", "verantwortlich": "M. Muster",
            "status": "stillgelegt",
        }]

    @pytest.mark.asyncio
    async def test_ein_unbekannter_status_geht_nicht(self, db):
        with pytest.raises(Exception, match="status"):
            await als(PFLEGER, "insert into public.maschinen (name, status) values ('X', 'kaputt')")

    @pytest.mark.asyncio
    async def test_maschine_aufgabe_und_nachweis_hintereinander(self, db):
        zeilen = await als(
            PFLEGER,
            "with m as (insert into public.maschinen (name, inventarnummer)"
            "           values ('Presse 1', 'INV-1') returning id),"
            " a as (insert into public.wartungsaufgaben (maschine_id, titel, anleitung, intervall, wochen)"
            "       select id, 'Hydrauliköl', 'Stand am Schauglas', 'alle_n_wochen', 6 from m"
            "       returning id),"
            " d as (insert into public.wartungsdateien (maschine_id, art, pfad, dateiname, mime)"
            "       select id, 'nachweis', :pfad, 'bogen-kw27.pdf', 'application/pdf' from m"
            "       returning id)"
            " select (select count(*) from a) as aufgaben, (select count(*) from d) as nachweise",
            pfad=f"{USER_ID}/bogen.pdf",
        )
        assert zeilen == [{"aufgaben": 1, "nachweise": 1}]

    @pytest.mark.asyncio
    async def test_ein_leser_legt_keinen_nachweis_ab(self, db):
        mid = await maschine_id()
        with pytest.raises(Exception, match="row-level security|violates"):
            await als(
                LESER,
                "insert into public.wartungsdateien (maschine_id, art, pfad, dateiname)"
                " values (:m, 'nachweis', 'x/y.pdf', 'y.pdf')",
                m=mid,
            )

    @pytest.mark.asyncio
    async def test_eine_geloeschte_maschine_nimmt_ihre_nachweise_mit(self, db):
        mid = await maschine_id()
        async with SessionLocal() as s:
            async with s.begin():
                await s.execute(
                    sa.text(
                        "insert into public.wartungsdateien (maschine_id, art, pfad, dateiname)"
                        " values (:m, 'nachweis', 'x/y.pdf', 'y.pdf')"
                    ),
                    {"m": mid},
                )
                await s.execute(sa.text("delete from public.maschinen where id = :m"), {"m": mid})
                uebrig = (
                    await s.execute(sa.text("select count(*) from public.wartungsdateien"))
                ).scalar()
        assert uebrig == 0
