"""Sensoren gegen eine echte Datenbank.

Im Blick stehen zwei Grenzen: die Community verlässt die Datenbank nicht, und
geschrieben wird nur über `compute` — nicht über PostgREST.
"""
from __future__ import annotations

import pytest
import pytest_asyncio
import sqlalchemy as sa

from app.db import SessionLocal
from tests._auth import USER_ID

LESER = '{"sub":"%s","role":"authenticated","apps":{"sensors":"viewer"}}' % USER_ID
VERWALTUNG = '{"sub":"%s","role":"authenticated","apps":{"platform":"admin"}}' % USER_ID
FREMD = '{"sub":"%s","role":"authenticated","apps":{"hr":"admin"}}' % USER_ID


@pytest_asyncio.fixture
async def db(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")

    async def leeren():
        async with SessionLocal() as s:
            async with s.begin():
                await s.execute(sa.text("delete from public.sensoren"))

    await leeren()
    async with SessionLocal() as s:
        async with s.begin():
            await s.execute(
                sa.text(
                    "insert into public.sensoren"
                    " (name, rechner, community, temperatur_oid)"
                    " values ('Serverraum', 'sensor.acm.local', '\\x00'::bytea,"
                    " '1.3.6.1.4.1.1.1')"
                )
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


class TestRechte:
    @pytest.mark.asyncio
    async def test_wer_sensoren_hat_sieht_sie(self, db):
        zeilen = await als(LESER, "select name, rechner from public.sensoren")
        assert [z["name"] for z in zeilen] == ["Serverraum"]

    @pytest.mark.asyncio
    async def test_ohne_recht_bleibt_die_liste_leer(self, db):
        assert await als(FREMD, "select name from public.sensoren") == []

    @pytest.mark.asyncio
    async def test_die_community_gibt_die_datenbank_nicht_heraus(self, db):
        """Nicht die Policy hält sie zurück, sondern das Spaltenrecht — auch
        die Plattform-Verwaltung bekommt sie über PostgREST nicht."""
        with pytest.raises(Exception, match="permission denied|keine Berechtigung"):
            await als(VERWALTUNG, "select community from public.sensoren")

    @pytest.mark.asyncio
    async def test_geschrieben_wird_nur_ueber_compute(self, db):
        """Kein `insert`-Recht für `authenticated`: jede Änderung kann die
        Community tragen, und die zu verschlüsseln braucht den Schlüssel."""
        with pytest.raises(Exception, match="permission denied|keine Berechtigung"):
            await als(
                VERWALTUNG,
                "insert into public.sensoren (name, rechner, community, temperatur_oid)"
                " values ('Neu', 'x', '\\x00'::bytea, '1.1')",
            )

    @pytest.mark.asyncio
    async def test_der_stand_haelt_sich_an_dieselbe_grenze(self, db):
        assert await als(FREMD, "select * from public.sensor_stand") == []
        assert len(await als(LESER, "select * from public.sensor_stand")) == 1


class TestZeitreihe:
    @pytest.mark.asyncio
    async def test_dieselbe_sekunde_zaehlt_einmal(self, db):
        async with SessionLocal() as s:
            async with s.begin():
                sensor_id = (
                    await s.execute(sa.text("select id from public.sensoren limit 1"))
                ).scalar()
                await s.execute(
                    sa.text(
                        "insert into public.sensor_messungen"
                        " (sensor_id, gemessen_am, temperatur)"
                        " values (:s, '2026-09-10 12:00:00+00', 21.5)"
                    ),
                    {"s": sensor_id},
                )
                with pytest.raises(Exception, match="duplicate|eindeutig"):
                    await s.execute(
                        sa.text(
                            "insert into public.sensor_messungen"
                            " (sensor_id, gemessen_am, temperatur)"
                            " values (:s, '2026-09-10 12:00:00+00', 99.9)"
                        ),
                        {"s": sensor_id},
                    )

    @pytest.mark.asyncio
    async def test_ein_geloeschter_sensor_nimmt_seine_zeitreihe_mit(self, db):
        async with SessionLocal() as s:
            async with s.begin():
                sensor_id = (
                    await s.execute(sa.text("select id from public.sensoren limit 1"))
                ).scalar()
                await s.execute(
                    sa.text(
                        "insert into public.sensor_messungen"
                        " (sensor_id, gemessen_am, temperatur)"
                        " values (:s, now(), 21.5)"
                    ),
                    {"s": sensor_id},
                )
                await s.execute(sa.text("delete from public.sensoren where id = :s"),
                                {"s": sensor_id})
                uebrig = (
                    await s.execute(sa.text("select count(*) from public.sensor_messungen"))
                ).scalar()
        assert uebrig == 0
