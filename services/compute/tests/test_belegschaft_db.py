"""Belegschafts-Kennzahlen und Kompetenzentwicklung gegen eine echte Datenbank.

Der Schwerpunkt liegt auf der Kaskade der Beschäftigungsart. Sie ist die
eigenwilligste Regel im ganzen Modul: das entscheidende Feld heißt in Personio
`dynamic_NNNN` und ist nur über sein **Label** zu finden, und für Minijobs
ohne gepflegte Angabe gibt es einen zweiten Weg über den
Personengruppenschlüssel.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
import pytest_asyncio
import sqlalchemy as sa

from app.db import SessionLocal, personio_employees
from tests._auth import USER_ID

CLAIMS_KPI = '{"sub":"%s","role":"authenticated","apps":{"kpi":"viewer"}}' % USER_ID
CLAIMS_LEER = '{"sub":"%s","role":"authenticated","apps":{}}' % USER_ID


@pytest_asyncio.fixture
async def db(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")

    async def leeren():
        async with SessionLocal() as s:
            async with s.begin():
                await s.execute(sa.delete(personio_employees))
                await s.execute(sa.text(
                    "update public.hr_einstellungen set werte = '{}'"
                    " where schluessel = 'kompetenz_attribute'"))

    await leeren()
    yield
    await leeren()


def roh(**attrs) -> dict:
    return {"attributes": attrs}


async def person(pid: int, *, raw=None, abteilung="Fertigung", status="active",
                 eintritt=date(2020, 1, 1), austritt=None) -> None:
    async with SessionLocal() as s:
        async with s.begin():
            await s.execute(sa.insert(personio_employees).values(
                id=pid, first_name=f"P{pid}", last_name="Test", department=abteilung,
                status=status, hire_date=eintritt, termination_date=austritt,
                weekly_working_hours="40.00", raw_json=raw or roh(),
                synced_at=datetime.now(timezone.utc),
            ))


async def als(claims: str, sql: str, **params) -> list[dict]:
    async with SessionLocal() as s:
        trans = await s.begin()
        try:
            await s.execute(sa.text("set local role authenticated"))
            await s.execute(
                sa.text("select set_config('request.jwt.claims', :c, true)"), {"c": claims}
            )
            rows = await s.execute(sa.text(sql), params)
            return [dict(r) for r in rows.mappings()]
        finally:
            await trans.rollback()


async def art(raw: dict) -> str:
    async with SessionLocal() as s:
        return await s.scalar(
            sa.text("select public.hr_beschaeftigungsart(cast(:r as jsonb))"),
            {"r": __import__("json").dumps(raw)},
        )


class TestBeschaeftigungsart:
    async def test_extern_schlaegt_alles(self, db):
        assert await art(roh(
            employment_type={"value": "external"},
            dynamic_4711={"label": "Art der Beschäftigung", "value": "Vollzeit"},
        )) == "extern"

    async def test_ueber_das_label_nicht_den_schluessel(self, db):
        """Der Schlüssel heißt `dynamic_NNNN` und ändert sich — nur das Label
        ist verlässlich."""
        assert await art(roh(
            dynamic_9999={"label": "Art der Beschäftigung", "value": "Teilzeit 20h"}
        )) == "teilzeit"

    @pytest.mark.parametrize("wert, erwartet", [
        ("Geringfügig beschäftigt", "geringfuegig"),
        ("geringf. Beschäftigung", "geringfuegig"),
        ("Teilzeit", "teilzeit"),
        ("Vollzeit", "vollzeit"),
    ])
    async def test_teilzeichenfolgen(self, db, wert, erwartet):
        assert await art(roh(
            dynamic_1={"label": "Art der Beschäftigung", "value": wert}
        )) == erwartet

    async def test_minijob_ueber_den_personengruppenschluessel(self, db):
        """Ohne gepflegte Art: irgendein Feld mit „geringfügig" reicht."""
        assert await art(roh(
            dynamic_2={"label": "Personengruppe", "value": "109 geringfügig entlohnt"}
        )) == "geringfuegig"

    async def test_ohne_angabe_gilt_vollzeit(self, db):
        assert await art(roh()) == "vollzeit"
        assert await art({}) == "vollzeit"


class TestGeschlecht:
    @pytest.mark.parametrize("roh_wert, erwartet", [
        ("male", "maennlich"), ("female", "weiblich"), ("diverse", "divers"),
        ("MALE", "maennlich"), ("", "unbekannt"), (None, "unbekannt"),
    ])
    async def test_abbildung(self, db, roh_wert, erwartet):
        async with SessionLocal() as s:
            wert = await s.scalar(
                sa.text("select public.hr_geschlecht(cast(:r as jsonb))"),
                {"r": __import__("json").dumps(roh(gender={"value": roh_wert}))},
            )
        assert wert == erwartet


class TestBelegschaft:
    async def test_aktuell_geht_ueber_den_status(self, db):
        await person(1, status="active")
        await person(2, status="inactive")
        z = (await als(CLAIMS_KPI, "select * from public.kpi_hr_belegschaft()"))[0]
        assert z["gesamt"] == 1

    async def test_stichtag_geht_ueber_ein_und_austritt(self, db):
        """Im Stichtagsmodus zählt der Status nicht — so das Altprojekt."""
        await person(1, status="inactive", eintritt=date(2020, 1, 1))
        await person(2, status="active", eintritt=date(2027, 1, 1))
        z = (await als(CLAIMS_KPI,
                       "select * from public.kpi_hr_belegschaft(2026, 2)"))[0]
        assert z["gesamt"] == 1        # nur Person 1, trotz `inactive`
        assert z["stichtag"] == date(2026, 6, 30)

    async def test_neu_und_bestand_teilen_die_menge(self, db):
        await person(1, eintritt=date(2020, 1, 1))
        await person(2, eintritt=date(2026, 5, 5))     # im zweiten Quartal
        z = (await als(CLAIMS_KPI,
                       "select * from public.kpi_hr_belegschaft(2026, 2)"))[0]
        assert (z["gesamt"], z["neu"], z["bestand"]) == (2, 1, 1)

    async def test_austritt_vor_dem_stichtag_zaehlt_nicht(self, db):
        await person(1, eintritt=date(2020, 1, 1), austritt=date(2026, 3, 1))
        z = (await als(CLAIMS_KPI,
                       "select * from public.kpi_hr_belegschaft(2026, 2)"))[0]
        assert z["gesamt"] == 0

    async def test_ganzes_jahr_ohne_quartal(self, db):
        await person(1, eintritt=date(2026, 2, 1))
        z = (await als(CLAIMS_KPI, "select * from public.kpi_hr_belegschaft(2026)"))[0]
        assert z["neu"] == 1

    async def test_ohne_kpi_recht_nichts(self, db):
        await person(1)
        z = (await als(CLAIMS_LEER, "select * from public.kpi_hr_belegschaft()"))[0]
        assert z["gesamt"] == 0

    async def test_leere_belegschaft_gibt_eine_zeile_mit_null(self, db):
        """Nicht null Zeilen: sonst zeigt das Dashboard nichts statt „0"."""
        zeilen = await als(CLAIMS_KPI, "select * from public.kpi_hr_belegschaft()")
        assert len(zeilen) == 1
        assert (zeilen[0]["gesamt"], zeilen[0]["neu"], zeilen[0]["bestand"]) == (0, 0, 0)


class TestVerteilung:
    async def test_drei_verteilungen_ueber_dieselbe_menge(self, db):
        await person(1, abteilung="Fertigung",
                     raw=roh(gender={"value": "male"},
                             dynamic_1={"label": "Art der Beschäftigung", "value": "Vollzeit"}))
        await person(2, abteilung="Montage",
                     raw=roh(gender={"value": "female"},
                             dynamic_1={"label": "Art der Beschäftigung", "value": "Teilzeit"}))
        await person(3, abteilung="Montage",
                     raw=roh(employment_type={"value": "external"}))
        zeilen = await als(CLAIMS_KPI, "select * from public.kpi_hr_belegschaft_verteilung()")
        nach = {(z["art"], z["kategorie"]): z["anzahl"] for z in zeilen}

        assert nach[("geschlecht", "maennlich")] == 1
        assert nach[("geschlecht", "weiblich")] == 1
        assert nach[("geschlecht", "unbekannt")] == 1      # der Externe
        assert nach[("beschaeftigung", "vollzeit")] == 1
        assert nach[("beschaeftigung", "teilzeit")] == 1
        assert nach[("beschaeftigung", "extern")] == 1
        assert nach[("abteilung", "Montage")] == 2
        assert nach[("abteilung", "Fertigung")] == 1

        # Jede Verteilung zaehlt dieselbe Grundmenge.
        for a in ("geschlecht", "beschaeftigung", "abteilung"):
            assert sum(z["anzahl"] for z in zeilen if z["art"] == a) == 3

    async def test_ohne_abteilung_sonstige(self, db):
        await person(1, abteilung=None)
        zeilen = await als(CLAIMS_KPI, "select * from public.kpi_hr_belegschaft_verteilung()")
        assert any(z["kategorie"] == "Sonstige" for z in zeilen if z["art"] == "abteilung")


class TestKompetenz:
    async def _felder(self, werte: list[str]) -> None:
        async with SessionLocal() as s:
            async with s.begin():
                await s.execute(
                    sa.text("update public.hr_einstellungen set werte = :w"
                            " where schluessel = 'kompetenz_attribute'"),
                    {"w": werte},
                )

    async def test_ohne_felder_keine_quote(self, db):
        await person(1)
        z = (await als(CLAIMS_KPI, "select * from public.kpi_hr_kompetenz(null)"))[0]
        assert z["eingerichtet"] is False
        assert z["quote"] is None

    async def test_ein_gepflegtes_feld_genuegt(self, db):
        await self._felder(["schweissen", "cnc"])
        await person(1, raw=roh(cnc={"value": "Stufe 2"}))
        await person(2, raw=roh(cnc={"value": None}))
        await person(3, raw=roh())
        z = (await als(CLAIMS_KPI, "select * from public.kpi_hr_kompetenz(null)"))[0]
        assert (z["mit_kompetenz"], z["aktive"]) == (1, 3)
        assert round(z["quote"], 4) == round(Decimal(1) / Decimal(3), 4)

    async def test_leerer_text_zaehlt_nicht(self, db):
        await self._felder(["cnc"])
        await person(1, raw=roh(cnc={"value": "   "}))
        z = (await als(CLAIMS_KPI, "select * from public.kpi_hr_kompetenz(null)"))[0]
        assert z["mit_kompetenz"] == 0

    async def test_stichtag_grenzt_die_aktiven_ein(self, db):
        await self._felder(["cnc"])
        await person(1, raw=roh(cnc={"value": "ja"}), eintritt=date(2027, 1, 1))
        z = (await als(CLAIMS_KPI,
                       "select * from public.kpi_hr_kompetenz(cast('2026-06-30' as date))"))[0]
        assert z["aktive"] == 0
        assert z["quote"] is None
