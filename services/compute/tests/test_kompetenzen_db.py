"""Migration 0067 gegen eine echte Datenbank.

Die Stufe 0–3 für Ist und Soll, die „nicht leer"-Bedingung, die Kaskade vom
Bereich zur Bewertung und die Zugriffsregeln (sehen mit `hr`, pflegen ab
`hr: editor`).
"""
from __future__ import annotations

import json

import pytest
import pytest_asyncio
import sqlalchemy as sa
from sqlalchemy.exc import DBAPIError, IntegrityError

from app.db import SessionLocal
from tests._auth import USER_ID

pytestmark = pytest.mark.asyncio

MITARBEITER = 967001


def claims(apps: dict) -> str:
    return json.dumps({"sub": USER_ID, "role": "authenticated", "apps": apps})


async def ausfuehren(sql: str, **params):
    async with SessionLocal() as s:
        async with s.begin():
            ergebnis = await s.execute(sa.text(sql), params)
            return [dict(r) for r in ergebnis.mappings()] if ergebnis.returns_rows else []


async def als(claims_json: str, sql: str, **params):
    """Als angemeldete Person mit gesetzten Rechten — mit RLS."""
    async with SessionLocal() as s:
        trans = await s.begin()
        try:
            await s.execute(sa.text("set local role authenticated"))
            await s.execute(
                sa.text("select set_config('request.jwt.claims', :c, true)"),
                {"c": claims_json},
            )
            ergebnis = await s.execute(sa.text(sql), params)
            return [dict(r) for r in ergebnis.mappings()] if ergebnis.returns_rows else []
        finally:
            await trans.rollback()


@pytest_asyncio.fixture
async def stamm(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")

    async def aufraeumen():
        await ausfuehren("delete from public.kompetenz_bereiche where name = 'Test 0067'")
        await ausfuehren("delete from public.personio_employees where id = :m", m=MITARBEITER)

    await aufraeumen()
    await ausfuehren(
        "insert into public.personio_employees (id, first_name, last_name, status, synced_at)"
        " values (:m, 'Test', 'Person', 'active', now())",
        m=MITARBEITER,
    )
    bereich = (await ausfuehren(
        "insert into public.kompetenz_bereiche (name, abteilung, reihenfolge)"
        " values ('Test 0067', 'Production', 0) returning id::text"
    ))[0]["id"]
    familie = (await ausfuehren(
        "insert into public.kompetenz_familien (bereich_id, name, reihenfolge, mindest_l2, mindest_l3)"
        " values (cast(:b as uuid), 'Nähen', 1, 0, 0) returning id::text", b=bereich,
    ))[0]["id"]
    yield {"bereich": bereich, "familie": familie}
    await aufraeumen()


async def _bewerten(familie: str, **spalten) -> None:
    felder = ", ".join(spalten)
    werte = ", ".join(f":{k}" for k in spalten)
    await ausfuehren(
        f"insert into public.kompetenz_bewertungen (familie_id, employee_id, {felder})"
        f" values (cast(:f as uuid), :e, {werte})",
        f=familie, e=MITARBEITER, **spalten,
    )


async def test_stufe_null_bis_drei_ist_erlaubt(stamm):
    await _bewerten(stamm["familie"], ist_stufe=0, soll_stufe=3)
    zeilen = await ausfuehren(
        "select ist_stufe, soll_stufe from public.kompetenz_bewertungen"
        " where employee_id = :e", e=MITARBEITER,
    )
    assert zeilen == [{"ist_stufe": 0, "soll_stufe": 3}]


async def test_stufe_ueber_drei_wird_abgewiesen(stamm):
    with pytest.raises((IntegrityError, DBAPIError)):
        await _bewerten(stamm["familie"], ist_stufe=4)


async def test_zelle_ohne_beide_stufen_wird_abgewiesen(stamm):
    with pytest.raises((IntegrityError, DBAPIError)):
        await ausfuehren(
            "insert into public.kompetenz_bewertungen (familie_id, employee_id)"
            " values (cast(:f as uuid), :e)", f=stamm["familie"], e=MITARBEITER,
        )


async def test_bereich_geloescht_nimmt_familie_und_bewertung_mit(stamm):
    await _bewerten(stamm["familie"], ist_stufe=2)
    await ausfuehren("delete from public.kompetenz_bereiche where name = 'Test 0067'")
    assert await ausfuehren(
        "select 1 from public.kompetenz_bewertungen where employee_id = :e", e=MITARBEITER
    ) == []
    assert await ausfuehren(
        "select 1 from public.kompetenz_familien where id = cast(:f as uuid)", f=stamm["familie"]
    ) == []


async def test_hr_sieht_den_bereich_andere_nicht(stamm):
    mit_hr = await als(claims({"hr": "viewer"}),
                       "select name from public.kompetenz_bereiche where name = 'Test 0067'")
    assert mit_hr == [{"name": "Test 0067"}]
    ohne_hr = await als(claims({"sales": "viewer"}),
                        "select name from public.kompetenz_bereiche where name = 'Test 0067'")
    assert ohne_hr == []


async def test_ohne_editor_kein_schreiben(stamm):
    with pytest.raises(DBAPIError):
        await als(
            claims({"hr": "viewer"}),
            "insert into public.kompetenz_bewertungen (familie_id, employee_id, ist_stufe)"
            " values (cast(:f as uuid), :e, 2)", f=stamm["familie"], e=MITARBEITER,
        )
