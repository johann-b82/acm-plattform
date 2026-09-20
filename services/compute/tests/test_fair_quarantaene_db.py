"""FAIR-Quarantäne der Fehlablage: reversibel, idempotent, treffsicher.

Die Migration 0064 nimmt genau die fehlplatzierte Logo-Datei (gleicher Name,
leerer Kunde und leere Teilenummer) aus der Liste, ohne sie zu löschen — eine
legitime gleichnamige Zeichnung mit gepflegten Feldern bleibt unangetastet.
"""
from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest
import pytest_asyncio
import sqlalchemy as sa

from app.db import SessionLocal

pytestmark = pytest.mark.asyncio


def _lade_migration(name: str):
    pfad = Path(__file__).resolve().parents[1] / "alembic" / "versions" / name
    spec = importlib.util.spec_from_file_location(name[:-3], pfad)
    mod = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(mod)
    return mod


MIG = _lade_migration("0064_fair_logo_quarantaene.py")


async def sql(text: str, **p):
    async with SessionLocal() as s:
        async with s.begin():
            r = await s.execute(sa.text(text), p)
            return [dict(z) for z in r.mappings()] if r.returns_rows else []


@pytest_asyncio.fixture
async def db(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")

    async def leeren():
        await sql("delete from public.fair_zeichnungen")

    await leeren()
    # 1) Die Fehlablage: Logo ohne Kunde/Teilenummer.
    await sql(
        "insert into public.fair_zeichnungen (name, pfad, art)"
        " values ('ACM_Logo_Blue_print.pdf', 'fehlablage', 'pdf')"
    )
    # 2) Eine legitime, gleichnamige Zeichnung mit gepflegten Feldern.
    await sql(
        "insert into public.fair_zeichnungen (name, teilenummer, kunde, pfad, art)"
        " values ('ACM_Logo_Blue_print.pdf', 'T-1', 'Diehl', 'legitim', 'pdf')"
    )
    # 3) Eine ganz normale Zeichnung.
    await sql(
        "insert into public.fair_zeichnungen (name, teilenummer, pfad, art)"
        " values ('Halter', 'T-2', 'normal', 'pdf')"
    )
    yield
    await leeren()


async def _quarantaeniert() -> set[str]:
    zeilen = await sql(
        "select pfad from public.fair_zeichnungen where quarantaene_am is not null"
    )
    return {z["pfad"] for z in zeilen}


async def test_trifft_nur_die_fehlablage(db):
    await sql(MIG.UPGRADE)
    assert await _quarantaeniert() == {"fehlablage"}
    # Nichts wurde gelöscht — alle drei Zeilen sind noch da.
    alle = await sql("select count(*) as n from public.fair_zeichnungen")
    assert alle[0]["n"] == 3


async def test_ist_idempotent(db):
    await sql(MIG.UPGRADE)
    await sql(MIG.UPGRADE)
    assert await _quarantaeniert() == {"fehlablage"}


async def test_laesst_sich_zuruecknehmen(db):
    await sql(MIG.UPGRADE)
    await sql(MIG.DOWNGRADE)
    assert await _quarantaeniert() == set()
