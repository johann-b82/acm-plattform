"""Migration 0068 gegen eine echte Datenbank.

Die Sicht `person_bereich`: Personen-Abweichung vor team-genauer Zuordnung vor
Abteilungs-Zuordnung; eine erfasste Abteilung ohne Team-Treffer bleibt offen;
eine nicht erfasste Abteilung taucht gar nicht auf.
"""
from __future__ import annotations

import json

import pytest
import pytest_asyncio
import sqlalchemy as sa

from app.db import SessionLocal

pytestmark = pytest.mark.asyncio

ABT = "TestAbt 0068"
FREMD = "Nicht erfasst 0068"
E_TEAMX = 968101
E_TEAMY = 968102
E_OVERRIDE = 968103
E_FREMD = 968104
ALLE = (E_TEAMX, E_TEAMY, E_OVERRIDE, E_FREMD)


async def ausfuehren(sql: str, **params):
    async with SessionLocal() as s:
        async with s.begin():
            ergebnis = await s.execute(sa.text(sql), params)
            return [dict(r) for r in ergebnis.mappings()] if ergebnis.returns_rows else []


async def _mitarbeiter(mid: int, abteilung: str, team: str | None) -> None:
    if team is None:
        roh = "{}"
    else:
        roh = json.dumps({"attributes": {"team": {"value": {"attributes": {"name": team}}}}})
    await ausfuehren(
        "insert into public.personio_employees (id, first_name, last_name, department, status, raw_json, synced_at)"
        " values (:m, 'Test', 'Person', :d, 'active', cast(:r as jsonb), now())",
        m=mid, d=abteilung, r=roh,
    )


async def _bereich_von(mid: int):
    zeilen = await ausfuehren(
        "select b.name from public.person_bereich pb"
        " left join public.kompetenz_bereiche b on b.id = pb.bereich_id"
        " where pb.employee_id = :m", m=mid,
    )
    return zeilen[0]["name"] if zeilen else "NICHT-IN-SICHT"


@pytest_asyncio.fixture
async def stamm(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")

    async def aufraeumen():
        for mid in ALLE:
            await ausfuehren("delete from public.personio_employees where id = :m", m=mid)
        await ausfuehren("delete from public.kompetenz_bereiche where name in ('Test 0068 A', 'Test 0068 B')")

    await aufraeumen()
    a = (await ausfuehren(
        "insert into public.kompetenz_bereiche (name, reihenfolge) values ('Test 0068 A', 0) returning id::text"
    ))[0]["id"]
    b = (await ausfuehren(
        "insert into public.kompetenz_bereiche (name, reihenfolge) values ('Test 0068 B', 0) returning id::text"
    ))[0]["id"]
    # Nur eine team-genaue Zuordnung, kein Abteilungs-weiter Eintrag.
    await ausfuehren(
        "insert into public.bereich_zuordnung (abteilung, team, bereich_id) values (:a, 'TeamX', cast(:b as uuid))",
        a=ABT, b=b,
    )
    await _mitarbeiter(E_TEAMX, ABT, "TeamX")
    await _mitarbeiter(E_TEAMY, ABT, "TeamY")
    await _mitarbeiter(E_OVERRIDE, ABT, "TeamX")
    await _mitarbeiter(E_FREMD, FREMD, None)
    await ausfuehren(
        "insert into public.bereich_zuordnung_person (employee_id, bereich_id) values (:m, cast(:a as uuid))",
        m=E_OVERRIDE, a=a,
    )
    yield {"a": a, "b": b}
    await aufraeumen()


async def test_team_genaue_zuordnung_greift(stamm):
    assert await _bereich_von(E_TEAMX) == "Test 0068 B"


async def test_erfasste_abteilung_ohne_teamtreffer_bleibt_offen(stamm):
    # In der Sicht, aber ohne Bereich (nicht zugeordnet).
    assert await _bereich_von(E_TEAMY) is None


async def test_personen_abweichung_schlaegt_die_zuordnung(stamm):
    assert await _bereich_von(E_OVERRIDE) == "Test 0068 A"


async def test_nicht_erfasste_abteilung_taucht_nicht_auf(stamm):
    assert await _bereich_von(E_FREMD) == "NICHT-IN-SICHT"


async def test_team_genau_schlaegt_abteilung_weit(stamm):
    # Zusätzlich einen abteilungsweiten Eintrag (team null) → TeamX bleibt bei B,
    # TeamY fällt auf A.
    await ausfuehren(
        "insert into public.bereich_zuordnung (abteilung, team, bereich_id) values (:a, null, cast(:x as uuid))",
        a=ABT, x=stamm["a"],
    )
    assert await _bereich_von(E_TEAMX) == "Test 0068 B"
    assert await _bereich_von(E_TEAMY) == "Test 0068 A"
