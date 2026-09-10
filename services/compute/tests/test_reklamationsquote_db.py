"""Reklamationsquote (On Quality) gegen eine echte Datenbank.

Vier Stellen des Rechenwegs sind nicht selbsterklärend und haben je einen Test:

* Die Quelle schreibt jede Reklamationsart in zwei Schreibweisen; beide
  gehören in denselben Topf.
* Interne Reklamationen werden an den **Kundenlieferungen** gemessen. Eine
  andere Bezugsgröße gibt es nicht.
* Lieferanten und Werkbänke teilen sich die Wareneingänge; die Warengruppe
  trennt sie, und eine leere Warengruppe zählt zu den Lieferanten.
* Zähler und Nenner haben verschiedene Datumsfelder. Eine Reklamation kann in
  einem anderen Zeitraum liegen als die Lieferung, auf die sie sich bezieht.
"""
from __future__ import annotations

import datetime as dt
from decimal import Decimal

import pytest
import pytest_asyncio
import sqlalchemy as sa

from app.db import SessionLocal, delivery_records, goods_receipt_records, quality_records

JETZT = dt.datetime.now(dt.timezone.utc)


async def _funktion(name: str, *args: tuple[object, str]) -> list[dict]:
    async with SessionLocal() as session:
        platzhalter = ", ".join(f"cast(:p{i} as {typ})" for i, (_, typ) in enumerate(args))
        rows = await session.execute(
            sa.text(f"select * from public.{name}({platzhalter})"),
            {f"p{i}": wert for i, (wert, _) in enumerate(args)},
        )
        return [dict(r) for r in rows.mappings()]


S, D = "text", "date"


async def _reklamation(nr: str, art: str, datum: dt.date, menge: str, akzeptiert: str | None = None):
    async with SessionLocal() as session:
        async with session.begin():
            await session.execute(
                sa.insert(quality_records).values(
                    report_nr=nr,
                    report_date=datum,
                    art=art,
                    quantity=Decimal(menge),
                    accepted_quantity=Decimal(akzeptiert) if akzeptiert else None,
                    imported_at=JETZT,
                )
            )


async def _lieferung(nr: str, datum: dt.date, menge: str):
    async with SessionLocal() as session:
        async with session.begin():
            await session.execute(
                sa.insert(delivery_records).values(
                    vorgang_nr=nr, pos=10, upos=0, typ="LS",
                    delivery_date=datum, quantity=Decimal(menge), imported_at=JETZT,
                )
            )


async def _wareneingang(nr: str, datum: dt.date, menge: str, warengruppe: str | None):
    async with SessionLocal() as session:
        async with session.begin():
            await session.execute(
                sa.insert(goods_receipt_records).values(
                    vorgang_nr=nr, pos=10, upos=0, typ="WE",
                    receipt_date=datum, quantity=Decimal(menge),
                    material_group=warengruppe, imported_at=JETZT,
                )
            )


@pytest_asyncio.fixture
async def leer(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")
    async with SessionLocal() as session:
        async with session.begin():
            await session.execute(sa.delete(quality_records))
            await session.execute(sa.delete(delivery_records))
            await session.execute(sa.delete(goods_receipt_records))
    return True


class TestSchreibweisen:
    async def test_beide_schreibweisen_zaehlen_zusammen(self, leer):
        await _reklamation("R-1", "KUNRE", dt.date(2026, 3, 1), "30")
        await _reklamation("R-2", "KUN RE", dt.date(2026, 3, 2), "20")
        await _lieferung("L-1", dt.date(2026, 3, 1), "1000")
        (row,) = await _funktion("kpi_qualitaet_reklamationen", ("kunde", S), ("gesamt", S), (None, D), (None, D))
        assert float(row["reklamiert"]) == 50.0
        assert float(row["quote"]) == 0.05

    async def test_unbekannte_art_zaehlt_nichts(self, leer):
        await _lieferung("L-1", dt.date(2026, 3, 1), "1000")
        (row,) = await _funktion("kpi_qualitaet_reklamationen", ("erfunden", S), ("gesamt", S), (None, D), (None, D))
        assert float(row["reklamiert"]) == 0.0
        assert row["quote"] is None  # kein Nenner für eine unbekannte Art


class TestBezugsgroesse:
    async def test_intern_misst_an_kundenlieferungen(self, leer):
        """Bewusst dieselbe Bezugsgröße wie beim Kunden."""
        await _reklamation("R-1", "INT RE", dt.date(2026, 3, 1), "40")
        await _lieferung("L-1", dt.date(2026, 3, 1), "800")
        (row,) = await _funktion("kpi_qualitaet_reklamationen", ("intern", S), ("gesamt", S), (None, D), (None, D))
        assert float(row["bezugsmenge"]) == 800.0
        assert float(row["quote"]) == 0.05

    async def test_lieferant_nimmt_material_ohne_dienstleistung(self, leer):
        await _reklamation("R-1", "LIE RE", dt.date(2026, 3, 1), "10")
        await _wareneingang("W-1", dt.date(2026, 3, 1), "600", "ROH")
        await _wareneingang("W-2", dt.date(2026, 3, 1), "400", "DIENST")
        (row,) = await _funktion("kpi_qualitaet_reklamationen", ("lieferant", S), ("gesamt", S), (None, D), (None, D))
        assert float(row["bezugsmenge"]) == 600.0

    async def test_werkbank_nimmt_genau_die_dienstleistungen(self, leer):
        await _reklamation("R-1", "UA RE", dt.date(2026, 3, 1), "20")
        await _wareneingang("W-1", dt.date(2026, 3, 1), "600", "ROH")
        await _wareneingang("W-2", dt.date(2026, 3, 1), "300", "DIENST")
        await _wareneingang("W-3", dt.date(2026, 3, 1), "100", "SERVIC")
        (row,) = await _funktion("kpi_qualitaet_reklamationen", ("werkbank", S), ("gesamt", S), (None, D), (None, D))
        assert float(row["bezugsmenge"]) == 400.0

    async def test_leere_warengruppe_zaehlt_zu_den_lieferanten(self, leer):
        """Ohne Angabe ist es Material, nicht Dienstleistung."""
        await _wareneingang("W-1", dt.date(2026, 3, 1), "500", None)
        (row,) = await _funktion("kpi_qualitaet_reklamationen", ("lieferant", S), ("gesamt", S), (None, D), (None, D))
        assert float(row["bezugsmenge"]) == 500.0
        (werkbank,) = await _funktion("kpi_qualitaet_reklamationen", ("werkbank", S), ("gesamt", S), (None, D), (None, D))
        assert float(werkbank["bezugsmenge"]) == 0.0


class TestMengenart:
    async def test_akzeptierte_menge_statt_gemeldeter(self, leer):
        await _reklamation("R-1", "KUNRE", dt.date(2026, 3, 1), "100", akzeptiert="60")
        await _lieferung("L-1", dt.date(2026, 3, 1), "1000")
        (gesamt,) = await _funktion("kpi_qualitaet_reklamationen", ("kunde", S), ("gesamt", S), (None, D), (None, D))
        (akzeptiert,) = await _funktion("kpi_qualitaet_reklamationen", ("kunde", S), ("akzeptiert", S), (None, D), (None, D))
        assert float(gesamt["reklamiert"]) == 100.0
        assert float(akzeptiert["reklamiert"]) == 60.0

    async def test_fehlende_akzeptierte_menge_zaehlt_nicht_als_null(self, leer):
        """Eine Zeile ohne Zahl geht nicht als 0 in die Summe ein."""
        await _reklamation("R-1", "KUNRE", dt.date(2026, 3, 1), "100", akzeptiert="60")
        await _reklamation("R-2", "KUNRE", dt.date(2026, 3, 2), "50", akzeptiert=None)
        await _lieferung("L-1", dt.date(2026, 3, 1), "1000")
        (row,) = await _funktion("kpi_qualitaet_reklamationen", ("kunde", S), ("akzeptiert", S), (None, D), (None, D))
        assert float(row["reklamiert"]) == 60.0


class TestZeitfenster:
    async def test_zaehler_und_nenner_haben_eigene_datumsfelder(self, leer):
        """Eine Reklamation kann in einem anderen Monat liegen als die Lieferung."""
        await _reklamation("R-1", "KUNRE", dt.date(2026, 4, 5), "50")
        await _lieferung("L-1", dt.date(2026, 3, 20), "1000")
        (april,) = await _funktion(
            "kpi_qualitaet_reklamationen", ("kunde", S), ("gesamt", S),
            (dt.date(2026, 4, 1), D), (dt.date(2026, 4, 30), D),
        )
        assert float(april["reklamiert"]) == 50.0
        assert float(april["bezugsmenge"]) == 0.0
        assert april["quote"] is None  # Nenner 0 ergibt NULL, nicht unendlich

    async def test_ohne_bezugsmenge_keine_quote(self, leer):
        await _reklamation("R-1", "KUNRE", dt.date(2026, 3, 1), "50")
        (row,) = await _funktion("kpi_qualitaet_reklamationen", ("kunde", S), ("gesamt", S), (None, D), (None, D))
        assert row["quote"] is None


class TestVerlauf:
    async def test_bucket_ohne_reklamation_hat_quote_null(self, leer):
        await _lieferung("L-1", dt.date(2026, 3, 1), "1000")
        await _reklamation("R-1", "KUNRE", dt.date(2026, 4, 2), "50")
        await _lieferung("L-2", dt.date(2026, 4, 1), "500")
        zeilen = await _funktion(
            "kpi_qualitaet_reklamationen_verlauf", ("kunde", S), ("gesamt", S),
            (None, D), (None, D), ("month", S),
        )
        nach = {z["bucket"]: z for z in zeilen}
        assert float(nach[dt.date(2026, 3, 1)]["quote"]) == 0.0
        assert float(nach[dt.date(2026, 4, 1)]["quote"]) == 0.1

    async def test_bucket_ohne_bezugsmenge_bleibt_leer(self, leer):
        await _reklamation("R-1", "KUNRE", dt.date(2026, 5, 2), "50")
        zeilen = await _funktion(
            "kpi_qualitaet_reklamationen_verlauf", ("kunde", S), ("gesamt", S),
            (None, D), (None, D), ("month", S),
        )
        assert zeilen[0]["quote"] is None


class TestZielwerte:
    async def test_vier_zielwerte_sind_dazugekommen(self, leer):
        async with SessionLocal() as session:
            zeilen = await session.execute(
                sa.text(
                    "select schluessel, wert from public.zielwerte"
                    " where schluessel like 'qualitaet_reklamation_%' order by 1"
                )
            )
            nach = {r[0]: float(r[1]) for r in zeilen}
        assert nach == {
            "qualitaet_reklamation_intern": 0.04,
            "qualitaet_reklamation_kunde": 0.02,
            "qualitaet_reklamation_lieferant": 0.02,
            "qualitaet_reklamation_werkbank": 0.05,
        }
