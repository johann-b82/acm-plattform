"""Prüfmengen und Ausschussquote.

Vier Eigenheiten des Rechenwegs, die man beim Lesen des SQL übersieht:

* Der Nenner ist **gemeinsam** über beide Größenklassen: Prüfer mal Prüftage.
  Die Kennzahl heißt „Produkte je Tag und Mitarbeiter", und dieselben Leute
  prüfen an denselben Tagen beides.
* Gerundet wird zur geraden Zahl, wie Pythons `round()`. Postgres rundet die
  Hälfte sonst vom Nullpunkt weg, und die Kacheln wichen um eins ab.
* Ohne Prüfer oder Prüftage steht 0 in der Kachel, nicht ein Strich.
* Nur `rsc = '70000'` ist eine Qualitätsprüfung. Alles andere ist eine
  Sonderbuchung und zählt weder im Zähler noch im Nenner.
"""
from __future__ import annotations

import datetime as dt
from decimal import Decimal

import pytest
import pytest_asyncio
import sqlalchemy as sa

from app.db import SessionLocal, inspection_records
from app.parsing.pruefungen import groessenklasse

JETZT = dt.datetime.now(dt.timezone.utc)


async def _funktion(name: str, *args: tuple[object, str]) -> list[dict]:
    async with SessionLocal() as session:
        platzhalter = ", ".join(f"cast(:p{i} as {typ})" for i, (_, typ) in enumerate(args))
        rows = await session.execute(
            sa.text(f"select * from public.{name}({platzhalter})"),
            {f"p{i}": wert for i, (wert, _) in enumerate(args)},
        )
        return [dict(r) for r in rows.mappings()]


D, I, N = "date", "int", "numeric"


async def _buchung(
    datum: dt.date,
    benutzer: str,
    menge: str,
    klasse: str = "large",
    rsc: str = "70000",
    ausschuss: str | None = None,
    excluded: bool = False,
    bezeichnung: str = "Teil",
):
    async with SessionLocal() as session:
        async with session.begin():
            await session.execute(
                sa.insert(inspection_records).values(
                    pruef_datum=datum,
                    benutzer=benutzer,
                    bezeichnung=bezeichnung,
                    buchungs_menge=Decimal(menge),
                    ausschuss_menge=Decimal(ausschuss) if ausschuss else None,
                    size_class=klasse,
                    rsc=rsc,
                    excluded=excluded,
                    imported_at=JETZT,
                )
            )


@pytest_asyncio.fixture
async def leer(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")
    async with SessionLocal() as session:
        async with session.begin():
            await session.execute(sa.delete(inspection_records))
    return True


class TestGroessenklasse:
    @pytest.mark.parametrize(
        "bezeichnung,produktgruppe,erwartet",
        [
            ("Beliebiges Teil", "LITPOC_DIEHL", "small"),
            ("Beliebiges Teil", "KLEINT_DIEHL", "small"),
            ("Literature Pocket blau", "", "small"),
            ("Lit Pocket", "", "small"),
            ("STRAP 25mm", "", "small"),
            ("Strap, kurz", "", "small"),
            ("Lederriemen", "", "small"),
            ("Stowage Pouch", "", "small"),
            ("Aufbewahrungstasche", "", "small"),
            ("Netztasche", "", "small"),
            ("Leder mit Netztaschen", "", "small"),
            ("Sitzbezug", "STANDARD", "large"),
            ("Gehäuse", "", "large"),
        ],
    )
    def test_regeln(self, bezeichnung, produktgruppe, erwartet):
        assert groessenklasse(bezeichnung, produktgruppe) == erwartet

    def test_netz_braucht_einen_wortanfang(self):
        """Sonst zählte „Internet" und „Kabinett" als kleines Produkt."""
        assert groessenklasse("Internet-Modul", "") == "large"
        assert groessenklasse("Kabinett", "") == "large"

    def test_produktgruppe_schlaegt_bezeichnung(self):
        assert groessenklasse("Sitzbezug", "KLEINT_DIEHL") == "small"


class TestRundung:
    @pytest.mark.parametrize(
        "wert,erwartet",
        [
            ("2.5", 2),   # zur geraden Zahl ab
            ("3.5", 4),   # zur geraden Zahl auf
            ("0.5", 0),
            ("1.5", 2),
            ("2.4", 2),
            ("2.6", 3),
            ("-2.5", -2),
            ("7", 7),
        ],
    )
    async def test_rundet_zur_geraden_zahl(self, leer, wert, erwartet):
        (row,) = await _funktion("runde_zur_geraden", (Decimal(wert), N))
        assert row["runde_zur_geraden"] == erwartet


class TestPruefmengen:
    async def test_gemeinsamer_nenner_ueber_beide_klassen(self, leer):
        """Zwei Prüfer an zwei Tagen ergeben den Teiler 4 — für beide Klassen."""
        await _buchung(dt.date(2026, 3, 1), "anna", "400", "large")
        await _buchung(dt.date(2026, 3, 1), "bert", "400", "small")
        await _buchung(dt.date(2026, 3, 2), "anna", "400", "large")
        await _buchung(dt.date(2026, 3, 2), "bert", "400", "small")
        (row,) = await _funktion("kpi_qualitaet_pruefmengen", (None, D), (None, D))
        assert (row["pruefer"], row["prueftage"]) == (2, 2)
        assert row["gross"] == 200   # 800 / 4
        assert row["klein"] == 200   # 800 / 4

    async def test_sonderbuchungen_zaehlen_nirgends(self, leer):
        await _buchung(dt.date(2026, 3, 1), "anna", "100", "large")
        await _buchung(dt.date(2026, 3, 2), "bert", "999", "large", rsc="80000")
        (row,) = await _funktion("kpi_qualitaet_pruefmengen", (None, D), (None, D))
        # Der Sonderbucher taucht weder im Zähler noch im Nenner auf.
        assert (row["pruefer"], row["prueftage"]) == (1, 1)
        assert row["gross"] == 100

    async def test_ausgeschlossene_buchungen_zaehlen_nirgends(self, leer):
        await _buchung(dt.date(2026, 3, 1), "anna", "100", "large")
        await _buchung(dt.date(2026, 3, 2), "bert", "500", "large", excluded=True)
        (row,) = await _funktion("kpi_qualitaet_pruefmengen", (None, D), (None, D))
        assert (row["pruefer"], row["prueftage"]) == (1, 1)
        assert row["gross"] == 100

    async def test_ohne_buchungen_steht_null_in_der_kachel(self, leer):
        """Nicht NULL — die Kachel zeigt eine Null, so war es im Altprojekt."""
        zeilen = await _funktion("kpi_qualitaet_pruefmengen", (None, D), (None, D))
        assert zeilen == [] or (zeilen[0]["gross"] == 0 and zeilen[0]["klein"] == 0)

    async def test_zeitfenster(self, leer):
        await _buchung(dt.date(2026, 3, 1), "anna", "100", "large")
        await _buchung(dt.date(2026, 4, 1), "anna", "900", "large")
        (row,) = await _funktion("kpi_qualitaet_pruefmengen", (dt.date(2026, 3, 1), D), (dt.date(2026, 3, 31), D))
        assert row["gross"] == 100

    async def test_rundung_wirkt_auf_das_ergebnis(self, leer):
        """5 / 2 = 2,5 → 2, nicht 3."""
        await _buchung(dt.date(2026, 3, 1), "anna", "5", "large")
        await _buchung(dt.date(2026, 3, 2), "anna", "0", "large")
        (row,) = await _funktion("kpi_qualitaet_pruefmengen", (None, D), (None, D))
        assert (row["pruefer"], row["prueftage"]) == (1, 2)
        assert row["gross"] == 2


class TestAusschussquote:
    async def test_quote_je_bezeichnung(self, leer):
        await _buchung(dt.date(2026, 3, 1), "anna", "200", ausschuss="10", bezeichnung="Deckel")
        await _buchung(dt.date(2026, 3, 2), "anna", "300", ausschuss="15", bezeichnung="Deckel")
        (row,) = await _funktion("kpi_qualitaet_ausschuss", (None, D), (None, D), (500, I))
        assert row["bezeichnung"] == "Deckel"
        assert float(row["quote"]) == 0.05

    async def test_ohne_buchungsmenge_keine_quote(self, leer):
        await _buchung(dt.date(2026, 3, 1), "anna", "0", ausschuss="5", bezeichnung="Rest")
        (row,) = await _funktion("kpi_qualitaet_ausschuss", (None, D), (None, D), (500, I))
        assert row["quote"] is None

    async def test_groesste_menge_zuerst(self, leer):
        await _buchung(dt.date(2026, 3, 1), "anna", "100", bezeichnung="Klein")
        await _buchung(dt.date(2026, 3, 1), "anna", "900", bezeichnung="Gross")
        zeilen = await _funktion("kpi_qualitaet_ausschuss", (None, D), (None, D), (500, I))
        assert [z["bezeichnung"] for z in zeilen] == ["Gross", "Klein"]


class TestBuchungsliste:
    async def test_zeigt_auch_ausgeschlossene(self, leer):
        """Sonst liesse sich ein Haken nicht wieder entfernen."""
        await _buchung(dt.date(2026, 3, 1), "anna", "100", excluded=True)
        zeilen = await _funktion("kpi_qualitaet_buchungen", (None, D), (None, D), (500, I))
        assert len(zeilen) == 1 and zeilen[0]["excluded"] is True

    async def test_sonderbuchungen_stehen_nicht_drin(self, leer):
        await _buchung(dt.date(2026, 3, 1), "anna", "100", rsc="80000")
        assert await _funktion("kpi_qualitaet_buchungen", (None, D), (None, D), (500, I)) == []
