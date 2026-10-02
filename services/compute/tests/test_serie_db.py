"""Serie erzeugen: die Planungslogik (Migration 0070).

Die Erzeugung selbst (PDF, Storage) läuft nur auf der Plattform; hier geprüft
wird die Leiter-Regel und der Bogeninhalt (allgemeine Punkte + Familien).
"""
from __future__ import annotations

from datetime import date

import pytest
import pytest_asyncio
import sqlalchemy as sa

from app.db import SessionLocal, kompetenz_bereiche
from app.einarbeitung.serie import OBERSTER_LEITER, effektiver_leiter, plan_person

pytestmark = pytest.mark.asyncio

E = 971001


def test_effektiver_leiter_normalfall():
    assert effektiver_leiter("Chef", date(2024, 1, 1), "Anna Meier", date(2026, 1, 1)) == "Chef"


def test_selbst_der_leiter_bekommt_den_obersten():
    assert effektiver_leiter("Anna Meier", date(2024, 1, 1), "Anna  Meier", date(2026, 1, 1)) == OBERSTER_LEITER


def test_leiter_spaeter_eingetreten_bekommt_den_obersten():
    # Chef trat 2026 ein, die Person 2025 -> Chef war noch nicht da.
    assert effektiver_leiter("Chef", date(2026, 6, 1), "Anna Meier", date(2025, 1, 1)) == OBERSTER_LEITER


def test_ohne_leiter_den_obersten():
    assert effektiver_leiter(None, None, "Anna Meier", date(2025, 1, 1)) == OBERSTER_LEITER


async def ausfuehren(sql: str, **p):
    async with SessionLocal() as s:
        async with s.begin():
            r = await s.execute(sa.text(sql), p)
            return [dict(x) for x in r.mappings()] if r.returns_rows else []


@pytest_asyncio.fixture
async def stamm(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")

    async def weg():
        await ausfuehren("delete from public.kompetenz_bereiche where name = 'Test 0070'")
        await ausfuehren("delete from public.personio_employees where id = :e", e=E)

    await weg()
    await ausfuehren(
        "insert into public.personio_employees (id, first_name, last_name, hire_date, status, raw_json, synced_at)"
        " values (:e, 'Test', 'Person', date '2026-06-01', 'active',"
        " '{\"attributes\":{\"position\":{\"value\":\"Produktionsmitarbeiter\"}}}'::jsonb, now())", e=E,
    )
    bid = (await ausfuehren(
        "insert into public.kompetenz_bereiche (name, leiter, reihenfolge) values ('Test 0070', 'Chef Leiter', 0) returning id::text"
    ))[0]["id"]
    await ausfuehren(
        "insert into public.kompetenz_familien (bereich_id, name, beschreibung, reihenfolge, mindest_l2, mindest_l3)"
        " values (cast(:b as uuid), 'Nähen', 'Einarbeitung in das Nähen.', 1, 0, 0)", b=bid,
    )
    yield bid
    await weg()


async def _bereich(bid):
    async with SessionLocal() as s:
        return (await s.execute(
            sa.select(kompetenz_bereiche).where(kompetenz_bereiche.c.id == bid)
        )).mappings().one()


async def test_plan_enthaelt_allgemein_und_familien(stamm):
    bereich = await _bereich(stamm)
    async with SessionLocal() as s:
        plan = await plan_person(s, E, bereich, {"chef leiter": date(2025, 1, 1)})
    assert plan.name == "Test Person"
    assert plan.stelle == "Produktionsmitarbeiter"
    assert plan.beginn == date(2026, 6, 1)
    assert plan.vorgesetzter == "Chef Leiter"
    # Die sieben allgemeinen Punkte (aus 0070) plus die eine Familie.
    assert len(plan.inhalt) == 8
    assert plan.inhalt[0]["thema"] == "Personalwesen"
    familie = plan.inhalt[-1]
    assert (familie["thema"], familie["ansprechpartner"]) == ("Nähen", "Chef Leiter")


async def test_plan_regel_leiter_spaeter(stamm):
    bereich = await _bereich(stamm)
    async with SessionLocal() as s:
        # Chef trat nach der Person ein -> oberster Leiter.
        plan = await plan_person(s, E, bereich, {"chef leiter": date(2026, 12, 1)})
    assert plan.vorgesetzter == OBERSTER_LEITER
    assert plan.inhalt[-1]["ansprechpartner"] == OBERSTER_LEITER
