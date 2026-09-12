"""Prüfmengen und Ausschussquote.

Eigenheiten des Rechenwegs, die man beim Lesen des SQL übersieht:

* Der Nenner ist je Größenklasse die Zahl der tatsächlich vorkommenden
  (Prüfer, Prüftag)-Paare dieser Klasse; Gesamt hat einen eigenen Nenner über
  alle Buchungen. Groß + Klein ergibt deshalb nicht Gesamt. Das frühere
  Kreuzprodukt „Prüfer × Prüftage" zählte Paare mit, an denen niemand geprüft
  hat, und drückte die Kennzahl um das Drei- bis Sechsfache.
* Gerundet wird auf eine Nachkommastelle, die Hälfte zur geraden Stelle — wie
  Pythons `round(x, 1)` im Altprojekt.
* Ohne Buchungen steht 0 in der Kachel, nicht ein Strich.
* Nur `rsc = '70000'` ist eine Qualitätsprüfung. Alles andere ist eine
  Sonderbuchung und zählt weder im Zähler noch im Nenner.
* Halbfertig heißt: die Artikelnummer beginnt mit „H“. Vorgabe ist „fertig“.
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


D, I, N, S = "date", "int", "numeric", "text"


async def _buchung(
    datum: dt.date,
    benutzer: str,
    menge: str,
    klasse: str = "large",
    rsc: str = "70000",
    ausschuss: str | None = None,
    excluded: bool = False,
    bezeichnung: str = "Teil",
    artikel: str | None = None,
):
    async with SessionLocal() as session:
        async with session.begin():
            await session.execute(
                sa.insert(inspection_records).values(
                    pruef_datum=datum,
                    benutzer=benutzer,
                    bezeichnung=bezeichnung,
                    artikel=artikel,
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
    """Nenner je Größenklasse: die tatsächlich vorkommenden (Prüfer, Prüftag)-Paare
    dieser Klasse; Gesamt hat seinen eigenen Nenner über alle Buchungen."""

    async def test_nenner_je_klasse_aus_pruefer_tagen(self, leer):
        await _buchung(dt.date(2026, 3, 1), "anna", "400", "large")
        await _buchung(dt.date(2026, 3, 2), "anna", "400", "large")
        await _buchung(dt.date(2026, 3, 1), "bert", "300", "small")
        (row,) = await _funktion("kpi_qualitaet_pruefmengen", (None, D), (None, D), ("fertig", S))
        assert (row["personentage_gross"], row["personentage_klein"], row["personentage_gesamt"]) == (2, 1, 3)
        # Das Kreuzprodukt 2 Prüfer × 2 Tage ergäbe 200 und 75.
        assert float(row["gross"]) == 400.0
        assert float(row["klein"]) == 300.0

    async def test_gesamt_ist_weder_summe_noch_mittel(self, leer):
        await _buchung(dt.date(2026, 3, 1), "anna", "400", "large")
        await _buchung(dt.date(2026, 3, 2), "anna", "400", "large")
        await _buchung(dt.date(2026, 3, 1), "bert", "300", "small")
        (row,) = await _funktion("kpi_qualitaet_pruefmengen", (None, D), (None, D), ("fertig", S))
        assert float(row["gesamt"]) == 366.7   # 1100 / 3

    async def test_derselbe_pruefer_am_selben_tag_zaehlt_einmal(self, leer):
        await _buchung(dt.date(2026, 3, 1), "anna", "100", "large")
        await _buchung(dt.date(2026, 3, 1), "anna", "50", "large")
        await _buchung(dt.date(2026, 3, 1), "anna", "30", "small")
        (row,) = await _funktion("kpi_qualitaet_pruefmengen", (None, D), (None, D), ("fertig", S))
        assert (row["personentage_gross"], row["personentage_klein"], row["personentage_gesamt"]) == (1, 1, 1)
        assert float(row["gross"]) == 150.0
        assert float(row["gesamt"]) == 180.0

    async def test_sonderbuchungen_zaehlen_nirgends(self, leer):
        await _buchung(dt.date(2026, 3, 1), "anna", "100", "large")
        await _buchung(dt.date(2026, 3, 2), "bert", "999", "large", rsc="80000")
        (row,) = await _funktion("kpi_qualitaet_pruefmengen", (None, D), (None, D), ("fertig", S))
        assert row["personentage_gesamt"] == 1
        assert float(row["gross"]) == 100.0

    async def test_ausgeschlossene_buchungen_zaehlen_nirgends(self, leer):
        await _buchung(dt.date(2026, 3, 1), "anna", "100", "large")
        await _buchung(dt.date(2026, 3, 2), "bert", "500", "large", excluded=True)
        (row,) = await _funktion("kpi_qualitaet_pruefmengen", (None, D), (None, D), ("fertig", S))
        assert row["personentage_gesamt"] == 1
        assert float(row["gross"]) == 100.0

    async def test_ohne_buchungen_steht_null_in_der_kachel(self, leer):
        """Eine Zeile mit 0 und null Prüfer-Tagen — so war es im Altprojekt."""
        (row,) = await _funktion("kpi_qualitaet_pruefmengen", (None, D), (None, D), ("fertig", S))
        assert (float(row["gross"]), float(row["klein"]), float(row["gesamt"])) == (0.0, 0.0, 0.0)
        assert row["personentage_gesamt"] == 0

    async def test_klasse_ohne_buchung_hat_null_und_keine_pruefer_tage(self, leer):
        await _buchung(dt.date(2026, 3, 1), "anna", "100", "large")
        (row,) = await _funktion("kpi_qualitaet_pruefmengen", (None, D), (None, D), ("fertig", S))
        assert float(row["klein"]) == 0.0 and row["personentage_klein"] == 0

    async def test_zeitfenster(self, leer):
        await _buchung(dt.date(2026, 3, 1), "anna", "100", "large")
        await _buchung(dt.date(2026, 4, 1), "anna", "900", "large")
        (row,) = await _funktion(
            "kpi_qualitaet_pruefmengen", (dt.date(2026, 3, 1), D), (dt.date(2026, 3, 31), D), ("fertig", S)
        )
        assert float(row["gross"]) == 100.0

    @pytest.mark.parametrize(
        "menge,tage,erwartet",
        [
            ("1", 4, 0.2),    # 0,25 → zur geraden Stelle ab, wie Pythons round(x, 1)
            ("3", 4, 0.8),    # 0,75 → zur geraden Stelle auf
            ("10", 3, 3.3),
            ("20", 3, 6.7),
        ],
    )
    async def test_rundet_auf_eine_nachkommastelle(self, leer, menge, tage, erwartet):
        await _buchung(dt.date(2026, 3, 1), "anna", menge, "large")
        for tag in range(2, tage + 1):
            await _buchung(dt.date(2026, 3, tag), "anna", "0", "large")
        (row,) = await _funktion("kpi_qualitaet_pruefmengen", (None, D), (None, D), ("fertig", S))
        assert float(row["gross"]) == erwartet


class TestArtikelart:
    """Halbfertig heißt: Artikelnummer beginnt mit „H“. Alles andere ist fertig,
    auch eine fehlende Nummer. Die Größenklasse ist eine andere Frage."""

    async def _bestand(self):
        await _buchung(dt.date(2026, 3, 1), "anna", "100", "large", artikel="H123")
        await _buchung(dt.date(2026, 3, 1), "bert", "50", "large", artikel="A77")
        await _buchung(dt.date(2026, 3, 1), "carl", "30", "small", artikel=None)
        await _buchung(dt.date(2026, 3, 1), "dora", "20", "small", artikel="h9")

    async def test_fertig_ist_die_vorgabe(self, leer):
        await self._bestand()
        (row,) = await _funktion("kpi_qualitaet_pruefmengen", (None, D), (None, D), ("fertig", S))
        assert float(row["gross"]) == 50.0
        assert float(row["klein"]) == 30.0   # fehlende Artikelnummer zählt als fertig
        assert row["personentage_gesamt"] == 2

    async def test_halbfertig_ohne_ruecksicht_auf_gross_und_klein(self, leer):
        await self._bestand()
        (row,) = await _funktion("kpi_qualitaet_pruefmengen", (None, D), (None, D), ("halbfertig", S))
        assert float(row["gross"]) == 100.0
        assert float(row["klein"]) == 20.0   # auch kleingeschrieben
        assert row["personentage_gesamt"] == 2

    async def test_alle(self, leer):
        await self._bestand()
        (row,) = await _funktion("kpi_qualitaet_pruefmengen", (None, D), (None, D), ("alle", S))
        assert float(row["gross"]) == 75.0    # 150 / 2
        assert float(row["gesamt"]) == 50.0   # 200 / 4

    async def test_buchungen_folgen_der_artikelart(self, leer):
        await self._bestand()
        zeilen = await _funktion("kpi_qualitaet_buchungen", (None, D), (None, D), ("halbfertig", S))
        assert sorted(z["artikel"] for z in zeilen) == ["H123", "h9"]

    async def test_verlauf_folgt_der_artikelart(self, leer):
        await self._bestand()
        (punkt,) = await _funktion(
            "kpi_qualitaet_pruefmengen_verlauf", (None, D), (None, D), ("month", S), ("halbfertig", S)
        )
        assert float(punkt["gross"]) == 100.0


class TestVerlauf:
    async def test_jeder_bucket_hat_eigene_nenner(self, leer):
        await _buchung(dt.date(2026, 3, 1), "anna", "400", "large")
        await _buchung(dt.date(2026, 3, 2), "anna", "400", "large")
        await _buchung(dt.date(2026, 4, 1), "bert", "300", "small")
        zeilen = await _funktion(
            "kpi_qualitaet_pruefmengen_verlauf", (None, D), (None, D), ("month", S), ("fertig", S)
        )
        nach = {z["bucket"]: z for z in zeilen}
        maerz, april = nach[dt.date(2026, 3, 1)], nach[dt.date(2026, 4, 1)]
        assert (float(maerz["gross"]), maerz["personentage_gross"]) == (400.0, 2)
        assert (float(maerz["klein"]), maerz["personentage_klein"]) == (0.0, 0)
        assert (float(april["gesamt"]), april["personentage_gesamt"]) == (300.0, 1)

    async def test_bucket_entspricht_der_kachel_ueber_dasselbe_fenster(self, leer):
        await _buchung(dt.date(2026, 3, 1), "anna", "10", "large")
        await _buchung(dt.date(2026, 3, 5), "bert", "25", "small")
        await _buchung(dt.date(2026, 3, 9), "anna", "7", "small")
        (punkt,) = await _funktion(
            "kpi_qualitaet_pruefmengen_verlauf", (None, D), (None, D), ("month", S), ("fertig", S)
        )
        (kachel,) = await _funktion(
            "kpi_qualitaet_pruefmengen", (dt.date(2026, 3, 1), D), (dt.date(2026, 3, 31), D), ("fertig", S)
        )
        for feld in ("gross", "klein", "gesamt", "personentage_gesamt"):
            assert punkt[feld] == kachel[feld]

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
        zeilen = await _funktion("kpi_qualitaet_buchungen", (None, D), (None, D), ("fertig", S))
        assert len(zeilen) == 1 and zeilen[0]["excluded"] is True

    async def test_sonderbuchungen_stehen_nicht_drin(self, leer):
        await _buchung(dt.date(2026, 3, 1), "anna", "100", rsc="80000")
        assert await _funktion("kpi_qualitaet_buchungen", (None, D), (None, D), ("fertig", S)) == []

    async def test_ohne_obergrenze(self, leer):
        """Die Tabelle blättert selbst; 500 abgeschnittene Zeilen sähen vollständig aus."""
        async with SessionLocal() as session:
            async with session.begin():
                await session.execute(
                    sa.insert(inspection_records),
                    [
                        {
                            "pruef_datum": dt.date(2026, 3, 1),
                            "benutzer": "anna",
                            "buchungs_menge": Decimal("1"),
                            "size_class": "large",
                            "rsc": "70000",
                            "excluded": False,
                            "imported_at": JETZT,
                        }
                    ]
                    * 501,
                )
        zeilen = await _funktion("kpi_qualitaet_buchungen", (None, D), (None, D), ("fertig", S))
        assert len(zeilen) == 501

    async def test_neueste_zuerst(self, leer):
        await _buchung(dt.date(2026, 3, 1), "anna", "900")
        await _buchung(dt.date(2026, 3, 5), "anna", "1")
        zeilen = await _funktion("kpi_qualitaet_buchungen", (None, D), (None, D), ("fertig", S))
        assert [z["pruef_datum"] for z in zeilen] == [dt.date(2026, 3, 5), dt.date(2026, 3, 1)]
