"""Die Interview-Übernahme gegen eine echte Datenbank.

Bereich und Familien entstehen, das Ist und die Interviewfelder werden je
zugeordneter Person geschrieben, ein Name ohne Personio-Treffer bleibt offen,
und ein zweiter Lauf legt nichts doppelt an.
"""
from __future__ import annotations

from datetime import date

import pytest
import pytest_asyncio
import sqlalchemy as sa

from app.db import SessionLocal
from app.kompetenzen import interview
from app.parsing.interview import Blatt, Datei, Familie, Person

pytestmark = pytest.mark.asyncio

BEREICH = "Test 0067D"
E_ANNA = 970101
E_VERA = 970102
ALLE = (E_ANNA, E_VERA)


async def ausfuehren(sql: str, **params):
    async with SessionLocal() as s:
        async with s.begin():
            ergebnis = await s.execute(sa.text(sql), params)
            return [dict(r) for r in ergebnis.mappings()] if ergebnis.returns_rows else []


def _datei() -> Datei:
    return Datei(
        dateiname="interview.xlsx",
        blaetter=[
            Blatt(
                bereich=BEREICH,
                familien=[
                    Familie("Nähen", "Nähen Stoff/Leder"),
                    Familie("Kleben", "Primer"),
                ],
                personen=[
                    Person(
                        name="Anna Meier", team="Sewing", produkte="MSN",
                        weitere_bereiche="Zuschnitt", engpass="Zeit",
                        validiert_durch="Vera", validiert_am=date(2026, 9, 18),
                        notiz="ok", stufen={"Nähen": 2, "Kleben": 1},
                    ),
                    Person(
                        name="Niemand Fremd", team=None, produkte=None,
                        weitere_bereiche=None, engpass=None, validiert_durch=None,
                        validiert_am=None, notiz=None, stufen={"Nähen": 3},
                    ),
                ],
            )
        ],
    )


@pytest_asyncio.fixture
async def stamm(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")

    async def aufraeumen():
        await ausfuehren("delete from public.kompetenz_bereiche where name = :n", n=BEREICH)
        for mid in ALLE:
            await ausfuehren("delete from public.personio_employees where id = :m", m=mid)

    await aufraeumen()
    await ausfuehren(
        "insert into public.personio_employees (id, first_name, last_name, status, synced_at)"
        " values (:m, 'Anna', 'Meier', 'active', now())", m=E_ANNA,
    )
    await ausfuehren(
        "insert into public.personio_employees (id, first_name, last_name, status, synced_at)"
        " values (:m, 'Vera', 'Andreeva', 'active', now())", m=E_VERA,
    )
    yield
    await aufraeumen()


async def test_uebernahme_legt_an_und_ordnet_zu(stamm):
    ergebnis = await interview.uebernehmen(_datei())
    blatt = ergebnis.blaetter[0]
    assert blatt.bereich == BEREICH
    assert blatt.bereich_neu is True
    assert blatt.zugeordnet == 1
    assert blatt.nicht_zugeordnet == ["Niemand Fremd"]

    familien = await ausfuehren(
        "select f.name from public.kompetenz_familien f"
        " join public.kompetenz_bereiche b on b.id = f.bereich_id"
        " where b.name = :n order by f.reihenfolge", n=BEREICH,
    )
    assert [f["name"] for f in familien] == ["Nähen", "Kleben"]

    bewertungen = await ausfuehren(
        "select f.name, w.ist_stufe from public.kompetenz_bewertungen w"
        " join public.kompetenz_familien f on f.id = w.familie_id"
        " where w.employee_id = :e order by f.reihenfolge", e=E_ANNA,
    )
    assert [(b["name"], b["ist_stufe"]) for b in bewertungen] == [("Nähen", 2), ("Kleben", 1)]

    iv = await ausfuehren(
        "select produkte, validiert_durch, validiert_am from public.kompetenz_interview"
        " where employee_id = :e", e=E_ANNA,
    )
    assert iv[0]["produkte"] == "MSN"
    assert iv[0]["validiert_am"] == date(2026, 9, 18)


async def test_unzugeordnete_person_wird_nicht_geschrieben(stamm):
    await interview.uebernehmen(_datei())
    # „Niemand Fremd" hat keine Personio-Zeile → keine Bewertung.
    alle = await ausfuehren(
        "select count(*) as n from public.kompetenz_bewertungen w"
        " join public.kompetenz_familien f on f.id = w.familie_id"
        " join public.kompetenz_bereiche b on b.id = f.bereich_id"
        " where b.name = :n", n=BEREICH,
    )
    # Nur Anna, zwei Familien.
    assert alle[0]["n"] == 2


async def test_zweiter_lauf_legt_nichts_doppelt_an(stamm):
    await interview.uebernehmen(_datei())
    zweit = await interview.uebernehmen(_datei())
    assert zweit.blaetter[0].bereich_neu is False

    bereiche = await ausfuehren(
        "select count(*) as n from public.kompetenz_bereiche where name = :n", n=BEREICH
    )
    assert bereiche[0]["n"] == 1
    familien = await ausfuehren(
        "select count(*) as n from public.kompetenz_familien f"
        " join public.kompetenz_bereiche b on b.id = f.bereich_id where b.name = :n", n=BEREICH,
    )
    assert familien[0]["n"] == 2
