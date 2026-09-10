"""HR-Kennzahlen gegen eine echte Datenbank.

Die Zahlen sind von Hand nachgerechnet und im Test kommentiert. Das
Arbeitszeitmodell in den Testdaten ist das, das auf dem Produktionssystem
tatsächlich vorkommt: Mo–Do 08:45, Fr 05:00, Wochenende 00:00 — zusammen
40 Stunden, aber eben nicht fünf gleiche Tage.
"""
from __future__ import annotations

from datetime import date, datetime, time as uhrzeit, timezone
from decimal import Decimal

import pytest
import pytest_asyncio
import sqlalchemy as sa

from app.db import (
    SessionLocal,
    personio_absences,
    personio_attendance,
    personio_employees,
)

MODELL = {
    "attributes": {
        "work_schedule": {
            "value": {
                "attributes": {
                    "monday": "08:45", "tuesday": "08:45", "wednesday": "08:45",
                    "thursday": "08:45", "friday": "05:00",
                    "saturday": "00:00", "sunday": "00:00",
                }
            }
        }
    }
}
OHNE_MODELL = {"attributes": {}}


@pytest_asyncio.fixture
async def db(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")
    async with SessionLocal() as s:
        async with s.begin():
            await s.execute(sa.delete(personio_attendance))
            await s.execute(sa.delete(personio_absences))
            await s.execute(sa.delete(personio_employees))
            await s.execute(sa.text("update public.hr_einstellungen set werte = '{}'"))
    yield
    async with SessionLocal() as s:
        async with s.begin():
            await s.execute(sa.delete(personio_attendance))
            await s.execute(sa.delete(personio_absences))
            await s.execute(sa.delete(personio_employees))
            await s.execute(sa.text("update public.hr_einstellungen set werte = '{}'"))


async def person(pid: int, *, modell=MODELL, wochenstunden="40.00",
                 eintritt=date(2020, 1, 1), austritt=None) -> None:
    async with SessionLocal() as s:
        async with s.begin():
            await s.execute(sa.insert(personio_employees).values(
                id=pid, first_name=f"P{pid}", last_name="Test", status="active",
                hire_date=eintritt, termination_date=austritt,
                weekly_working_hours=wochenstunden, raw_json=modell,
                synced_at=datetime.now(timezone.utc),
            ))


def _uhr(hhmm: str) -> uhrzeit:
    stunde, minute = hhmm.split(":")
    return uhrzeit(int(stunde), int(minute))


async def stempel(pid: int, tag: date, von: str, bis: str, pause: int = 0, kennung: str | None = None) -> None:
    async with SessionLocal() as s:
        async with s.begin():
            await s.execute(sa.insert(personio_attendance).values(
                id=kennung or f"{pid}-{tag}-{von}", employee_id=pid, datum=tag,
                start_time=_uhr(von), end_time=_uhr(bis), break_minutes=pause,
                synced_at=datetime.now(timezone.utc),
            ))


async def abwesend(pid: int, von: date, bis: date, typ: int, einheit: str,
                   stunden: float | None, kennung: str) -> None:
    async with SessionLocal() as s:
        async with s.begin():
            await s.execute(sa.insert(personio_absences).values(
                id=kennung, employee_id=pid, absence_type_id=typ,
                start_date=von, end_date=bis, time_unit=einheit, hours=stunden,
                raw_json={}, synced_at=datetime.now(timezone.utc),
            ))


async def einstellung(schluessel: str, werte: list[str]) -> None:
    async with SessionLocal() as s:
        async with s.begin():
            await s.execute(
                sa.text("update public.hr_einstellungen set werte = :w where schluessel = :s"),
                {"w": werte, "s": schluessel},
            )


async def funktion(name: str, *args) -> list[dict]:
    async with SessionLocal() as s:
        platz = ", ".join(f":p{i}" for i in range(len(args)))
        rows = await s.execute(
            sa.text(f"select * from public.{name}({platz})"),
            {f"p{i}": v for i, v in enumerate(args)},
        )
        return [dict(r) for r in rows.mappings()]


async def tagessoll(pid: int, tag: date) -> Decimal:
    async with SessionLocal() as s:
        return await s.scalar(
            sa.text(
                "select public.hr_tagessoll(e.raw_json, e.weekly_working_hours, :t)"
                " from public.personio_employees e where e.id = :p"
            ),
            {"t": tag, "p": pid},
        )


class TestTagessoll:
    """Die eine Größe, an der alles hängt."""

    async def test_modell_gibt_den_wochentag_her(self, db):
        await person(1)
        # 2026-09-07 ist ein Montag, 2026-09-11 ein Freitag.
        assert await tagessoll(1, date(2026, 9, 7)) == Decimal("8.75")
        assert await tagessoll(1, date(2026, 9, 11)) == Decimal("5")

    async def test_wochenende_ist_null(self, db):
        await person(1)
        assert await tagessoll(1, date(2026, 9, 12)) == 0   # Samstag
        assert await tagessoll(1, date(2026, 9, 13)) == 0   # Sonntag

    async def test_ohne_modell_flach_ueber_die_werktage(self, db):
        await person(2, modell=OHNE_MODELL, wochenstunden="40.00")
        assert await tagessoll(2, date(2026, 9, 7)) == 8
        assert await tagessoll(2, date(2026, 9, 12)) == 0

    async def test_ohne_modell_und_ohne_wochenstunden(self, db):
        await person(3, modell=OHNE_MODELL, wochenstunden=None)
        assert await tagessoll(3, date(2026, 9, 7)) == 8

    async def test_leeres_modell_zaehlt_nicht_als_modell(self, db):
        """Sonst wäre jeder Tag null Soll und niemand hätte je Überstunden."""
        leer = {"attributes": {"work_schedule": {"value": {"attributes": {
            "monday": "00:00", "tuesday": "00:00", "wednesday": "00:00",
            "thursday": "00:00", "friday": "00:00",
            "saturday": "00:00", "sunday": "00:00"}}}}}
        await person(4, modell=leer, wochenstunden="40.00")
        assert await tagessoll(4, date(2026, 9, 7)) == 8


class TestUeberstunden:
    async def test_zwei_segmente_am_selben_tag_werden_erst_summiert(self, db):
        """Der Fehler, den das Altprojekt einmal hatte: das Tagessoll je
        Segment abziehen. Bei Vor- und Nachmittag zieht man es dann zweimal ab
        und weist zu wenig Überstunden aus."""
        await person(1)
        # Montag, Soll 8,75. Vormittag 4 h, Nachmittag 6 h → 10 h, also
        # 1,25 h über dem Soll. Je Segment gerechnet wären es 0.
        await stempel(1, date(2026, 9, 7), "08:00", "12:00", kennung="a")
        await stempel(1, date(2026, 9, 7), "13:00", "19:00", kennung="b")
        z = (await funktion("kpi_hr_ueberstunden", date(2026, 9, 1), date(2026, 9, 30)))[0]
        assert z["ist_stunden"] == Decimal("10")
        assert z["ueberstunden"] == Decimal("1.25")

    async def test_pause_wird_abgezogen(self, db):
        await person(1)
        await stempel(1, date(2026, 9, 7), "08:00", "17:00", pause=30)
        z = (await funktion("kpi_hr_ueberstunden", date(2026, 9, 1), date(2026, 9, 30)))[0]
        assert z["ist_stunden"] == Decimal("8.5")   # 9 h minus 30 min
        assert z["ueberstunden"] == 0                # unter dem Soll von 8,75

    async def test_freitag_hat_ein_anderes_soll(self, db):
        """Mit einem flachen Soll von 8 h wäre dieser Tag ohne Überstunden."""
        await person(1)
        await stempel(1, date(2026, 9, 11), "08:00", "15:00")   # Freitag, 7 h
        z = (await funktion("kpi_hr_ueberstunden", date(2026, 9, 1), date(2026, 9, 30)))[0]
        assert z["ueberstunden"] == Decimal("2")    # Soll 5 h

    async def test_samstagsarbeit_ist_ganz_ueberstunde(self, db):
        await person(1)
        await stempel(1, date(2026, 9, 12), "08:00", "12:00")   # Samstag
        z = (await funktion("kpi_hr_ueberstunden", date(2026, 9, 1), date(2026, 9, 30)))[0]
        assert z["ueberstunden"] == Decimal("4")

    async def test_quote_und_personenzahl(self, db):
        await person(1)
        await person(2)
        await stempel(1, date(2026, 9, 7), "08:00", "18:00")    # 10 h, +1,25
        await stempel(2, date(2026, 9, 7), "08:00", "16:00")    # 8 h, 0
        z = (await funktion("kpi_hr_ueberstunden", date(2026, 9, 1), date(2026, 9, 30)))[0]
        assert z["ist_stunden"] == Decimal("18")
        assert z["ueberstunden"] == Decimal("1.25")
        assert round(z["quote"], 4) == round(Decimal("1.25") / Decimal("18"), 4)
        assert z["personen"] == 2

    async def test_leeres_fenster_gibt_keine_quote(self, db):
        await person(1)
        z = (await funktion("kpi_hr_ueberstunden", date(2026, 1, 1), date(2026, 1, 31)))[0]
        assert z["quote"] is None
        assert z["ist_stunden"] == 0


class TestKrankheit:
    async def test_ohne_eingerichtete_typen_keine_quote(self, db):
        await person(1)
        z = (await funktion("kpi_hr_krankheit", date(2026, 9, 1), date(2026, 9, 30)))[0]
        assert z["eingerichtet"] is False
        assert z["quote"] is None

    async def test_stundenbasierte_abwesenheit_zaehlt_ihre_stunden(self, db):
        """Der Zweig, der im Altprojekt nie ansprang: dort wird auf
        `time_unit = 'hours'` geprüft, Personio schreibt `'hour'`."""
        await person(1)
        await einstellung("krank_typ_ids", ["568234"])
        await abwesend(1, date(2026, 9, 7), date(2026, 9, 7), 568234, "hour", 5.0, "a")
        z = (await funktion("kpi_hr_krankheit", date(2026, 9, 7), date(2026, 9, 7)))[0]
        assert z["krank_stunden"] == Decimal("5.00")   # nicht 8,75 (der Tagessatz)

    async def test_tagesbasierte_abwesenheit_folgt_dem_modell(self, db):
        await person(1)
        await einstellung("krank_typ_ids", ["568234"])
        # Freitag bis Montag: Fr 5 h + Sa 0 + So 0 + Mo 8,75 = 13,75 h.
        # Über Kalendertage mal Tagessatz wären es 4 × 8,75 = 35 h.
        await abwesend(1, date(2026, 9, 11), date(2026, 9, 14), 568234, "day", 13.75, "b")
        z = (await funktion("kpi_hr_krankheit", date(2026, 9, 11), date(2026, 9, 14)))[0]
        assert z["krank_stunden"] == Decimal("13.75")

    async def test_abwesenheit_wird_am_fensterrand_beschnitten(self, db):
        await person(1)
        await einstellung("krank_typ_ids", ["568234"])
        await abwesend(1, date(2026, 9, 7), date(2026, 9, 11), 568234, "day", 40.0, "c")
        # Fenster nur Montag und Dienstag: 8,75 + 8,75.
        z = (await funktion("kpi_hr_krankheit", date(2026, 9, 7), date(2026, 9, 8)))[0]
        assert z["krank_stunden"] == Decimal("17.50")

    async def test_fremde_abwesenheitsart_zaehlt_nicht(self, db):
        await person(1)
        await einstellung("krank_typ_ids", ["568234"])
        await abwesend(1, date(2026, 9, 7), date(2026, 9, 7), 999999, "day", 8.0, "d")
        z = (await funktion("kpi_hr_krankheit", date(2026, 9, 7), date(2026, 9, 7)))[0]
        assert z["krank_stunden"] == 0

    async def test_sollstunden_kommen_aus_dem_modell(self, db):
        await person(1)
        await einstellung("krank_typ_ids", ["568234"])
        # Eine volle Woche Mo–So: 4 × 8,75 + 5 = 40 h.
        z = (await funktion("kpi_hr_krankheit", date(2026, 9, 7), date(2026, 9, 13)))[0]
        assert z["soll_stunden"] == Decimal("40.00")


class TestFluktuation:
    async def test_austritte_im_fenster(self, db):
        await person(1)
        await person(2, austritt=date(2026, 9, 15))
        z = (await funktion("kpi_hr_fluktuation", date(2026, 9, 1), date(2026, 9, 30)))[0]
        assert z["austritte"] == 1

    async def test_bestand_ist_der_tagesdurchschnitt(self, db):
        """Nicht Anfang gegen Ende: ein Eintritt in der Mitte zählt anteilig."""
        await person(1)                                    # ganzes Fenster aktiv
        await person(2, eintritt=date(2026, 9, 16))        # zweite Hälfte
        z = (await funktion("kpi_hr_fluktuation", date(2026, 9, 1), date(2026, 9, 30)))[0]
        # 30 Tage: Person 1 an allen 30, Person 2 ab dem 16. an 15 Tagen.
        assert round(z["bestand_schnitt"], 2) == round(Decimal(45) / Decimal(30), 2)

    async def test_ohne_bestand_keine_quote(self, db):
        z = (await funktion("kpi_hr_fluktuation", date(2026, 9, 1), date(2026, 9, 30)))[0]
        assert z["quote"] is None

    async def test_austritt_am_letzten_tag_zaehlt_mit(self, db):
        await person(1, austritt=date(2026, 9, 30))
        z = (await funktion("kpi_hr_fluktuation", date(2026, 9, 1), date(2026, 9, 30)))[0]
        assert z["austritte"] == 1


class TestRechte:
    async def test_ohne_hr_recht_keine_personendaten(self, db):
        """Kein Fehler, sondern ein leeres Ergebnis — so sieht RLS aus."""
        from tests._auth import USER_ID
        await person(1)
        await stempel(1, date(2026, 9, 7), "08:00", "16:00")
        async with SessionLocal() as s:
            trans = await s.begin()
            try:
                await s.execute(sa.text("set local role authenticated"))
                await s.execute(
                    sa.text("select set_config('request.jwt.claims', :c, true)"),
                    {"c": '{"sub":"' + USER_ID + '","role":"authenticated","apps":{"kpi":"viewer"}}'},
                )
                zahlen = {
                    n: await s.scalar(sa.text(f"select count(*) from public.{n}"))
                    for n in ("personio_employees", "personio_attendance", "personio_absences")
                }
            finally:
                await trans.rollback()
        assert zahlen == {"personio_employees": 0, "personio_attendance": 0, "personio_absences": 0}

    async def test_mit_hr_recht_sichtbar(self, db):
        from tests._auth import USER_ID
        await person(1)
        async with SessionLocal() as s:
            trans = await s.begin()
            try:
                await s.execute(sa.text("set local role authenticated"))
                await s.execute(
                    sa.text("select set_config('request.jwt.claims', :c, true)"),
                    {"c": '{"sub":"' + USER_ID + '","role":"authenticated","apps":{"hr":"viewer"}}'},
                )
                anzahl = await s.scalar(sa.text("select count(*) from public.personio_employees"))
            finally:
                await trans.rollback()
        assert anzahl == 1

    async def test_kennzahl_rechnet_auch_ohne_hr_recht(self, db):
        """Die Funktionen sind `security definer` und geben nur Aggregate her —
        das Dashboard soll die Quote zeigen, ohne die Personen preiszugeben."""
        from tests._auth import USER_ID
        await person(1)
        await stempel(1, date(2026, 9, 7), "08:00", "18:00")
        async with SessionLocal() as s:
            trans = await s.begin()
            try:
                await s.execute(sa.text("set local role authenticated"))
                await s.execute(
                    sa.text("select set_config('request.jwt.claims', :c, true)"),
                    {"c": '{"sub":"' + USER_ID + '","role":"authenticated","apps":{"kpi":"viewer"}}'},
                )
                zeile = (await s.execute(sa.text(
                    "select * from public.kpi_hr_ueberstunden('2026-09-01','2026-09-30')"
                ))).mappings().one()
            finally:
                await trans.rollback()
        assert zeile["ist_stunden"] == Decimal("10")
