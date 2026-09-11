"""Die Schulungsmatrix gegen eine echte Datenbank.

Zwei Sichten tragen sie: `schulung_belegschaft` sagt, wer eine Zeile bekommt,
`schulung_stand` was in den Zellen steht. Geprüft wird vor allem das, was die
Liste „was offen ist" nicht zeigt — **die leere Zeile**. Jemand ohne jede
Teilnahme ist genau der Fall, den ein Audit sucht.
"""
from __future__ import annotations

from datetime import date

import pytest
import pytest_asyncio
import sqlalchemy as sa

from app.db import SessionLocal
from tests._auth import USER_ID

LESER = '{"sub":"%s","role":"authenticated","apps":{"hr":"viewer"}}' % USER_ID
FREMD = '{"sub":"%s","role":"authenticated","apps":{"sales":"viewer"}}' % USER_ID

AKTIV = 990101
AUSGETRETEN = 990102


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
                    sa.text("delete from public.personio_employees where id in (:a, :b)"),
                    {"a": AKTIV, "b": AUSGETRETEN},
                )

    await leeren()
    async with SessionLocal() as s:
        async with s.begin():
            await s.execute(
                sa.text(
                    "insert into public.personio_employees"
                    " (id, first_name, last_name, department, status, hire_date, synced_at)"
                    " values (:a, 'Dana', 'Neu', 'Production', 'active',"
                    "         current_date - 30, now()),"
                    "        (:b, 'Ruth', 'Weg', 'Production', 'inactive',"
                    "         current_date - 900, now())"
                ),
                {"a": AKTIV, "b": AUSGETRETEN},
            )
            await s.execute(
                sa.text(
                    "insert into public.externe_personen (name, abteilung)"
                    " values ('Leih, Lars', 'CUT')"
                )
            )
            await s.execute(
                sa.text(
                    "insert into public.schulung_katalog (bereich, name, turnus, turnus_monate)"
                    " values ('Produktion', 'Brandschutz', 'jährlich', 12),"
                    "        ('Produktion', 'Gabelstapler', 'bei Bedarf', null)"
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


async def teilnahme(schulung: str, *, employee_id=None, extern=None, persnr=None,
                    name=None, kuerzel=None, datum=None):
    await sql(
        "insert into public.schulung_teilnahmen"
        " (schulung_id, employee_id, extern_id, personalnummer, mitarbeiter_name,"
        "  abteilung_kuerzel, aktuell_datum)"
        " select id, :e, (select id from public.externe_personen where name = :x),"
        "        :p, :n, :k, :d"
        " from public.schulung_katalog where name = :s",
        s=schulung, e=employee_id, x=extern, p=persnr, n=name, k=kuerzel, d=datum,
    )


async def belegschaft():
    return await sql("select * from public.schulung_belegschaft order by schluessel")


class TestWerEineZeileBekommt:
    @pytest.mark.asyncio
    async def test_aktive_externe_und_reste(self, db):
        await teilnahme("Brandschutz", persnr="101", name="Meier, Anna", kuerzel="NÄH")
        zeilen = await belegschaft()
        nach_art = {z["herkunft"]: z for z in zeilen}
        assert set(nach_art) == {"personio", "extern", "ohne_zuordnung"}
        assert nach_art["personio"]["schluessel"] == f"e:{AKTIV}"
        assert nach_art["personio"]["name"] == "Dana Neu"
        assert nach_art["extern"]["name"] == "Leih, Lars"
        assert nach_art["ohne_zuordnung"]["schluessel"] == "p:101"
        assert nach_art["ohne_zuordnung"]["name"] == "Meier, Anna"

    @pytest.mark.asyncio
    async def test_ausgetretene_stehen_nicht_darin(self, db):
        """Ihre Historie bleibt — aber „wer ist geschult" meint die Belegschaft."""
        schluessel = {z["schluessel"] for z in await belegschaft()}
        assert f"e:{AKTIV}" in schluessel
        assert f"e:{AUSGETRETEN}" not in schluessel

    @pytest.mark.asyncio
    async def test_wer_nichts_hat_steht_trotzdem_da(self, db):
        """Der Kern der Matrix: die leere Zeile ist das Ergebnis, nicht die Lücke."""
        zeilen = await belegschaft()
        assert any(z["schluessel"] == f"e:{AKTIV}" for z in zeilen)
        assert await sql("select 1 from public.schulung_stand") == []

    @pytest.mark.asyncio
    async def test_eine_zeile_je_personalnummer(self, db):
        """Mehrere Teilnahmen derselben Nummer sind eine Person, nicht drei."""
        await teilnahme("Brandschutz", persnr="101", name="Meier, Anna", kuerzel="NÄH")
        await teilnahme("Gabelstapler", persnr="101", name="Meier, Anna", kuerzel="NÄH")
        reste = [z for z in await belegschaft() if z["herkunft"] == "ohne_zuordnung"]
        assert len(reste) == 1


class TestZellen:
    @pytest.mark.asyncio
    async def test_schluessel_passt_zur_zeile(self, db):
        """Ohne das fänden Zeile und Zelle in der Oberfläche nicht zusammen."""
        await teilnahme("Brandschutz", employee_id=AKTIV, datum=date(2026, 1, 15))
        await teilnahme("Gabelstapler", extern="Leih, Lars")
        stand = {z["schluessel"]: z for z in await sql("select * from public.schulung_stand")}
        zeilen = {z["schluessel"] for z in await belegschaft()}
        assert set(stand) <= zeilen
        assert stand[f"e:{AKTIV}"]["schulung"] == "Brandschutz"
        assert stand[f"e:{AKTIV}"]["nie_absolviert"] is False

    @pytest.mark.asyncio
    async def test_zugewiesen_aber_nie_absolviert(self, db):
        await teilnahme("Brandschutz", employee_id=AKTIV)
        zelle = (await sql("select * from public.schulung_stand"))[0]
        assert zelle["nie_absolviert"] is True
        assert zelle["aktuell_datum"] is None
        assert zelle["faellig_am"] is None

    @pytest.mark.asyncio
    async def test_ueberfaellig_wird_gerechnet_nicht_gespeichert(self, db):
        await teilnahme("Brandschutz", employee_id=AKTIV, datum=date(2020, 1, 1))
        zelle = (await sql("select * from public.schulung_stand"))[0]
        assert zelle["ueberfaellig"] is True
        assert str(zelle["faellig_am"]) == "2021-01-01"

    @pytest.mark.asyncio
    async def test_ohne_turnus_keine_faelligkeit(self, db):
        """„bei Bedarf" ist kein Turnus — geraten wird nicht."""
        await teilnahme("Gabelstapler", employee_id=AKTIV, datum=date(2020, 1, 1))
        zelle = (await sql("select * from public.schulung_stand"))[0]
        assert zelle["faellig_am"] is None
        assert zelle["ueberfaellig"] is False


class TestRechte:
    @pytest.mark.asyncio
    async def test_ohne_hr_kein_blick(self, db):
        """Die Sichten laufen mit `security_invoker` — die Policies greifen."""
        await teilnahme("Brandschutz", employee_id=AKTIV, datum=date(2026, 1, 15))
        assert await als(FREMD, "select * from public.schulung_belegschaft") == []
        assert await als(FREMD, "select * from public.schulung_stand") == []

    @pytest.mark.asyncio
    async def test_mit_hr_viewer_lesbar(self, db):
        await teilnahme("Brandschutz", employee_id=AKTIV, datum=date(2026, 1, 15))
        assert len(await als(LESER, "select * from public.schulung_belegschaft")) >= 2
        assert len(await als(LESER, "select * from public.schulung_stand")) == 1
