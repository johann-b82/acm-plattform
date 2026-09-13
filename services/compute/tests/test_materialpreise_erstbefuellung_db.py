"""Erstbefüllung der Materialpreise aus den Wareneingängen (Migration 0043).

Ein Übergang: bis zum ersten Upload „Materialpreise (Wareneingang)" bzw. zur
Übernahme soll die Materialkostenquote nicht auf null fallen. Befüllt wird nur,
was in `material_prices` noch fehlt — ein vorhandener Materialpreis bleibt, und
ein späterer Upload überschreibt die Übergangszeilen per Upsert.

Getestet wird die SQL der Migration selbst, nicht eine Nachbildung.
"""
from __future__ import annotations

import datetime as dt
import importlib.util
from decimal import Decimal
from pathlib import Path

import pytest
import pytest_asyncio
import sqlalchemy as sa

from app.db import (
    SessionLocal,
    goods_receipt_records,
    material_movements,
    material_prices,
    revenues,
)

_PFAD = Path(__file__).parents[1] / "alembic" / "versions" / "0043_materialpreise.py"
_spec = importlib.util.spec_from_file_location("migration_0043", _PFAD)
_modul = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_modul)
ERSTBEFUELLUNG: str = _modul.ERSTBEFUELLUNG

JETZT = dt.datetime.now(dt.timezone.utc)


@pytest_asyncio.fixture
async def leer(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")
    async with SessionLocal() as session:
        async with session.begin():
            for tabelle in (material_prices, goods_receipt_records, material_movements, revenues):
                await session.execute(sa.delete(tabelle))
    return True


async def _wareneingang(nr: str, pos: int, artikel: str | None, eingang: dt.date, liefer: dt.date,
                        menge: str, wert: str) -> None:
    async with SessionLocal() as session:
        async with session.begin():
            await session.execute(
                sa.insert(goods_receipt_records).values(
                    vorgang_nr=nr, pos=pos, upos=0, typ="WE", entry_date=eingang,
                    receipt_date=liefer, article_number=artikel, article_name="Flügelmutter",
                    quantity=Decimal(menge), unit="STK", price=Decimal("1"),
                    position_value=Decimal(wert), imported_at=JETZT, raw={"Datum": "x"},
                )
            )


async def _befuellen() -> None:
    async with SessionLocal() as session:
        async with session.begin():
            await session.execute(sa.text(ERSTBEFUELLUNG))


async def _zeilen() -> dict[tuple, dict]:
    async with SessionLocal() as session:
        rows = (await session.execute(sa.select(material_prices))).mappings().all()
    return {(r["vorgang_nr"], r["pos"], r["upos"]): dict(r) for r in rows}


async def test_uebernimmt_die_wareneingaenge_mit_eingangsdatum(leer):
    await _wareneingang("W-1", 1, "A-1", dt.date(2026, 3, 2), dt.date(2026, 3, 9), "100", "500")
    await _befuellen()
    zeile = (await _zeilen())[("W-1", 1, 0)]
    # Datum ist das Wareneingangsdatum (Spalte „Datum"), nicht das Lieferdatum.
    assert zeile["datum"] == dt.date(2026, 3, 2)
    assert (zeile["artnr"], zeile["menge"], zeile["pos_wert"]) == ("A-1", Decimal("100.000"), Decimal("500.00"))
    assert zeile["article_name"] == "Flügelmutter"
    # Kein Protokoll eines Materialpreis-Uploads — die Zeile stammt aus keinem.
    assert zeile["upload_batch_id"] is None


async def test_ohne_artikelnummer_keine_zeile(leer):
    await _wareneingang("W-1", 1, None, dt.date(2026, 3, 2), dt.date(2026, 3, 2), "1", "5")
    await _befuellen()
    assert await _zeilen() == {}


async def test_ueberschreibt_vorhandene_materialpreise_nicht(leer):
    async with SessionLocal() as session:
        async with session.begin():
            await session.execute(
                sa.insert(material_prices).values(
                    vorgang_nr="W-1", pos=1, upos=0, datum=dt.date(2026, 3, 2), artnr="A-1",
                    menge=Decimal("100"), pos_wert=Decimal("700"), imported_at=JETZT,
                )
            )
    await _wareneingang("W-1", 1, "A-1", dt.date(2026, 3, 2), dt.date(2026, 3, 2), "100", "500")
    await _wareneingang("W-2", 1, "A-2", dt.date(2026, 3, 3), dt.date(2026, 3, 3), "10", "30")
    await _befuellen()
    await _befuellen()  # zweimal ist wie einmal
    zeilen = await _zeilen()
    assert len(zeilen) == 2
    assert zeilen[("W-1", 1, 0)]["pos_wert"] == Decimal("700.00")
    assert zeilen[("W-2", 1, 0)]["pos_wert"] == Decimal("30.00")


async def test_materialkosten_sind_danach_nicht_null(leer):
    await _wareneingang("W-1", 1, "A-1", dt.date(2026, 1, 10), dt.date(2026, 1, 10), "100", "500")
    async with SessionLocal() as session:
        async with session.begin():
            await session.execute(
                sa.insert(material_movements).values(
                    artikelnr="A-1", buch_datum=dt.date(2026, 3, 1), bewegungsmenge=Decimal("-10"),
                    buchtyp="M", imported_at=JETZT,
                )
            )
            await session.execute(
                sa.insert(revenues).values(
                    vorgang_nr="R-1", typ="RG", datum=dt.date(2026, 3, 5), wert_eur=Decimal("1000"),
                    imported_at=JETZT,
                )
            )

    async def kosten() -> Decimal:
        async with SessionLocal() as session:
            return (
                await session.execute(sa.text("select materialkosten from public.kpi_finanzen_materialkosten(null, null)"))
            ).scalar_one()

    assert await kosten() == 0
    await _befuellen()
    assert await kosten() == Decimal("50")
