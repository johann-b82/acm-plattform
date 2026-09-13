"""Personalkostenquote gegen eine echte Datenbank.

Die Zahlen sind von Hand nachgerechnet. Zwei Dinge stehen hier besonders im
Blick, weil sie leicht falsch werden:

  * die anteilige Verteilung des Monatsbruttos über Ein- und Austritte,
  * die Aufteilung nach Abteilung: jede Abteilung steht einzeln da, auch
    eine mit nur einer Person (Nutzerentscheidung FIN-05, wie im Altsystem).
    Die Zeile je Person bleibt trotzdem verschlossen — heraus kommen nur
    Summen je Abteilung.
"""
from __future__ import annotations

from datetime import date, datetime, time as uhrzeit, timezone
from decimal import Decimal

import pytest
import pytest_asyncio
import sqlalchemy as sa

from app.db import SessionLocal, personio_attendance, personio_employees, revenues

MODELL = {
    "attributes": {
        "work_schedule": {"value": {"attributes": {
            "monday": "08:00", "tuesday": "08:00", "wednesday": "08:00",
            "thursday": "08:00", "friday": "08:00",
            "saturday": "00:00", "sunday": "00:00"}}}
    }
}


def mit_gehalt(fix: str | None = None, stunde: str | None = None) -> dict:
    roh = {"attributes": dict(MODELL["attributes"])}
    if fix is not None:
        roh["attributes"]["fix_salary"] = {"value": fix}
    if stunde is not None:
        roh["attributes"]["hourly_salary"] = {"value": stunde}
    return roh


@pytest_asyncio.fixture
async def db(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")
    async def leeren():
        async with SessionLocal() as s:
            async with s.begin():
                await s.execute(sa.delete(personio_attendance))
                await s.execute(sa.delete(personio_employees))
                await s.execute(sa.delete(revenues))
    await leeren()
    yield
    await leeren()


async def person(pid: int, *, abteilung="Fertigung", raw=None,
                 eintritt=date(2020, 1, 1), austritt=None) -> None:
    async with SessionLocal() as s:
        async with s.begin():
            await s.execute(sa.insert(personio_employees).values(
                id=pid, first_name=f"P{pid}", last_name="Test", department=abteilung,
                status="active", hire_date=eintritt, termination_date=austritt,
                weekly_working_hours="40.00", raw_json=raw or mit_gehalt(fix="5000"),
                synced_at=datetime.now(timezone.utc),
            ))


async def umsatz(betrag: str, tag: date = date(2026, 3, 15)) -> None:
    async with SessionLocal() as s:
        async with s.begin():
            await s.execute(sa.insert(revenues).values(
                vorgang_nr=f"R-{tag}-{betrag}", typ="RG", datum=tag,
                wert_eur=Decimal(betrag), imported_at=datetime.now(timezone.utc),
            ))


async def stempel(pid: int, tag: date, stunden: float) -> None:
    ende = 8 + stunden
    async with SessionLocal() as s:
        async with s.begin():
            await s.execute(sa.insert(personio_attendance).values(
                id=f"{pid}-{tag}", employee_id=pid, datum=tag,
                start_time=uhrzeit(8, 0),
                end_time=uhrzeit(int(ende), int(round((ende % 1) * 60))),
                break_minutes=0, synced_at=datetime.now(timezone.utc),
            ))


async def funktion(name: str, *args) -> list[dict]:
    async with SessionLocal() as s:
        platz = ", ".join(f":p{i}" for i in range(len(args)))
        rows = await s.execute(
            sa.text(f"select * from public.{name}({platz})"),
            {f"p{i}": v for i, v in enumerate(args)},
        )
        return [dict(r) for r in rows.mappings()]


class TestZahl:
    @pytest.mark.parametrize("roh, erwartet", [
        ("1234.56", Decimal("1234.56")),
        ("1234,56", Decimal("1234.56")),
        ("1.234,56", Decimal("1234.56")),
        ("5000", Decimal("5000")),
        ("", None),
        (None, None),
    ])
    async def test_deutsche_und_englische_zahlen(self, db, roh, erwartet):
        async with SessionLocal() as s:
            wert = await s.scalar(sa.text("select public.hr_zahl(:t)"), {"t": roh})
        assert wert == erwartet


class TestFestgehalt:
    async def test_voller_monat_ist_ein_monatsbrutto(self, db):
        await person(1, raw=mit_gehalt(fix="5000"))
        await umsatz("10000")
        z = (await funktion("kpi_finanzen_personalkosten", date(2026, 3, 1), date(2026, 3, 31)))[0]
        assert z["personalkosten"] == Decimal("5000.00")
        assert z["quote"] == Decimal("0.50000000000000000000")

    async def test_eintritt_in_der_monatsmitte_zaehlt_anteilig(self, db):
        # Eintritt am 16. März: 16 von 31 Tagen.
        await person(1, raw=mit_gehalt(fix="3100"), eintritt=date(2026, 3, 16))
        await umsatz("10000")
        z = (await funktion("kpi_finanzen_personalkosten", date(2026, 3, 1), date(2026, 3, 31)))[0]
        assert z["personalkosten"] == Decimal("1600.00")   # 3100 × 16/31

    async def test_austritt_beendet_die_kosten(self, db):
        await person(1, raw=mit_gehalt(fix="3100"), austritt=date(2026, 3, 10))
        await umsatz("10000")
        z = (await funktion("kpi_finanzen_personalkosten", date(2026, 3, 1), date(2026, 3, 31)))[0]
        assert z["personalkosten"] == Decimal("1000.00")   # 3100 × 10/31

    async def test_zwei_monate_zaehlen_zweimal(self, db):
        await person(1, raw=mit_gehalt(fix="5000"))
        await umsatz("10000")
        z = (await funktion("kpi_finanzen_personalkosten", date(2026, 3, 1), date(2026, 4, 30)))[0]
        assert z["personalkosten"] == Decimal("10000.00")

    async def test_wer_vor_dem_fenster_ausgetreten_ist_zaehlt_nicht(self, db):
        await person(1, raw=mit_gehalt(fix="5000"), austritt=date(2025, 12, 31))
        await umsatz("10000")
        z = (await funktion("kpi_finanzen_personalkosten", date(2026, 3, 1), date(2026, 3, 31)))[0]
        assert z["personalkosten"] == 0
        assert z["personen"] == 0


class TestStundenlohn:
    async def test_satz_mal_geleistete_stunden(self, db):
        await person(1, raw=mit_gehalt(stunde="25"))
        await stempel(1, date(2026, 3, 2), 8)
        await stempel(1, date(2026, 3, 3), 6)
        await umsatz("10000")
        z = (await funktion("kpi_finanzen_personalkosten", date(2026, 3, 1), date(2026, 3, 31)))[0]
        assert z["personalkosten"] == Decimal("350.00")    # 14 h × 25

    async def test_festgehalt_schlaegt_stundenlohn(self, db):
        """Wer beides hinterlegt hat, gilt als festangestellt — so das Altprojekt."""
        await person(1, raw=mit_gehalt(fix="5000", stunde="25"))
        await stempel(1, date(2026, 3, 2), 8)
        await umsatz("10000")
        z = (await funktion("kpi_finanzen_personalkosten", date(2026, 3, 1), date(2026, 3, 31)))[0]
        assert z["personalkosten"] == Decimal("5000.00")

    async def test_ohne_gehalt_kein_beitrag(self, db):
        await person(1, raw=mit_gehalt())
        await stempel(1, date(2026, 3, 2), 8)
        await umsatz("10000")
        z = (await funktion("kpi_finanzen_personalkosten", date(2026, 3, 1), date(2026, 3, 31)))[0]
        assert z["personen"] == 0
        assert z["quote"] == 0


class TestQuote:
    async def test_ohne_umsatz_keine_quote(self, db):
        await person(1, raw=mit_gehalt(fix="5000"))
        z = (await funktion("kpi_finanzen_personalkosten", date(2026, 3, 1), date(2026, 3, 31)))[0]
        assert z["quote"] is None
        assert z["personalkosten"] == Decimal("5000.00")

    async def test_gutschriften_mindern_den_nenner(self, db):
        """`revenues` trägt Gutschriften negativ — das ist der Nettoumsatz."""
        await person(1, raw=mit_gehalt(fix="5000"))
        await umsatz("12000")
        await umsatz("-2000", tag=date(2026, 3, 20))
        z = (await funktion("kpi_finanzen_personalkosten", date(2026, 3, 1), date(2026, 3, 31)))[0]
        assert z["umsatz"] == Decimal("10000.00")
        assert z["quote"] == Decimal("0.50000000000000000000")

    async def test_verlauf_je_monat(self, db):
        await person(1, raw=mit_gehalt(fix="5000"))
        await umsatz("10000", tag=date(2026, 3, 15))
        await umsatz("20000", tag=date(2026, 4, 15))
        punkte = await funktion("kpi_finanzen_personalkosten_verlauf",
                                date(2026, 3, 1), date(2026, 4, 30), "month")
        assert [p["bucket"] for p in punkte] == [date(2026, 3, 1), date(2026, 4, 1)]
        assert punkte[0]["quote"] == Decimal("0.50000000000000000000")
        assert punkte[1]["quote"] == Decimal("0.25000000000000000000")


class TestAbteilung:
    async def _drei_abteilungen(self):
        # Fertigung: 3 Personen — bleibt sichtbar.
        for i in (1, 2, 3):
            await person(i, abteilung="Fertigung", raw=mit_gehalt(fix="3000"))
        # Vertrieb: 2 Personen — zu klein.
        for i in (4, 5):
            await person(i, abteilung="Vertrieb", raw=mit_gehalt(fix="4000"))
        # Geschäftsführung: 1 Person — das wäre ein einzelnes Gehalt.
        await person(6, abteilung="Geschäftsführung", raw=mit_gehalt(fix="12000"))
        await umsatz("100000")

    async def test_jede_abteilung_steht_einzeln_auch_mit_einer_person(self, db):
        """FIN-05: keine Sammelzeile „Übrige" mehr. Früher verlangte dieser
        Test die Schwelle von drei Personen; der Nutzer hat entschieden, alle
        Abteilungen einzeln zu zeigen, wie das Altsystem."""
        await self._drei_abteilungen()
        zeilen = await funktion("kpi_finanzen_personalkosten_abteilung",
                                date(2026, 3, 1), date(2026, 3, 31))
        nach = {z["abteilung"]: z for z in zeilen}
        assert set(nach) == {"Fertigung", "Vertrieb", "Geschäftsführung"}
        assert (nach["Fertigung"]["kosten"], nach["Fertigung"]["personen"]) == (Decimal("9000.00"), 3)
        assert (nach["Vertrieb"]["kosten"], nach["Vertrieb"]["personen"]) == (Decimal("8000.00"), 2)
        assert (nach["Geschäftsführung"]["kosten"], nach["Geschäftsführung"]["personen"]) == (Decimal("12000.00"), 1)
        # Teuerste zuerst.
        assert [z["abteilung"] for z in zeilen] == ["Geschäftsführung", "Fertigung", "Vertrieb"]

    async def test_ohne_abteilung_steht_ein_strich(self, db):
        await person(1, abteilung=None, raw=mit_gehalt(fix="3000"))
        zeilen = await funktion("kpi_finanzen_personalkosten_abteilung",
                                date(2026, 3, 1), date(2026, 3, 31))
        assert [(z["abteilung"], z["personen"]) for z in zeilen] == [("—", 1)]

    async def test_die_summe_bleibt_richtig(self, db):
        await self._drei_abteilungen()
        zeilen = await funktion("kpi_finanzen_personalkosten_abteilung",
                                date(2026, 3, 1), date(2026, 3, 31))
        gesamt = (await funktion("kpi_finanzen_personalkosten",
                                 date(2026, 3, 1), date(2026, 3, 31)))[0]
        assert sum(z["kosten"] for z in zeilen) == gesamt["personalkosten"]
        assert sum(z["personen"] for z in zeilen) == gesamt["personen"]

    async def test_die_zeile_je_person_ist_nicht_freigegeben(self, db):
        """Sie trägt Gehälter — nur die Aggregatfunktionen dürfen sie rufen."""
        from tests._auth import USER_ID
        await self._drei_abteilungen()
        async with SessionLocal() as s:
            trans = await s.begin()
            try:
                await s.execute(sa.text("set local role authenticated"))
                await s.execute(
                    sa.text("select set_config('request.jwt.claims', :c, true)"),
                    {"c": '{"sub":"' + USER_ID + '","role":"authenticated","apps":{"kpi":"admin","hr":"admin"}}'},
                )
                with pytest.raises(Exception) as fehler:
                    await s.execute(sa.text(
                        "select * from public.hr_personalkosten_je_person('2026-03-01','2026-03-31')"
                    ))
            finally:
                await trans.rollback()
        assert "permission denied" in str(fehler.value).lower()

    async def test_aggregat_geht_auch_ohne_hr_recht(self, db):
        from tests._auth import USER_ID
        await self._drei_abteilungen()
        async with SessionLocal() as s:
            trans = await s.begin()
            try:
                await s.execute(sa.text("set local role authenticated"))
                await s.execute(
                    sa.text("select set_config('request.jwt.claims', :c, true)"),
                    {"c": '{"sub":"' + USER_ID + '","role":"authenticated","apps":{"kpi":"viewer"}}'},
                )
                zeile = (await s.execute(sa.text(
                    "select * from public.kpi_finanzen_personalkosten('2026-03-01','2026-03-31')"
                ))).mappings().one()
            finally:
                await trans.rollback()
        assert zeile["personalkosten"] == Decimal("29000.00")
