"""Wochenbericht gegen eine echte Datenbank.

Jede Zahl ist von Hand nachgerechnet. Das Arbeitszeitmodell ist das, das auf
dem Produktionssystem vorkommt: Mo–Do 8:45, Fr 5:00, Wochenende 0 — zusammen
40 Stunden, aber nicht fünf gleiche Tage. Genau daran scheitert jede Rechnung,
die von einem Achtstundentag ausgeht.

Testwoche ist die ISO-Woche 37 des Jahres 2026: Montag 7. bis Sonntag
13. September.
"""
from __future__ import annotations

from datetime import date, datetime, time as uhrzeit, timedelta, timezone
from decimal import Decimal

import pytest
import pytest_asyncio
import sqlalchemy as sa

from app.db import SessionLocal, personio_absences, personio_attendance, personio_employees
from tests._auth import USER_ID

MO, DI, MI, DO, FR, SA, SO = (date(2026, 9, tag) for tag in range(7, 14))

MODELL = {
    "attributes": {
        "work_schedule": {"value": {"attributes": {
            "monday": "08:45", "tuesday": "08:45", "wednesday": "08:45",
            "thursday": "08:45", "friday": "05:00",
            "saturday": "00:00", "sunday": "00:00"}}}
    }
}

CLAIMS_ADMIN = '{"sub":"%s","role":"authenticated","apps":{"hr":"admin"}}' % USER_ID
CLAIMS_VIEWER = '{"sub":"%s","role":"authenticated","apps":{"hr":"viewer"}}' % USER_ID


@pytest_asyncio.fixture
async def db(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")

    async def leeren():
        async with SessionLocal() as s:
            async with s.begin():
                await s.execute(sa.delete(personio_attendance))
                await s.execute(sa.delete(personio_absences))
                await s.execute(sa.delete(personio_employees))
                await s.execute(sa.text("update public.hr_einstellungen set werte = '{}'"))

    await leeren()
    yield
    await leeren()


async def person(pid: int, vorname="Anna", nachname="Berger", raw=None) -> None:
    async with SessionLocal() as s:
        async with s.begin():
            await s.execute(sa.insert(personio_employees).values(
                id=pid, first_name=vorname, last_name=nachname, department="Fertigung",
                status="active", hire_date=date(2020, 1, 1), termination_date=None,
                weekly_working_hours="40.00", raw_json=raw or MODELL,
                synced_at=datetime.now(timezone.utc),
            ))


async def stempel(pid: int, tag: date, stunden: float, teil: int = 0) -> None:
    ende = 8 + stunden
    async with SessionLocal() as s:
        async with s.begin():
            await s.execute(sa.insert(personio_attendance).values(
                id=f"{pid}-{tag}-{teil}", employee_id=pid, datum=tag,
                start_time=uhrzeit(8, 0),
                end_time=uhrzeit(int(ende), round((ende % 1) * 60)),
                break_minutes=0, synced_at=datetime.now(timezone.utc),
            ))


async def abwesend(pid: int, von: date, bis: date, stunden: float, *,
                   typ: int = 568234, kennung="a", tage: float | None = None) -> None:
    roh = {"attributes": {"days_count": tage}} if tage is not None else {}
    async with SessionLocal() as s:
        async with s.begin():
            await s.execute(sa.insert(personio_absences).values(
                id=kennung, employee_id=pid, absence_type_id=typ,
                start_date=von, end_date=bis, time_unit="day", hours=stunden,
                raw_json=roh, synced_at=datetime.now(timezone.utc),
            ))


async def bericht(jahr=2026, woche=37, claims=CLAIMS_ADMIN) -> list[dict]:
    async with SessionLocal() as s:
        trans = await s.begin()
        try:
            await s.execute(sa.text("set local role authenticated"))
            await s.execute(
                sa.text("select set_config('request.jwt.claims', :c, true)"), {"c": claims}
            )
            rows = await s.execute(
                sa.text("select * from public.kpi_hr_wochenbericht(:j, :w)"),
                {"j": jahr, "w": woche},
            )
            return [dict(r) for r in rows.mappings()]
        finally:
            await trans.rollback()


async def volle_woche(pid: int, ausser: set[date] | None = None) -> None:
    """Jeden Solltag genau nach Plan stempeln."""
    for tag, soll in ((MO, 8.75), (DI, 8.75), (MI, 8.75), (DO, 8.75), (FR, 5.0)):
        if ausser and tag in ausser:
            continue
        await stempel(pid, tag, soll)


class TestWochengrenzen:
    async def test_iso_woche_37_2026(self, db):
        async with SessionLocal() as s:
            zeile = (await s.execute(
                sa.text("select * from public.hr_wochengrenzen(2026, 37)")
            )).mappings().one()
        assert zeile["montag"] == MO
        assert zeile["sonntag"] == SO

    async def test_woche_1_beginnt_im_vorjahr(self, db):
        """Der 4. Januar liegt immer in ISO-Woche 1 — 2026 heißt das:
        Montag ist der 29. Dezember 2025."""
        async with SessionLocal() as s:
            zeile = (await s.execute(
                sa.text("select * from public.hr_wochengrenzen(2026, 1)")
            )).mappings().one()
        assert zeile["montag"] == date(2025, 12, 29)


class TestSaldo:
    async def test_woche_nach_plan_ergibt_null(self, db):
        await person(1)
        await volle_woche(1)
        z = (await bericht())[0]
        assert z["ist_stunden"] == Decimal("40.00")
        assert z["soll_stunden"] == Decimal("40.00")
        assert z["netto"] == Decimal("0.00")

    async def test_zwei_segmente_am_tag_werden_summiert(self, db):
        await person(1)
        await stempel(1, MO, 4.0, teil=0)
        await stempel(1, MO, 6.0, teil=1)
        z = (await bericht())[0]
        assert z["ist_stunden"] == Decimal("10.00")

    async def test_eine_stunde_mehr_am_montag(self, db):
        await person(1)
        await volle_woche(1)
        await stempel(1, MO, 1.0, teil=9)
        z = (await bericht())[0]
        assert z["netto"] == Decimal("1.00")

    async def test_unentschuldigt_fehlender_tag_ist_eine_fehlstunde(self, db):
        """Abgeschlossene Woche: der fehlende Mittwoch kostet sein Tagessoll."""
        await person(1)
        await volle_woche(1, ausser={MI})
        # Damit die Woche als abgeschlossen gilt, muss es spaeter Daten geben.
        await person(2, vorname="Spaet")
        await stempel(2, SO + timedelta(days=3), 8.0)
        z = next(r for r in await bericht() if r["employee_id"] == 1)
        assert z["ist_stunden"] == Decimal("31.25")     # 40 − 8,75
        assert z["soll_stunden"] == Decimal("40.00")
        assert z["netto"] == Decimal("-8.75")

    async def test_laufende_woche_kappt_das_soll(self, db):
        """Solange die Woche die letzte mit Daten ist, gelten spätere Tage als
        noch nicht erfasst — nicht als Fehlstunde."""
        await person(1)
        await stempel(1, MO, 8.75)
        await stempel(1, DI, 8.75)
        z = (await bericht())[0]
        assert z["ist_stunden"] == Decimal("17.50")
        assert z["soll_stunden"] == Decimal("17.50")   # nur Mo und Di
        assert z["netto"] == Decimal("0.00")

    async def test_samstagsarbeit_ist_ganz_saldo(self, db):
        await person(1)
        await volle_woche(1)
        await stempel(1, SA, 4.0)
        z = (await bericht())[0]
        assert z["netto"] == Decimal("4.00")

    async def test_ohne_stempelung_taucht_niemand_auf(self, db):
        await person(1)
        await abwesend(1, MO, FR, 40.0)
        assert await bericht() == []


class TestEntschuldigt:
    async def test_urlaub_entschuldigt_den_tag_vollstaendig(self, db):
        await person(1)
        await volle_woche(1, ausser={MI})
        # Personio liefert zu einem Urlaubstag genau das Tagessoll.
        await abwesend(1, MI, MI, 8.75, typ=111111)
        z = (await bericht())[0]
        assert z["ist_stunden"] == Decimal("31.25")
        assert z["soll_stunden"] == Decimal("31.25")   # Mittwoch faellt heraus
        assert z["netto"] == Decimal("0.00")

    async def test_halber_tag_entschuldigt_halb(self, db):
        """Der Freitag, weil sein Soll von 5 h eine Hälfte auf volle Minuten
        hat. Ein halber Donnerstag wären 4 h 22,5 min — die passen weder in
        eine Uhrzeit noch in die zweistellige Stundenspalte."""
        await person(1)
        for tag in (MO, DI, MI, DO):
            await stempel(1, tag, 8.75)
        await stempel(1, FR, 2.5)                    # halber Freitag gearbeitet
        await abwesend(1, FR, FR, 2.5, typ=111111)   # halber entschuldigt
        z = (await bericht())[0]
        assert z["ist_stunden"] == Decimal("37.50")  # 35 + 2,5
        assert z["soll_stunden"] == Decimal("37.50") # 35 + (5 − 2,5)
        assert z["netto"] == Decimal("0.00")

    async def test_verteilung_ueber_solltage_der_ganzen_spanne(self, db):
        """Freitag bis Montag: die Stunden verteilen sich auf Fr (5) und Mo
        (8,75), nicht auf vier Kalendertage. Das Wochenende verwässert nicht.

        Nur der Montag liegt in der Testwoche — er muss voll entschuldigt sein.
        """
        await person(1)
        await volle_woche(1, ausser={MO})
        vor_fr = MO - timedelta(days=3)               # Freitag der Vorwoche
        await abwesend(1, vor_fr, MO, 13.75, typ=111111)
        z = (await bericht())[0]
        assert z["ist_stunden"] == Decimal("31.25")
        assert z["soll_stunden"] == Decimal("31.25")
        assert z["netto"] == Decimal("0.00")

    async def test_abwesenheit_ohne_stunden_entschuldigt_nichts(self, db):
        await person(1)
        await volle_woche(1, ausser={MI})
        await person(2, vorname="Spaet")
        await stempel(2, SO + timedelta(days=3), 8.0)
        await abwesend(1, MI, MI, None, typ=111111)
        z = next(r for r in await bericht() if r["employee_id"] == 1)
        assert z["netto"] == Decimal("-8.75")


class TestKrankheit:
    async def test_ohne_eingerichtete_typen_bleibt_es_null(self, db):
        await person(1)
        await volle_woche(1)
        await abwesend(1, MI, MI, 8.75)
        z = (await bericht())[0]
        assert z["krank_tage"] == 0
        assert z["krank_stunden"] == 0

    async def test_tage_und_stunden_einer_woche(self, db):
        await person(1)
        await volle_woche(1, ausser={MI})
        async with SessionLocal() as s:
            async with s.begin():
                await s.execute(sa.text(
                    "update public.hr_einstellungen set werte = '{568234}'"
                    " where schluessel = 'krank_typ_ids'"))
        await abwesend(1, MI, MI, 8.75, tage=1)
        z = (await bericht())[0]
        assert z["krank_tage"] == Decimal("1.00")
        assert z["krank_stunden"] == Decimal("8.75")

    async def test_ueber_den_wochenrand_anteilig(self, db):
        """Verteilt über Kalendertage: von vier Tagen liegen zwei in der Woche."""
        await person(1)
        await volle_woche(1)
        async with SessionLocal() as s:
            async with s.begin():
                await s.execute(sa.text(
                    "update public.hr_einstellungen set werte = '{568234}'"
                    " where schluessel = 'krank_typ_ids'"))
        # Samstag der Vorwoche bis Dienstag: 4 Kalendertage, davon Mo und Di drin.
        await abwesend(1, MO - timedelta(days=2), DI, 17.5, tage=2)
        z = (await bericht())[0]
        assert z["krank_tage"] == Decimal("1.00")      # 2 × 2/4
        assert z["krank_stunden"] == Decimal("8.75")   # 17,5 × 2/4

    async def test_ohne_days_count_ueber_die_stunden(self, db):
        await person(1)
        await volle_woche(1)
        async with SessionLocal() as s:
            async with s.begin():
                await s.execute(sa.text(
                    "update public.hr_einstellungen set werte = '{568234}'"
                    " where schluessel = 'krank_typ_ids'"))
        await abwesend(1, MI, MI, 8.0)                 # kein days_count
        z = (await bericht())[0]
        assert z["krank_tage"] == Decimal("1.00")      # 8 / 8


class TestRechte:
    async def test_ohne_admin_keine_zeilen(self, db):
        """Namen neben Stunden — das ist der Bericht für die Personalleitung."""
        await person(1)
        await volle_woche(1)
        assert await bericht(claims=CLAIMS_VIEWER) == []

    async def test_mit_admin_steht_der_name_drin(self, db):
        await person(1, vorname="Anna", nachname="Berger")
        await volle_woche(1)
        z = (await bericht())[0]
        assert z["name"] == "Anna Berger"

    async def test_wochenliste_ebenso_gesichert(self, db):
        await person(1)
        await volle_woche(1)
        async with SessionLocal() as s:
            trans = await s.begin()
            try:
                await s.execute(sa.text("set local role authenticated"))
                await s.execute(
                    sa.text("select set_config('request.jwt.claims', :c, true)"),
                    {"c": CLAIMS_VIEWER},
                )
                ohne = (await s.execute(
                    sa.text("select * from public.kpi_hr_wochen_mit_daten(10)"))).mappings().all()
                await s.execute(
                    sa.text("select set_config('request.jwt.claims', :c, true)"),
                    {"c": CLAIMS_ADMIN},
                )
                mit = (await s.execute(
                    sa.text("select * from public.kpi_hr_wochen_mit_daten(10)"))).mappings().all()
            finally:
                await trans.rollback()
        assert ohne == []
        assert len(mit) == 1
        assert (mit[0]["iso_jahr"], mit[0]["iso_woche"]) == (2026, 37)


class TestSortierung:
    async def test_hoechster_saldo_zuerst(self, db):
        await person(1, vorname="Viel")
        await person(2, vorname="Wenig")
        await volle_woche(1)
        await stempel(1, MO, 5.0, teil=9)
        await volle_woche(2)
        namen = [z["name"] for z in await bericht()]
        assert namen[0].startswith("Viel")
