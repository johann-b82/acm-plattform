"""HR-Abgleich gegen eine echte Datenbank: Standort, Sammelabschluss, Aussteller.

Der Sammelabschluss ist der heikle Teil. Er schreibt für mehrere Personen auf
einmal, und die Abnahme verlangt drei Dinge ausdrücklich: nur die Gewählten,
keine doppelten Abschlüsse, nachvollziehbare Fehler.
"""
from __future__ import annotations

from datetime import date, timedelta

import pytest
import pytest_asyncio
import sqlalchemy as sa

from app.db import SessionLocal
from tests._auth import USER_ID

LESER = '{"sub":"%s","role":"authenticated","apps":{"hr":"viewer"}}' % USER_ID
PFLEGER = '{"sub":"%s","role":"authenticated","apps":{"hr":"editor"}}' % USER_ID

HAMBURG = 990201
MEMMINGEN = 990202
NEU = 990203

BUERO = '{"attributes":{"office":{"value":{"attributes":{"name":"%s"}}}}}'


@pytest_asyncio.fixture
async def db(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")

    async def leeren():
        async with SessionLocal() as s:
            async with s.begin():
                await s.execute(sa.text("delete from public.schulung_teilnahmen"))
                await s.execute(sa.text("delete from public.schulung_katalog"))
                await s.execute(sa.text("delete from public.externe_personen"))
                await s.execute(
                    sa.text("delete from public.personio_employees where id in (:a, :b, :c)"),
                    {"a": HAMBURG, "b": MEMMINGEN, "c": NEU},
                )

    await leeren()
    async with SessionLocal() as s:
        async with s.begin():
            await s.execute(
                sa.text(
                    "insert into public.personio_employees"
                    " (id, first_name, last_name, department, status, hire_date, raw_json, synced_at)"
                    " values (:a, 'Hanna', 'Hafen', 'Production', 'active', current_date - 400,"
                    "         cast(:ja as jsonb), now()),"
                    "        (:b, 'Max', 'Berg', 'Production', 'active', current_date - 400,"
                    "         cast(:jb as jsonb), now()),"
                    "        (:c, 'Nina', 'Neu', 'Production', 'onboarding', current_date + 10,"
                    "         cast(:jc as jsonb), now())"
                ),
                {
                    "a": HAMBURG, "b": MEMMINGEN, "c": NEU,
                    "ja": BUERO % "Hamburg", "jb": BUERO % "Memmingen", "jc": BUERO % "Hamburg",
                },
            )
            await s.execute(
                sa.text("insert into public.externe_personen (name, abteilung) values ('Leih, Lars', 'CUT')")
            )
            await s.execute(
                sa.text(
                    "insert into public.schulung_katalog (bereich, name, turnus, turnus_monate)"
                    " values ('betrieblich', 'Brandschutz', 'jährlich', 12)"
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
    """Als angemeldete Person ausführen und das Ergebnis behalten."""
    async with SessionLocal() as s:
        async with s.begin():
            await s.execute(sa.text("set local role authenticated"))
            await s.execute(
                sa.text("select set_config('request.jwt.claims', :c, true)"), {"c": claims}
            )
            ergebnis = await s.execute(sa.text(text), params)
            return [dict(r) for r in ergebnis.mappings()] if ergebnis.returns_rows else []


async def schulung_id() -> str:
    return (await sql("select id::text from public.schulung_katalog where name = 'Brandschutz'"))[0]["id"]


async def abschluss(personen: list[str], datum: date, claims: str = PFLEGER):
    return (
        await als(
            claims,
            "select * from public.schulung_sammelabschluss(cast(:s as uuid), :d, cast(:p as text[]))",
            s=await schulung_id(), d=datum, p=personen,
        )
    )[0]


async def teilnahmen():
    return await sql(
        "select employee_id, extern_id, mitarbeiter_name, initial_datum, aktuell_datum"
        " from public.schulung_teilnahmen order by mitarbeiter_name"
    )


class TestStandort:
    @pytest.mark.asyncio
    async def test_die_belegschaft_nennt_den_standort(self, db):
        zeilen = await sql(
            "select schluessel, standort from public.schulung_belegschaft order by schluessel"
        )
        nach = {z["schluessel"]: z["standort"] for z in zeilen}
        assert nach[f"e:{HAMBURG}"] == "Hamburg"
        assert nach[f"e:{MEMMINGEN}"] == "Memmingen"
        # Wer gerade eintritt, gehört zur Belegschaft und hat einen Standort.
        assert nach[f"e:{NEU}"] == "Hamburg"
        extern = [z for z in zeilen if z["schluessel"].startswith("x:")]
        assert extern and extern[0]["standort"] is None


class TestSammelabschluss:
    @pytest.mark.asyncio
    async def test_nur_die_gewaehlten_bekommen_den_termin(self, db):
        tag = date.today() - timedelta(days=3)
        ergebnis = await abschluss([f"e:{HAMBURG}", f"e:{NEU}"], tag)
        assert ergebnis == {"eingetragen": 2, "unveraendert": 0}
        zeilen = await teilnahmen()
        assert {z["employee_id"] for z in zeilen} == {HAMBURG, NEU}
        assert all(z["aktuell_datum"] == tag and z["initial_datum"] == tag for z in zeilen)
        assert {z["mitarbeiter_name"] for z in zeilen} == {"Hanna Hafen", "Nina Neu"}

    @pytest.mark.asyncio
    async def test_wiederholtes_absenden_legt_nichts_doppelt_an(self, db):
        tag = date.today() - timedelta(days=3)
        await abschluss([f"e:{HAMBURG}"], tag)
        zweites = await abschluss([f"e:{HAMBURG}", f"e:{HAMBURG}"], tag)
        assert zweites == {"eingetragen": 0, "unveraendert": 1}
        assert len(await teilnahmen()) == 1

    @pytest.mark.asyncio
    async def test_ein_offener_eintrag_wird_abgeschlossen_nicht_verdoppelt(self, db):
        await sql(
            "insert into public.schulung_teilnahmen (schulung_id, employee_id, mitarbeiter_name)"
            " select id, :e, 'Max Berg' from public.schulung_katalog",
            e=MEMMINGEN,
        )
        tag = date.today() - timedelta(days=1)
        assert await abschluss([f"e:{MEMMINGEN}"], tag) == {"eingetragen": 1, "unveraendert": 0}
        zeilen = await teilnahmen()
        assert len(zeilen) == 1 and zeilen[0]["aktuell_datum"] == tag

    @pytest.mark.asyncio
    async def test_ein_aelterer_termin_ueberschreibt_keinen_juengeren(self, db):
        juenger = date.today() - timedelta(days=2)
        aelter = date.today() - timedelta(days=200)
        await abschluss([f"e:{HAMBURG}"], juenger)
        assert await abschluss([f"e:{HAMBURG}"], aelter) == {"eingetragen": 0, "unveraendert": 1}
        assert (await teilnahmen())[0]["aktuell_datum"] == juenger

    @pytest.mark.asyncio
    async def test_ein_neuer_termin_behaelt_die_erstschulung(self, db):
        erst = date.today() - timedelta(days=400)
        await abschluss([f"e:{HAMBURG}"], erst)
        heute = date.today()
        assert await abschluss([f"e:{HAMBURG}"], heute) == {"eingetragen": 1, "unveraendert": 0}
        zeile = (await teilnahmen())[0]
        assert zeile["initial_datum"] == erst and zeile["aktuell_datum"] == heute

    @pytest.mark.asyncio
    async def test_extern_gepflegte_personen_gehen_auch(self, db):
        extern = (await sql("select id::text from public.externe_personen"))[0]["id"]
        assert await abschluss([f"x:{extern}"], date.today()) == {"eingetragen": 1, "unveraendert": 0}
        assert (await teilnahmen())[0]["mitarbeiter_name"] == "Leih, Lars"

    @pytest.mark.asyncio
    async def test_eine_unbekannte_person_bricht_alles_ab(self, db):
        with pytest.raises(Exception, match="Unbekannte Person"):
            await abschluss([f"e:{HAMBURG}", "e:1"], date.today())
        assert await teilnahmen() == []

    @pytest.mark.asyncio
    async def test_kein_termin_in_der_zukunft(self, db):
        with pytest.raises(Exception, match="Zukunft"):
            await abschluss([f"e:{HAMBURG}"], date.today() + timedelta(days=1))
        assert await teilnahmen() == []

    @pytest.mark.asyncio
    async def test_ohne_teilnehmer_keine_aktion(self, db):
        with pytest.raises(Exception, match="Keine Teilnehmer"):
            await abschluss([], date.today())

    @pytest.mark.asyncio
    async def test_ein_leser_kann_nichts_eintragen(self, db):
        with pytest.raises(Exception, match="row-level security"):
            await abschluss([f"e:{HAMBURG}"], date.today(), claims=LESER)
        assert await teilnahmen() == []


class TestAussteller:
    @pytest.mark.asyncio
    async def test_die_zeile_gibt_es(self, db):
        assert len(await sql("select id from public.zeugnis_aussteller")) == 1

    @pytest.mark.asyncio
    async def test_fehlt_die_zeile_legt_die_pflege_sie_an(self, db):
        vorher = await sql("select * from public.zeugnis_aussteller")
        await sql("delete from public.zeugnis_aussteller")
        try:
            await als(
                PFLEGER,
                "insert into public.zeugnis_aussteller (id, firma) values (true, 'ACM GmbH')"
                " on conflict (id) do update set firma = excluded.firma",
            )
            assert (await sql("select firma from public.zeugnis_aussteller"))[0]["firma"] == "ACM GmbH"
        finally:
            await sql("delete from public.zeugnis_aussteller")
            await sql("insert into public.zeugnis_aussteller (id) values (true)")
            if vorher:
                await sql(
                    "update public.zeugnis_aussteller set firma = :f", f=vorher[0]["firma"]
                )

    @pytest.mark.asyncio
    async def test_ein_leser_legt_sie_nicht_an(self, db):
        await sql("delete from public.zeugnis_aussteller")
        try:
            with pytest.raises(Exception):
                await als(LESER, "insert into public.zeugnis_aussteller (id, firma) values (true, 'X')")
        finally:
            await sql("insert into public.zeugnis_aussteller (id) values (true) on conflict do nothing")
