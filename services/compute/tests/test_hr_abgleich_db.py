"""HR im Systemvergleich: Umsatz je Produktionskopf, sein Zielwert, das Foto im Organigramm.

Umsatz je Produktionskopf rechnet wie das Altsystem
(`services/hr_kpi_aggregation.py::_revenue_per_production_employee`): der
Zähler ist die Summe der **Aufträge** über null im Zeitraum — dort
`aggregate_kpi_summary` über `auftraege`, nicht die Rechnungen. Der Nenner sind
die Beschäftigten der Produktionsabteilungen, die am letzten Tag des Zeitraums
eingetreten und nicht ausgetreten sind (`_headcount_at_eom`). An der lokalen
Kopie nachgerechnet: 4.906.285,15 € Aufträge 2026 durch 48 Köpfe ergibt die
102.214 €, die das Altsystem zeigt.
"""
from __future__ import annotations

import json
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
import pytest_asyncio
import sqlalchemy as sa

from app.db import SessionLocal, auftraege, personio_employees

SUB = "11111111-1111-1111-1111-111111111111"


@pytest_asyncio.fixture
async def db(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")

    async def leeren():
        async with SessionLocal() as s:
            async with s.begin():
                await s.execute(sa.delete(auftraege))
                await s.execute(sa.delete(personio_employees))
                await s.execute(sa.text("update public.hr_einstellungen set werte = '{}'"))

    await leeren()
    yield
    await leeren()


async def person(pid: int, abteilung: str | None, *, eintritt=date(2020, 1, 1), austritt=None,
                 roh: dict | None = None, status: str = "active") -> None:
    async with SessionLocal() as s:
        async with s.begin():
            await s.execute(sa.insert(personio_employees).values(
                id=pid, first_name=f"P{pid}", last_name="Test", department=abteilung,
                status=status, hire_date=eintritt, termination_date=austritt,
                weekly_working_hours="40.00", raw_json=roh or {},
                synced_at=datetime.now(timezone.utc),
            ))


async def auftrag(nr: str, tag: date, wert: str) -> None:
    async with SessionLocal() as s:
        async with s.begin():
            await s.execute(sa.insert(auftraege).values(
                vorgang_nr=nr, typ="AUF", datum=tag, wert_eur=wert,
            ))


async def produktion(*abteilungen: str) -> None:
    async with SessionLocal() as s:
        async with s.begin():
            await s.execute(
                sa.text("update public.hr_einstellungen set werte = :w"
                        " where schluessel = 'produktion_abteilungen'"),
                {"w": list(abteilungen)},
            )


async def als(apps: dict, sql: str, **params) -> list[dict]:
    """`sql` als Rolle `authenticated` mit diesen Rechten; danach Rollback."""
    async with SessionLocal() as s:
        trans = await s.begin()
        try:
            await s.execute(sa.text("set local role authenticated"))
            await s.execute(
                sa.text("select set_config('request.jwt.claims', :c, true)"),
                {"c": json.dumps({"sub": SUB, "role": "authenticated", "apps": apps})},
            )
            rows = await s.execute(sa.text(sql), params)
            return [dict(r) for r in rows.mappings()]
        finally:
            await trans.rollback()


async def kopfumsatz(von=date(2026, 1, 1), bis=date(2026, 12, 31), apps=None) -> dict:
    (zeile,) = await als(
        apps or {"kpi": "viewer"},
        "select * from public.kpi_hr_umsatz_je_produktionskopf(:v, :b)", v=von, b=bis,
    )
    return zeile


class TestUmsatzJeProduktionskopf:
    async def test_auftraege_durch_produktionskoepfe(self, db):
        await produktion("Production", "Quality Assurance")
        await person(1, "Production")
        await person(2, "Production")
        await person(3, "Quality Assurance")
        await person(4, "Engineering")          # zählt nicht
        await auftrag("A1", date(2026, 3, 1), "60000.00")
        await auftrag("A2", date(2026, 6, 1), "30000.00")
        z = await kopfumsatz()
        assert z["auftragswert"] == Decimal("90000.00")
        assert z["koepfe"] == 3
        assert z["wert"] == Decimal("30000")
        assert z["eingerichtet"] is True

    async def test_nur_auftraege_ueber_null(self, db):
        """Wie `aggregate_kpi_summary`: Stornos und Nullzeilen bleiben draußen."""
        await produktion("Production")
        await person(1, "Production")
        await auftrag("A1", date(2026, 3, 1), "1000.00")
        await auftrag("S1", date(2026, 3, 2), "-400.00")
        await auftrag("N1", date(2026, 3, 3), "0.00")
        assert (await kopfumsatz())["auftragswert"] == Decimal("1000.00")

    async def test_fenster_auf_dem_auftragsdatum(self, db):
        await produktion("Production")
        await person(1, "Production")
        await auftrag("A1", date(2025, 12, 31), "500.00")
        await auftrag("A2", date(2026, 1, 1), "700.00")
        await auftrag("A3", date(2026, 1, 31), "100.00")
        await auftrag("A4", date(2026, 2, 1), "900.00")
        z = await kopfumsatz(date(2026, 1, 1), date(2026, 1, 31))
        assert z["auftragswert"] == Decimal("800.00")

    async def test_nenner_ist_der_stand_am_fensterende(self, db):
        """`_headcount_at_eom`: eingetreten bis zum letzten Tag, nicht bis dahin ausgetreten."""
        await produktion("Production")
        await person(1, "Production")
        await person(2, "Production", austritt=date(2026, 1, 31))   # am Ende weg
        await person(3, "Production", eintritt=date(2026, 2, 1))    # erst danach da
        await person(4, "Production", austritt=date(2026, 2, 1))    # am letzten Tag noch da
        await auftrag("A1", date(2026, 1, 15), "900.00")
        z = await kopfumsatz(date(2026, 1, 1), date(2026, 1, 31))
        assert z["koepfe"] == 2
        assert z["wert"] == Decimal("450")

    async def test_null_nenner_gibt_keinen_wert(self, db):
        await produktion("Production")
        await person(1, "Engineering")
        await auftrag("A1", date(2026, 3, 1), "1000.00")
        z = await kopfumsatz()
        assert z["koepfe"] == 0
        assert z["wert"] is None

    async def test_ohne_auftraege_kein_wert(self, db):
        """Das Altsystem gibt dann „—" statt 0 €: es fehlen Daten, nicht Umsatz."""
        await produktion("Production")
        await person(1, "Production")
        z = await kopfumsatz()
        assert z["auftragswert"] == Decimal("0")
        assert z["wert"] is None

    async def test_ohne_produktionsabteilungen_nicht_eingerichtet(self, db):
        await person(1, "Production")
        await auftrag("A1", date(2026, 3, 1), "1000.00")
        z = await kopfumsatz()
        assert z["eingerichtet"] is False
        assert z["wert"] is None

    async def test_aggregat_braucht_kein_hr_recht(self, db):
        """Wie die übrigen HR-Kennzahlen: nur Summen, keine Personenzeilen."""
        await produktion("Production")
        await person(1, "Production")
        await auftrag("A1", date(2026, 3, 1), "1000.00")
        z = await kopfumsatz(apps={"kpi": "viewer"})
        assert z["wert"] == Decimal("1000")


class TestVerlauf:
    async def test_je_monat_mit_eigenem_nenner(self, db):
        await produktion("Production")
        await person(1, "Production")
        await person(2, "Production", eintritt=date(2026, 2, 10))
        await auftrag("A1", date(2026, 1, 5), "1000.00")
        await auftrag("A2", date(2026, 2, 5), "3000.00")
        zeilen = await als(
            {"kpi": "viewer"},
            "select * from public.kpi_hr_umsatz_je_produktionskopf_verlauf("
            "'2026-01-01', '2026-03-31', 'month')",
        )
        assert [z["bucket"] for z in zeilen] == [date(2026, 1, 1), date(2026, 2, 1), date(2026, 3, 1)]
        assert zeilen[0]["wert"] == Decimal("1000")
        assert zeilen[1]["wert"] == Decimal("1500")
        # Keine Aufträge im März: fehlender Wert, keine Null.
        assert zeilen[2]["wert"] is None


class TestZielwert:
    async def test_ziel_300_euro_mehr_ist_besser(self, db):
        (z,) = await als(
            {"kpi": "viewer"},
            "select bereich, wert, einheit, richtung from public.zielwerte"
            " where schluessel = 'hr_umsatz_je_produktionskopf'",
        )
        assert z["bereich"] == "personal"
        assert z["wert"] == Decimal("300")
        assert z["einheit"] == "euro"
        assert z["richtung"] == "min"

    async def test_euro_ist_eine_erlaubte_einheit(self, db):
        """Die Einstellungsseite schreibt dann „€" statt „Stück" daneben."""
        async with SessionLocal() as s:
            definition = await s.scalar(sa.text(
                "select pg_get_constraintdef(oid) from pg_constraint"
                " where conname = 'zielwerte_einheit_check'"
            ))
        assert "euro" in definition


class TestOrganigrammFoto:
    async def test_hat_foto_aus_personio(self, db):
        await person(1, "Production", roh={"attributes": {"profile_picture": {
            "label": "Profile Picture", "value": "https://api.personio.de/v1/company/employees/1/profile-picture",
        }}})
        await person(2, "Production", roh={"attributes": {"profile_picture": {
            "label": "Profile Picture", "value": None,
        }}})
        await person(3, "Production")
        zeilen = await als(
            {"hr": "viewer"}, "select id, hat_foto from public.organigramm order by id"
        )
        assert [(z["id"], z["hat_foto"]) for z in zeilen] == [(1, True), (2, False), (3, False)]
