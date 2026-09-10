"""Ladenhüter im Einkauf.

Diese Kennzahl weicht von allen anderen ab, und genau darin liegen die
Fallstricke:

* Der **Zeitraum des Dashboards wird ignoriert**. Der Bestand ist ein
  Stichtagswert; was im März im Regal lag, sagt der Bewegungsverlauf nicht.
* Es gibt **keinen Buchtyp-Filter**. Jede Bewegung zählt, auch Zugänge.
* Nur Artikel, deren Nummer mit `L` beginnt, sind Lagerartikel.
* Ohne Preiszeile fällt ein Artikel still heraus. Es gibt hier keine Quote,
  die dadurch geschönt würde.
"""
from __future__ import annotations

import datetime as dt
from decimal import Decimal

import pytest
import pytest_asyncio
import sqlalchemy as sa

from app.db import SessionLocal, material_movements, stock_article_prices
from app.parsing.lagerpreise import parse_lagerpreise

JETZT = dt.datetime.now(dt.timezone.utc)
HEUTE = dt.date.today()
I = "int"


def vor(tage: int) -> dt.date:
    return HEUTE - dt.timedelta(days=tage)


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
                    artikelnr=artikel, buch_datum=datum,
                    bewegungsmenge=Decimal(menge), buchtyp=buchtyp, imported_at=JETZT,
                )
            )


async def _preis(artikel: str, preis: str, name: str = "Teil"):
    async with SessionLocal() as session:
        async with session.begin():
            await session.execute(
                sa.insert(stock_article_prices).values(
                    artnr=artikel, unit_price=Decimal(preis), article_name=name, updated_at=JETZT,
                )
            )


@pytest_asyncio.fixture
async def leer(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")
    async with SessionLocal() as session:
        async with session.begin():
            await session.execute(sa.delete(material_movements))
            await session.execute(sa.delete(stock_article_prices))
    return True


class TestPreisliste:
    def test_stueckpreis_aus_wert_und_preismenge(self):
        kopf = "Artikelnr3\tWert\tPreismenge\tPreiseinheit\tBezeichnung 1"
        (row,), fehler = parse_lagerpreise((kopf + "\nL-100\t250,00\t100\tStk\tSchraube\n").encode())
        assert fehler == []
        assert row["unit_price"] == Decimal("2.5")

    def test_ohne_preismenge_gilt_der_wert_je_stueck(self):
        kopf = "Artikelnr3\tWert\tPreismenge\tPreiseinheit\tBezeichnung 1"
        (row,), _ = parse_lagerpreise((kopf + "\nL-100\t2,50\t\tStk\tSchraube\n").encode())
        assert row["unit_price"] == Decimal("2.5")

    def test_staffelzeilen_werden_uebergangen(self):
        """Die erste Zeile je Artikel gewinnt — die Lagerbewertung nimmt den Grundpreis."""
        kopf = "Artikelnr3\tWert\tPreismenge\tPreiseinheit\tBezeichnung 1"
        rows, _ = parse_lagerpreise(
            (kopf + "\nL-100\t250,00\t100\tStk\tSchraube\nL-100\t200,00\t100\tStk\tSchraube ab 500\n").encode()
        )
        assert len(rows) == 1 and rows[0]["unit_price"] == Decimal("2.5")


class TestAuswahl:
    async def test_nur_lagerartikel(self, leer):
        await _preis("L-1", "10")
        await _preis("M-1", "10")
        await _bewegung("L-1", vor(90), "100")
        await _bewegung("M-1", vor(90), "100")
        zeilen = await _funktion("kpi_einkauf_ladenhueter", (28, I), (20, I))
        assert [z["artnr"] for z in zeilen] == ["L-1"]

    async def test_frisch_bewegte_artikel_sind_keine_ladenhueter(self, leer):
        await _preis("L-1", "10")
        await _bewegung("L-1", vor(90), "100")
        await _bewegung("L-1", vor(5), "10")
        assert await _funktion("kpi_einkauf_ladenhueter", (28, I), (20, I)) == []

    async def test_ohne_bestand_kein_ladenhueter(self, leer):
        await _preis("L-1", "10")
        await _bewegung("L-1", vor(90), "100")
        await _bewegung("L-1", vor(80), "-100")
        assert await _funktion("kpi_einkauf_ladenhueter", (28, I), (20, I)) == []

    async def test_ohne_preis_faellt_der_artikel_still_heraus(self, leer):
        await _bewegung("L-1", vor(90), "100")
        assert await _funktion("kpi_einkauf_ladenhueter", (28, I), (20, I)) == []

    async def test_grenze_ist_einstellbar(self, leer):
        await _preis("L-1", "10")
        await _bewegung("L-1", vor(40), "100")
        assert len(await _funktion("kpi_einkauf_ladenhueter", (60, I), (20, I))) == 0
        assert len(await _funktion("kpi_einkauf_ladenhueter", (30, I), (20, I))) == 1


class TestBestand:
    async def test_alle_buchtypen_zaehlen(self, leer):
        """Kein Filter: ein Zugang erhöht den Bestand wie eine Entnahme ihn senkt."""
        await _preis("L-1", "2")
        await _bewegung("L-1", vor(90), "500", "WE")
        await _bewegung("L-1", vor(85), "-200", "M")
        zeilen = await _funktion("kpi_einkauf_ladenhueter", (28, I), (20, I))
        assert float(zeilen[0]["bestand"]) == 300.0
        assert float(zeilen[0]["wert"]) == 600.0

    async def test_liegetage_zaehlen_ab_der_letzten_bewegung(self, leer):
        await _preis("L-1", "1")
        await _bewegung("L-1", vor(200), "50")
        await _bewegung("L-1", vor(120), "50")
        zeilen = await _funktion("kpi_einkauf_ladenhueter", (28, I), (20, I))
        assert zeilen[0]["tage_liegend"] == 120


class TestReihung:
    async def test_groesster_wert_zuerst(self, leer):
        await _preis("L-1", "1")
        await _preis("L-2", "100")
        await _bewegung("L-1", vor(90), "500")   # 500
        await _bewegung("L-2", vor(90), "50")    # 5000
        zeilen = await _funktion("kpi_einkauf_ladenhueter", (28, I), (20, I))
        assert [z["artnr"] for z in zeilen] == ["L-2", "L-1"]

    async def test_grenze_deckelt_die_zeilen(self, leer):
        for i in range(25):
            await _preis(f"L-{i}", "1")
            await _bewegung(f"L-{i}", vor(90), str(100 + i))
        assert len(await _funktion("kpi_einkauf_ladenhueter", (28, I), (20, I))) == 20
