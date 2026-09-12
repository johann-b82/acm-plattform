"""Zentrale Plattform-Einstellungen gegen eine echte Datenbank.

Heute: die Seitengröße aller Tabellen (TAB-01). Sie gilt für alle — deshalb
liest sie jeder Angemeldete, und setzen darf sie nur die Plattform-Verwaltung.
"""
from __future__ import annotations

import pytest
import pytest_asyncio
import sqlalchemy as sa

from app.db import SessionLocal
from tests._auth import USER_ID

VERWALTUNG = '{"sub":"%s","role":"authenticated","apps":{"platform":"admin"}}' % USER_ID
FREMD = '{"sub":"%s","role":"authenticated","apps":{"kpi":"admin","settings":"admin"}}' % USER_ID


@pytest_asyncio.fixture
async def db(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")

    async def zuruecksetzen():
        async with SessionLocal() as s:
            async with s.begin():
                await s.execute(
                    sa.text("update public.plattform_einstellungen set tabellen_seitengroesse = 25")
                )

    await zuruecksetzen()
    yield
    await zuruecksetzen()


async def als(claims: str, sql: str):
    async with SessionLocal() as s:
        trans = await s.begin()
        try:
            await s.execute(sa.text("set local role authenticated"))
            await s.execute(
                sa.text("select set_config('request.jwt.claims', :c, true)"), {"c": claims}
            )
            ergebnis = await s.execute(sa.text(sql))
            return [dict(r) for r in ergebnis.mappings()] if ergebnis.returns_rows else []
        finally:
            await trans.rollback()


@pytest.mark.asyncio
async def test_vorgabe_ist_25_und_jeder_liest_sie(db):
    assert await als(FREMD, "select tabellen_seitengroesse from public.plattform_einstellungen") == [
        {"tabellen_seitengroesse": 25}
    ]


@pytest.mark.asyncio
async def test_nur_die_plattform_verwaltung_setzt_sie(db):
    sql = "update public.plattform_einstellungen set tabellen_seitengroesse = 50 where id returning tabellen_seitengroesse"
    # Auch ein Einstellungs-Admin ist nicht die Plattform-Verwaltung.
    assert await als(FREMD, sql) == []
    assert await als(VERWALTUNG, sql) == [{"tabellen_seitengroesse": 50}]


@pytest.mark.asyncio
@pytest.mark.parametrize("wert", [10, 26, 200])
async def test_nur_25_50_100_sind_erlaubt(db, wert):
    async with SessionLocal() as s:
        with pytest.raises(Exception, match="check"):
            async with s.begin():
                await s.execute(
                    sa.text("update public.plattform_einstellungen set tabellen_seitengroesse = :w"),
                    {"w": wert},
                )


@pytest.mark.asyncio
async def test_es_gibt_genau_eine_zeile(db):
    async with SessionLocal() as s:
        with pytest.raises(Exception):
            async with s.begin():
                await s.execute(sa.text("insert into public.plattform_einstellungen (id) values (false)"))
