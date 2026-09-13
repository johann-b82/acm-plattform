"""Mitarbeitertabelle gegen eine echte Datenbank.

Der Kern des Tests: die Summe der Zeilen muss die Kachel ergeben. Im
Altprojekt tut sie das nicht — dort rechnet die Tabelle je Segment und mit
pauschalem Tagessoll, die Kachel je Tag und mit dem Arbeitszeitmodell.
"""
from __future__ import annotations

from datetime import date, datetime, time as uhrzeit, timezone
from decimal import Decimal

import pytest
import pytest_asyncio
import sqlalchemy as sa

from app.db import SessionLocal, personio_attendance, personio_employees
from tests._auth import USER_ID

MO, DI = date(2026, 9, 7), date(2026, 9, 8)
FR = date(2026, 9, 11)

MODELL = {
    "attributes": {
        "work_schedule": {"value": {"attributes": {
            "monday": "08:45", "tuesday": "08:45", "wednesday": "08:45",
            "thursday": "08:45", "friday": "05:00",
            "saturday": "00:00", "sunday": "00:00"}}}
    }
}

CLAIMS = {
    "hr": '{"sub":"%s","role":"authenticated","apps":{"hr":"viewer"}}' % USER_ID,
    "kpi": '{"sub":"%s","role":"authenticated","apps":{"kpi":"admin"}}' % USER_ID,
}


@pytest_asyncio.fixture
async def db(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")

    async def leeren():
        async with SessionLocal() as s:
            async with s.begin():
                await s.execute(sa.delete(personio_attendance))
                await s.execute(sa.delete(personio_employees))

    await leeren()
    yield
    await leeren()


async def person(pid: int, vorname="Anna", abteilung="Fertigung", *, status="active",
                 raw=None, wochenstunden="40.00") -> None:
    async with SessionLocal() as s:
        async with s.begin():
            await s.execute(sa.insert(personio_employees).values(
                id=pid, first_name=vorname, last_name="Berger", department=abteilung,
                status=status, hire_date=date(2020, 1, 1), termination_date=None,
                weekly_working_hours=wochenstunden, raw_json=MODELL if raw is None else raw,
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


async def tabelle(claims=CLAIMS["hr"], von=date(2026, 9, 1), bis=date(2026, 9, 30)) -> list[dict]:
    async with SessionLocal() as s:
        trans = await s.begin()
        try:
            await s.execute(sa.text("set local role authenticated"))
            await s.execute(
                sa.text("select set_config('request.jwt.claims', :c, true)"), {"c": claims}
            )
            rows = await s.execute(
                sa.text("select * from public.kpi_hr_mitarbeiter(:v, :b)"),
                {"v": von, "b": bis},
            )
            return [dict(r) for r in rows.mappings()]
        finally:
            await trans.rollback()


class TestRechnung:
    async def test_zwei_segmente_am_tag_werden_erst_summiert(self, db):
        """Der Fehler des Altprojekts: je Segment abgezogen bleibt nichts übrig.

        Vormittag 4 h, Nachmittag 6 h — zusammen 10 h bei einem Tagessoll von
        8,75. Je Segment gerechnet wären es null Überstunden.
        """
        await person(1)
        await stempel(1, MO, 4.0, teil=0)
        await stempel(1, MO, 6.0, teil=1)
        z = (await tabelle())[0]
        assert z["ist_stunden"] == Decimal("10.00")
        assert z["ueberstunden"] == Decimal("1.25")

    async def test_freitag_hat_ein_anderes_soll(self, db):
        """Mit pauschalen acht Stunden waere dieser Tag ohne Ueberstunden."""
        await person(1)
        await stempel(1, FR, 7.0)
        z = (await tabelle())[0]
        assert z["ueberstunden"] == Decimal("2.00")   # Soll 5 h

    async def test_quote_nur_bei_ueberstunden(self, db):
        await person(1, vorname="Mit")
        await person(2, vorname="Ohne")
        await stempel(1, MO, 10.0)
        await stempel(2, MO, 8.0)
        nach = {z["name"]: z for z in await tabelle()}
        assert nach["Mit Berger"]["quote"] == Decimal("0.1250")
        # Wie im Altprojekt: ohne Ueberstunden keine Quote, nicht null.
        assert nach["Ohne Berger"]["quote"] is None

    async def test_sortierung_nach_ueberstunden(self, db):
        await person(1, vorname="Wenig")
        await person(2, vorname="Viel")
        await stempel(1, MO, 9.0)
        await stempel(2, MO, 12.0)
        assert [z["name"] for z in await tabelle()][0] == "Viel Berger"

    async def test_ohne_stempelung_steht_die_person_mit_null_da(self, db):
        """Wie im Altsystem: die Liste sind alle Personen, nur die Stunden
        hängen am Zeitraum. Sonst hätten „Aktive“ und „Alle“ nichts zu zeigen."""
        await person(1)
        (z,) = await tabelle()
        assert z["ist_stunden"] == Decimal("0.00")
        assert z["ueberstunden"] == Decimal("0.00")
        assert z["quote"] is None

    async def test_zeitraum_grenzt_ein(self, db):
        await person(1)
        await stempel(1, MO, 10.0)
        (z,) = await tabelle(von=date(2026, 10, 1), bis=date(2026, 10, 31))
        assert z["ist_stunden"] == Decimal("0.00")

    async def test_abteilung_steht_dabei(self, db):
        await person(1, abteilung="Montage")
        await stempel(1, MO, 9.0)
        assert (await tabelle())[0]["department"] == "Montage"


class TestStammdaten:
    async def test_position_und_status(self, db):
        await person(1, raw={**MODELL, "attributes": {
            **MODELL["attributes"], "position": {"value": "Schweißer"}}})
        await person(2, vorname="Weg", status="inactive")
        nach = {z["employee_id"]: z for z in await tabelle()}
        assert nach[1]["position"] == "Schweißer"
        assert nach[1]["status"] == "active"
        assert nach[2]["position"] is None
        assert nach[2]["status"] == "inactive"

    async def test_wochenstunden_aus_dem_arbeitszeitmodell(self, db):
        """Mo–Do 8:45 und Fr 5:00 sind 40 Stunden — nicht der Spaltenwert.

        `weekly_working_hours` ist in Personio nicht verlässlich eine
        Wochenzahl; in der lokalen Kopie steht dort bei einer Person 8 neben
        einem Modell von 40 Stunden, bei einer anderen 2 neben 56.
        """
        await person(1, wochenstunden="8.00")
        assert (await tabelle())[0]["wochenstunden"] == Decimal("40.00")

    async def test_ohne_modell_die_gepflegten_wochenstunden(self, db):
        await person(1, raw={"attributes": {}}, wochenstunden="32.00")
        assert (await tabelle())[0]["wochenstunden"] == Decimal("32.00")


class TestDeckungsgleich:
    async def test_summe_der_zeilen_ergibt_die_kachel(self, db):
        """Der eigentliche Punkt: Tabelle und Kachel rechnen dasselbe.

        Im Altprojekt weichen sie um den Faktor zehn ab.
        """
        for i in (1, 2, 3):
            await person(i, vorname=f"P{i}")
        # Verschiedene Muster: mehrere Segmente, Freitag, ein ruhiger Tag.
        await stempel(1, MO, 5.0, teil=0)
        await stempel(1, MO, 5.5, teil=1)
        await stempel(2, FR, 7.25)
        await stempel(3, DI, 8.0)

        zeilen = await tabelle()
        async with SessionLocal() as s:
            kachel = (await s.execute(sa.text(
                "select * from public.kpi_hr_ueberstunden('2026-09-01','2026-09-30')"
            ))).mappings().one()

        assert sum(z["ist_stunden"] for z in zeilen) == kachel["ist_stunden"]
        assert sum(z["ueberstunden"] for z in zeilen) == kachel["ueberstunden"]


class TestRechte:
    async def test_ohne_hr_recht_keine_zeilen(self, db):
        """Namen neben Stunden — dasselbe Recht wie fuer die Personenzeilen.

        Im Altprojekt sieht das jeder Dashboard-Leser.
        """
        await person(1)
        await stempel(1, MO, 10.0)
        assert await tabelle(claims=CLAIMS["kpi"]) == []

    async def test_hr_viewer_reicht(self, db):
        """Anders als der Wochenbericht: hier stehen keine Gesundheitsdaten."""
        await person(1)
        await stempel(1, MO, 10.0)
        assert len(await tabelle(claims=CLAIMS["hr"])) == 1
