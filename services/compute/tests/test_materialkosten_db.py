"""Materialkostenquote.

Vier Stellen, an denen der Rechenweg eine Entscheidung trifft:

* Die Preisliste ist **fensterunabhängig**: auch eine Auswertung über den
  Januar rechnet mit dem jüngsten bekannten Preis. So ist es im Altprojekt.
* Der Preis kommt aus Wert geteilt durch Menge, nicht aus der Preisspalte —
  die kann sich auf 100 oder 1000 Stück beziehen.
* Ein Artikel **ohne** Preis wird nicht mit null bewertet, sondern
  ausgelassen und gezählt. Sonst sähe die Quote besser aus, als sie ist.
* Ein Artikel mit Nettoverbrauch null fällt heraus, auch wenn er Bewegungen
  hatte: Entnahme und Storno heben sich auf.
"""
from __future__ import annotations

import datetime as dt
from decimal import Decimal

import pytest
import pytest_asyncio
import sqlalchemy as sa

from app.db import SessionLocal, goods_receipt_records, material_movements, revenues

JETZT = dt.datetime.now(dt.timezone.utc)
D, I = "date", "int"


async def _funktion(name: str, *args: tuple[object, str]) -> list[dict]:
    async with SessionLocal() as session:
        platzhalter = ", ".join(f"cast(:p{i} as {typ})" for i, (_, typ) in enumerate(args))
        rows = await session.execute(
            sa.text(f"select * from public.{name}({platzhalter})"),
            {f"p{i}": wert for i, (wert, _) in enumerate(args)},
        )
        return [dict(r) for r in rows.mappings()]


async def _bewegung(artikel: str, datum: dt.date, menge: str, buchtyp: str = "M"):
    async with SessionLocal() as session:
        async with session.begin():
            await session.execute(
                sa.insert(material_movements).values(
                    artikelnr=artikel, article_name=f"Artikel {artikel}",
                    buch_datum=datum, bewegungsmenge=Decimal(menge),
                    buchtyp=buchtyp, imported_at=JETZT,
                )
            )


async def _preiszeile(artikel: str, datum: dt.date, menge: str, wert: str, nr: str):
    async with SessionLocal() as session:
        async with session.begin():
            await session.execute(
                sa.insert(goods_receipt_records).values(
                    vorgang_nr=nr, pos=10, upos=0, typ="WE",
                    receipt_date=datum, article_number=artikel,
                    quantity=Decimal(menge), position_value=Decimal(wert),
                    imported_at=JETZT,
                )
            )


async def _umsatz(nr: str, datum: dt.date, wert: str):
    async with SessionLocal() as session:
        async with session.begin():
            await session.execute(
                sa.insert(revenues).values(
                    vorgang_nr=nr, typ="RG", datum=datum, wert_eur=Decimal(wert),
                    imported_at=JETZT,
                )
            )


@pytest_asyncio.fixture
async def leer(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")
    async with SessionLocal() as session:
        async with session.begin():
            await session.execute(sa.delete(material_movements))
            await session.execute(sa.delete(goods_receipt_records))
            await session.execute(sa.delete(revenues))
    return True


class TestPreisliste:
    async def test_juengste_zeile_gewinnt(self, leer):
        await _preiszeile("A-1", dt.date(2026, 1, 10), "100", "500", "W-1")   # 5,00
        await _preiszeile("A-1", dt.date(2026, 5, 10), "100", "700", "W-2")   # 7,00
        async with SessionLocal() as session:
            preis = await session.scalar(
                sa.text("select stueckpreis from public.artikel_preise where artikelnr = 'A-1'")
            )
        assert float(preis) == 7.0

    async def test_menge_null_wird_uebergangen(self, leer):
        """Sonst teilte die Sicht durch null."""
        await _preiszeile("A-1", dt.date(2026, 5, 10), "0", "700", "W-1")
        await _preiszeile("A-1", dt.date(2026, 1, 10), "100", "500", "W-2")
        async with SessionLocal() as session:
            preis = await session.scalar(
                sa.text("select stueckpreis from public.artikel_preise where artikelnr = 'A-1'")
            )
        assert float(preis) == 5.0

    async def test_preisliste_ist_fensterunabhaengig(self, leer):
        """Der Januar wird mit dem Maipreis bewertet — wie im Altprojekt."""
        await _preiszeile("A-1", dt.date(2026, 5, 10), "100", "700", "W-1")
        await _bewegung("A-1", dt.date(2026, 1, 15), "-10")
        await _umsatz("R-1", dt.date(2026, 1, 20), "1000")
        (row,) = await _funktion(
            "kpi_finanzen_materialkosten", (dt.date(2026, 1, 1), D), (dt.date(2026, 1, 31), D)
        )
        assert float(row["materialkosten"]) == 70.0


class TestVerbrauch:
    async def test_entnahme_und_storno_heben_sich_auf(self, leer):
        await _preiszeile("A-1", dt.date(2026, 1, 1), "100", "500", "W-1")
        await _bewegung("A-1", dt.date(2026, 3, 1), "-10", "M")
        await _bewegung("A-1", dt.date(2026, 3, 2), "10", "SM")
        await _umsatz("R-1", dt.date(2026, 3, 5), "1000")
        (row,) = await _funktion("kpi_finanzen_materialkosten", (None, D), (None, D))
        assert float(row["materialkosten"]) == 0.0
        assert row["ohne_preis"] == 0  # der Artikel fällt ganz heraus

    async def test_andere_buchtypen_zaehlen_nicht(self, leer):
        await _preiszeile("A-1", dt.date(2026, 1, 1), "100", "500", "W-1")
        await _bewegung("A-1", dt.date(2026, 3, 1), "-10", "M")
        await _bewegung("A-1", dt.date(2026, 3, 2), "-90", "WE")
        await _umsatz("R-1", dt.date(2026, 3, 5), "1000")
        (row,) = await _funktion("kpi_finanzen_materialkosten", (None, D), (None, D))
        assert float(row["materialkosten"]) == 50.0

    async def test_mehr_storno_als_entnahme_ergibt_negative_kosten(self, leer):
        """Kein Schutzgriff: das Vorzeichen ist eine Aussage über die Daten."""
        await _preiszeile("A-1", dt.date(2026, 1, 1), "100", "500", "W-1")
        await _bewegung("A-1", dt.date(2026, 3, 1), "-10", "M")
        await _bewegung("A-1", dt.date(2026, 3, 2), "30", "SM")
        await _umsatz("R-1", dt.date(2026, 3, 5), "1000")
        (row,) = await _funktion("kpi_finanzen_materialkosten", (None, D), (None, D))
        assert float(row["materialkosten"]) == -100.0


class TestArtikelOhnePreis:
    async def test_werden_ausgelassen_und_gezaehlt(self, leer):
        await _preiszeile("A-1", dt.date(2026, 1, 1), "100", "500", "W-1")
        await _bewegung("A-1", dt.date(2026, 3, 1), "-10")
        await _bewegung("A-2", dt.date(2026, 3, 1), "-99")   # kein Preis
        await _umsatz("R-1", dt.date(2026, 3, 5), "1000")
        (row,) = await _funktion("kpi_finanzen_materialkosten", (None, D), (None, D))
        assert float(row["materialkosten"]) == 50.0
        assert row["ohne_preis"] == 1

    async def test_stehen_in_der_pruefliste_am_ende(self, leer):
        await _preiszeile("A-1", dt.date(2026, 1, 1), "100", "500", "W-1")
        await _bewegung("A-1", dt.date(2026, 3, 1), "-10")
        await _bewegung("A-2", dt.date(2026, 3, 1), "-99")
        zeilen = await _funktion("kpi_finanzen_materialverbrauch", (None, D), (None, D), (500, I))
        assert [z["artikelnr"] for z in zeilen] == ["A-1", "A-2"]
        assert zeilen[1]["stueckpreis"] is None


class TestQuote:
    async def test_kosten_durch_umsatz(self, leer):
        await _preiszeile("A-1", dt.date(2026, 1, 1), "100", "500", "W-1")
        await _bewegung("A-1", dt.date(2026, 3, 1), "-40")     # 200 Kosten
        await _umsatz("R-1", dt.date(2026, 3, 5), "1000")
        (row,) = await _funktion("kpi_finanzen_materialkosten", (None, D), (None, D))
        assert float(row["quote"]) == 0.2

    async def test_ohne_umsatz_keine_quote(self, leer):
        await _preiszeile("A-1", dt.date(2026, 1, 1), "100", "500", "W-1")
        await _bewegung("A-1", dt.date(2026, 3, 1), "-40")
        (row,) = await _funktion("kpi_finanzen_materialkosten", (None, D), (None, D))
        assert row["quote"] is None
        assert float(row["materialkosten"]) == 200.0

    async def test_gutschriften_mindern_den_umsatz(self, leer):
        await _preiszeile("A-1", dt.date(2026, 1, 1), "100", "500", "W-1")
        await _bewegung("A-1", dt.date(2026, 3, 1), "-40")
        await _umsatz("R-1", dt.date(2026, 3, 5), "1000")
        await _umsatz("G-1", dt.date(2026, 3, 6), "-500")
        (row,) = await _funktion("kpi_finanzen_materialkosten", (None, D), (None, D))
        assert float(row["umsatz"]) == 500.0
        assert float(row["quote"]) == 0.4


class TestVerlauf:
    async def test_je_monat(self, leer):
        await _preiszeile("A-1", dt.date(2026, 1, 1), "100", "500", "W-1")
        await _bewegung("A-1", dt.date(2026, 3, 1), "-20")
        await _umsatz("R-1", dt.date(2026, 3, 5), "1000")
        await _bewegung("A-1", dt.date(2026, 4, 1), "-40")
        await _umsatz("R-2", dt.date(2026, 4, 5), "1000")
        zeilen = await _funktion("kpi_finanzen_materialkosten_verlauf", (None, D), (None, D), ("month", "text"))
        nach = {z["bucket"]: z for z in zeilen}
        assert float(nach[dt.date(2026, 3, 1)]["quote"]) == 0.1
        assert float(nach[dt.date(2026, 4, 1)]["quote"]) == 0.2

    async def test_monat_ohne_umsatz_bleibt_leer(self, leer):
        await _preiszeile("A-1", dt.date(2026, 1, 1), "100", "500", "W-1")
        await _bewegung("A-1", dt.date(2026, 3, 1), "-20")
        zeilen = await _funktion("kpi_finanzen_materialkosten_verlauf", (None, D), (None, D), ("month", "text"))
        assert zeilen[0]["quote"] is None
