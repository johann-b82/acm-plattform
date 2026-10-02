"""Migration 0069 gegen eine echte Datenbank.

Das wirksame Soll (Ziel vor Positionsprofil vor Bereichsprofil), das Ist ohne
Bewertung als 0, der heutige Bereich als Rückfall ohne Einsatzplanung, und die
Abdeckung samt Warnungen.
"""
from __future__ import annotations

import json

import pytest
import pytest_asyncio
import sqlalchemy as sa

from app.db import SessionLocal

pytestmark = pytest.mark.asyncio

ABT = "SollAbt 0069"
E_MAIN = 969101
E_NEU = 969102
E_A, E_B, E_C = 969103, 969104, 969105
ALLE = (E_MAIN, E_NEU, E_A, E_B, E_C)


async def ausfuehren(sql: str, **params):
    async with SessionLocal() as s:
        async with s.begin():
            ergebnis = await s.execute(sa.text(sql), params)
            return [dict(r) for r in ergebnis.mappings()] if ergebnis.returns_rows else []


async def _mitarbeiter(mid: int, position: str | None) -> None:
    roh = {"attributes": {}}
    if position:
        roh["attributes"]["position"] = {"value": position}
    await ausfuehren(
        "insert into public.personio_employees (id, first_name, last_name, department, status, raw_json, synced_at)"
        " values (:m, 'Test', 'Person', :d, 'active', cast(:r as jsonb), now())",
        m=mid, d=ABT, r=json.dumps(roh),
    )


async def _soll_ist(mid: int, familie: str):
    zeilen = await ausfuehren(
        "select si.ist, si.soll, si.luecke from public.kompetenz_soll_ist si"
        " join public.kompetenz_familien f on f.id = si.familie_id"
        " where si.employee_id = :m and f.name = :f", m=mid, f=familie,
    )
    return zeilen[0] if zeilen else None


@pytest_asyncio.fixture
async def stamm(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")

    async def aufraeumen():
        for mid in ALLE:
            await ausfuehren("delete from public.personio_employees where id = :m", m=mid)
        await ausfuehren("delete from public.bereich_zuordnung where abteilung = :a", a=ABT)
        await ausfuehren("delete from public.kompetenz_bereiche where name = 'Test 0069'")

    await aufraeumen()
    bereich = (await ausfuehren(
        "insert into public.kompetenz_bereiche (name, reihenfolge) values ('Test 0069', 0) returning id::text"
    ))[0]["id"]
    f_naehen = (await ausfuehren(
        "insert into public.kompetenz_familien (bereich_id, name, reihenfolge, mindest_l2, mindest_l3)"
        " values (cast(:b as uuid), 'Nähen', 1, 0, 0) returning id::text", b=bereich,
    ))[0]["id"]
    f_kleben = (await ausfuehren(
        "insert into public.kompetenz_familien (bereich_id, name, reihenfolge, mindest_l2, mindest_l3)"
        " values (cast(:b as uuid), 'Kleben', 2, 2, 1) returning id::text", b=bereich,
    ))[0]["id"]
    await ausfuehren(
        "insert into public.bereich_zuordnung (abteilung, team, bereich_id)"
        " values (:a, null, cast(:b as uuid))", a=ABT, b=bereich,
    )
    await _mitarbeiter(E_MAIN, "Näher")
    await _mitarbeiter(E_NEU, None)
    for mid in (E_A, E_B, E_C):
        await _mitarbeiter(mid, None)
    await ausfuehren(
        "insert into public.kompetenz_einsatz (employee_id, bereich_id, art)"
        " values (:m, cast(:b as uuid), 'haupt')", m=E_MAIN, b=bereich,
    )
    yield {"bereich": bereich, "naehen": f_naehen, "kleben": f_kleben}
    await aufraeumen()


async def test_ziel_schlaegt_positions_und_bereichsprofil(stamm):
    # Bereichsprofil 1, Positionsprofil (näher) 2, persönliches Ziel 3.
    await ausfuehren(
        "insert into public.kompetenz_profil (familie_id, position_norm, soll_stufe)"
        " values (cast(:f as uuid), null, 1)", f=stamm["naehen"],
    )
    await ausfuehren(
        "insert into public.kompetenz_profil (familie_id, position_norm, soll_stufe)"
        " values (cast(:f as uuid), 'näher', 2)", f=stamm["naehen"],
    )
    await ausfuehren(
        "insert into public.kompetenz_bewertungen (familie_id, employee_id, ist_stufe, soll_stufe)"
        " values (cast(:f as uuid), :m, 0, 3)", f=stamm["naehen"], m=E_MAIN,
    )
    assert (await _soll_ist(E_MAIN, "Nähen"))["soll"] == 3


async def test_positionsprofil_schlaegt_bereichsprofil(stamm):
    await ausfuehren(
        "insert into public.kompetenz_profil (familie_id, position_norm, soll_stufe)"
        " values (cast(:f as uuid), null, 1)", f=stamm["naehen"],
    )
    await ausfuehren(
        "insert into public.kompetenz_profil (familie_id, position_norm, soll_stufe)"
        " values (cast(:f as uuid), 'näher', 2)", f=stamm["naehen"],
    )
    z = await _soll_ist(E_MAIN, "Nähen")
    assert (z["ist"], z["soll"], z["luecke"]) == (0, 2, 2)


async def test_bereichsprofil_wenn_keine_position_passt(stamm):
    await ausfuehren(
        "insert into public.kompetenz_profil (familie_id, position_norm, soll_stufe)"
        " values (cast(:f as uuid), null, 1)", f=stamm["naehen"],
    )
    assert (await _soll_ist(E_MAIN, "Nähen"))["soll"] == 1


async def test_neueintritt_ohne_einsatz_nutzt_heutigen_bereich(stamm):
    # E_NEU hat keine Einsatzplanung, aber die Abteilung mappt auf den Bereich.
    await ausfuehren(
        "insert into public.kompetenz_profil (familie_id, position_norm, soll_stufe)"
        " values (cast(:f as uuid), null, 2)", f=stamm["naehen"],
    )
    z = await _soll_ist(E_NEU, "Nähen")
    assert (z["ist"], z["soll"], z["luecke"]) == (0, 2, 2)


async def test_abdeckung_zaehlt_und_warnt(stamm):
    async def abdeckung():
        return (await ausfuehren(
            "select koennen_l2, koennen_l3, kein_anlerner, haengt_an_einer_person"
            " from public.kompetenz_abdeckung f"
            " join public.kompetenz_familien k on k.id = f.familie_id"
            " where k.name = 'Kleben'"
        ))[0]

    # Nur eine Person mit Stufe 1 → niemand kann anlernen, hängt an keiner
    # (0 mit L2+).
    await ausfuehren(
        "insert into public.kompetenz_bewertungen (familie_id, employee_id, ist_stufe)"
        " values (cast(:f as uuid), :m, 1)", f=stamm["kleben"], m=E_C,
    )
    z = await abdeckung()
    assert (z["koennen_l2"], z["koennen_l3"], z["kein_anlerner"]) == (0, 0, True)

    # Dazu eine mit Stufe 3 → ein Anlerner, aber hängt an einer Person (1 L2+).
    await ausfuehren(
        "insert into public.kompetenz_bewertungen (familie_id, employee_id, ist_stufe)"
        " values (cast(:f as uuid), :m, 3)", f=stamm["kleben"], m=E_A,
    )
    z = await abdeckung()
    assert (z["koennen_l2"], z["koennen_l3"], z["kein_anlerner"], z["haengt_an_einer_person"]) == (1, 1, False, True)

    # Dazu eine mit Stufe 2 → zwei mit L2+, hängt nicht mehr an einer Person.
    await ausfuehren(
        "insert into public.kompetenz_bewertungen (familie_id, employee_id, ist_stufe)"
        " values (cast(:f as uuid), :m, 2)", f=stamm["kleben"], m=E_B,
    )
    z = await abdeckung()
    assert (z["koennen_l2"], z["haengt_an_einer_person"]) == (2, False)
