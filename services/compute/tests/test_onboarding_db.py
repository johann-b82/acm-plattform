"""Onboarding gegen eine echte Datenbank.

Der Schulungsplan ist hier kein Programm, sondern ein Verbund aus Matrix und
Bestand. Geprüft wird, dass jede der vier Geltungen greift — alle, Abteilung,
Position und die Kombination beider — und dass die übersteuerte Abteilung zählt.
"""
from __future__ import annotations

import pytest
import pytest_asyncio
import sqlalchemy as sa

from app.db import SessionLocal
from tests._auth import USER_ID

LESER = '{"sub":"%s","role":"authenticated","apps":{"hr":"viewer"}}' % USER_ID
PFLEGER = '{"sub":"%s","role":"authenticated","apps":{"hr":"editor"}}' % USER_ID

MITARBEITER = 990001


@pytest_asyncio.fixture
async def db(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")

    async def leeren():
        async with SessionLocal() as s:
            async with s.begin():
                await s.execute(sa.text("delete from public.schulung_teilnahmen"))
                await s.execute(sa.text("delete from public.schulung_pflicht"))
                await s.execute(sa.text("delete from public.schulung_katalog"))
                await s.execute(sa.text("delete from public.onboarding_abteilung"))
                await s.execute(sa.text("delete from public.onboarding_paket"))
                await s.execute(sa.text("delete from public.externe_personen"))
                await s.execute(
                    sa.text("delete from public.personio_employees where id = :i"),
                    {"i": MITARBEITER},
                )

    await leeren()
    async with SessionLocal() as s:
        async with s.begin():
            await s.execute(
                sa.text(
                    "insert into public.personio_employees"
                    " (id, first_name, last_name, department, status, hire_date,"
                    "  synced_at, raw_json)"
                    " values (:i, 'Dana', 'Neu', 'Production', 'active',"
                    " current_date - 5, now(),"
                    " '{\"attributes\":{\"position\":{\"value\":\"CNC  Fräser\"}}}'::jsonb)"
                ),
                {"i": MITARBEITER},
            )
            await s.execute(
                sa.text(
                    "insert into public.schulung_katalog (bereich, name, turnus)"
                    " values ('Produktion', 'Brandschutz', 'jährlich'),"
                    " ('Produktion', 'Gabelstapler', 'alle 2 Jahre')"
                )
            )
    yield
    await leeren()


async def sql(text: str, **params):
    async with SessionLocal() as s:
        async with s.begin():
            ergebnis = await s.execute(sa.text(text), params)
            return [dict(r) for r in ergebnis.mappings()] if ergebnis.returns_rows else []


async def als(claims: str, text: str, **params):
    async with SessionLocal() as s:
        trans = await s.begin()
        try:
            await s.execute(sa.text("set local role authenticated"))
            await s.execute(
                sa.text("select set_config('request.jwt.claims', :c, true)"), {"c": claims}
            )
            ergebnis = await s.execute(sa.text(text), params)
            return [dict(r) for r in ergebnis.mappings()] if ergebnis.returns_rows else []
        finally:
            await trans.rollback()


async def pflicht(
    name: str,
    geltung: str,
    abteilung: str | None = None,
    position: str | None = None,
):
    await sql(
        "insert into public.schulung_pflicht (schulung_id, geltung, abteilung, \"position\")"
        " select id, :g, :a, :p from public.schulung_katalog where name = :n",
        n=name,
        g=geltung,
        a=abteilung,
        p=position,
    )


async def plan():
    return await sql(
        "select quelle, name, vorhanden, abteilung from public.schulungsplan(:i)",
        i=MITARBEITER,
    )


class TestPositionNorm:
    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "roh, erwartet",
        [
            ("CNC  Fräser", "cnc fräser"),
            ("  cnc fräser ", "cnc fräser"),
            ("CNC\tFräser", "cnc fräser"),
            (None, ""),
        ],
    )
    async def test_normierung(self, db, roh, erwartet):
        """Personio schreibt Positionen uneinheitlich."""
        zeilen = await sql("select public.position_norm(:t) as n", t=roh)
        assert zeilen[0]["n"] == erwartet


class TestPlan:
    @pytest.mark.asyncio
    async def test_alle_gilt_fuer_jeden(self, db):
        await pflicht("Brandschutz", "alle")
        assert [(z["quelle"], z["name"]) for z in await plan()] == [
            ("alle", "Brandschutz")
        ]

    @pytest.mark.asyncio
    async def test_die_abteilung_greift(self, db):
        await pflicht("Brandschutz", "abteilung", abteilung="Production")
        assert [(z["quelle"], z["name"]) for z in await plan()] == [
            ("abteilung", "Brandschutz")
        ]

    @pytest.mark.asyncio
    async def test_die_position_greift_normiert(self, db):
        """Die Person steht als „CNC  Fräser" (Doppelleerzeichen) in Personio;
        die Pflicht auf „CNC Fräser" trifft sie über die normierte Fassung."""
        await pflicht("Gabelstapler", "position", position="CNC Fräser")
        zeilen = await plan()
        assert [(z["quelle"], z["name"]) for z in zeilen] == [("position", "Gabelstapler")]
        assert zeilen[0]["abteilung"] == "CNC Fräser"

    @pytest.mark.asyncio
    async def test_die_kombination_verlangt_beides(self, db):
        """Abteilung + Position greift nur, wenn beides zusammenpasst."""
        await pflicht(
            "Gabelstapler", "abteilung_position", abteilung="Montage", position="CNC Fräser"
        )
        assert await plan() == []
        await sql("delete from public.schulung_pflicht")
        await pflicht(
            "Gabelstapler", "abteilung_position", abteilung="Production", position="CNC Fräser"
        )
        assert [z["name"] for z in await plan()] == ["Gabelstapler"]

    @pytest.mark.asyncio
    async def test_die_uebersteuerte_abteilung_zaehlt(self, db):
        """Personio ist lesend; wer dort keine Abteilung hat, bekäme sonst
        keine Pflichtschulungen."""
        await pflicht("Brandschutz", "abteilung", abteilung="Montage")
        assert await plan() == []
        await sql(
            "insert into public.onboarding_abteilung (employee_id, abteilung)"
            " values (:i, 'Montage')",
            i=MITARBEITER,
        )
        assert [z["name"] for z in await plan()] == ["Brandschutz"]

    @pytest.mark.asyncio
    async def test_eine_stillgelegte_schulung_zaehlt_nicht(self, db):
        await pflicht("Brandschutz", "abteilung", abteilung="Production")
        await sql("update public.schulung_katalog set aktiv = false where name = 'Brandschutz'")
        assert await plan() == []

    @pytest.mark.asyncio
    async def test_vorhandenes_wird_als_vorhanden_gezeigt(self, db):
        await pflicht("Brandschutz", "abteilung", abteilung="Production")
        await sql(
            "insert into public.schulung_teilnahmen (schulung_id, employee_id)"
            " select id, :i from public.schulung_katalog where name = 'Brandschutz'",
            i=MITARBEITER,
        )
        assert (await plan())[0]["vorhanden"] is True


class TestPlanAnlegen:
    @pytest.mark.asyncio
    async def test_legt_die_fehlenden_an(self, db):
        await pflicht("Brandschutz", "abteilung", abteilung="Production")
        await pflicht("Gabelstapler", "abteilung", abteilung="Production")
        anzahl = (
            await als(PFLEGER, "select public.schulungsplan_anlegen(:i) as n", i=MITARBEITER)
        )[0]["n"]
        assert anzahl == 2

    @pytest.mark.asyncio
    async def test_ein_zweiter_lauf_legt_nichts_doppelt_an(self, db):
        await pflicht("Brandschutz", "abteilung", abteilung="Production")
        async with SessionLocal() as s:
            async with s.begin():
                await s.execute(sa.text("set local role authenticated"))
                await s.execute(
                    sa.text("select set_config('request.jwt.claims', :c, true)"),
                    {"c": PFLEGER},
                )
                erst = (
                    await s.execute(
                        sa.text("select public.schulungsplan_anlegen(:i) as n"),
                        {"i": MITARBEITER},
                    )
                ).scalar()
                zweit = (
                    await s.execute(
                        sa.text("select public.schulungsplan_anlegen(:i) as n"),
                        {"i": MITARBEITER},
                    )
                ).scalar()
        assert (erst, zweit) == (1, 0)

    @pytest.mark.asyncio
    async def test_ein_leser_darf_das_nicht(self, db):
        await pflicht("Brandschutz", "abteilung", abteilung="Production")
        with pytest.raises(Exception, match="fehlt das Recht"):
            await als(LESER, "select public.schulungsplan_anlegen(:i)", i=MITARBEITER)


class TestEintritte:
    @pytest.mark.asyncio
    async def test_personio_und_externe_stehen_in_einer_liste(self, db):
        await sql(
            "insert into public.externe_personen (name, abteilung, eintritt)"
            " values ('Erik Extern', 'Montage', current_date)"
        )
        zeilen = await als(LESER, "select name, extern_id from public.onboarding_eintritte")
        namen = sorted(z["name"] for z in zeilen)
        assert namen == ["Dana Neu", "Erik Extern"]
        assert sum(1 for z in zeilen if z["extern_id"] is not None) == 1

    @pytest.mark.asyncio
    async def test_die_uebergabe_wird_je_person_nur_einmal_vermerkt(self, db):
        await sql(
            "insert into public.onboarding_paket (employee_id) values (:i)", i=MITARBEITER
        )
        with pytest.raises(Exception, match="duplicate|unique|je_person"):
            await sql(
                "insert into public.onboarding_paket (employee_id) values (:i)", i=MITARBEITER
            )

    @pytest.mark.asyncio
    async def test_eine_uebergabe_haengt_an_genau_einer_person(self, db):
        with pytest.raises(Exception, match="eine_person"):
            await sql("insert into public.onboarding_paket (employee_id, extern_id)"
                      " values (:i, gen_random_uuid())", i=MITARBEITER)
