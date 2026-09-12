"""Parser der Materialpreise (Wareneingang) — reine Funktion, keine Datenbank.

Dieselbe Quelldatei `AswKpf_WE.txt` wie der Wareneingangsimport, aber eine
andere Verarbeitung: hier zählt das Wareneingangsdatum `Datum` (die erste der
beiden Datumsspalten), und die Zeile trägt Menge und Positionswert, aus denen
die Materialkostenquote den Stückpreis rechnet. Die Testdateien liegen unter
`tests/fixtures` und haben die Spaltennamen des echten Exports.
"""
from datetime import date
from decimal import Decimal
from pathlib import Path

from app.parsing.materialpreise import parse_materialpreise

FIXTURES = Path(__file__).parent / "fixtures"


def lies(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


class TestZeichencodierung:
    def test_cp1252_umlaute_und_eurozeichen(self):
        rows, fehler = parse_materialpreise(lies("materialpreise_cp1252.txt"))
        assert fehler == []
        namen = {r["artnr"]: r["article_name"] for r in rows}
        assert namen["A-100"] == "Flügelmutter M8"
        assert namen["L 9999"] == "1 x Lagerumschlag 15 € netto"

    def test_utf8_liefert_dieselben_zeilen(self):
        cp1252, _ = parse_materialpreise(lies("materialpreise_cp1252.txt"))
        utf8, fehler = parse_materialpreise(lies("materialpreise_utf8.txt"))
        assert fehler == []
        assert [(r["artnr"], r["article_name"], r["pos_wert"]) for r in utf8] == [
            (r["artnr"], r["article_name"], r["pos_wert"]) for r in cp1252
        ]


class TestFelder:
    def test_schluessel_und_preisfelder(self):
        rows, _ = parse_materialpreise(lies("materialpreise_cp1252.txt"))
        zeile = next(r for r in rows if r["artnr"] == "A-100")
        assert (zeile["vorgang_nr"], zeile["pos"], zeile["upos"]) == ("36390", 1, 0)
        assert zeile["typ"] == "WE"
        assert zeile["menge"] == Decimal("1000.000")
        assert zeile["unit"] == "STK"
        # Die Rohspalte Preis gilt hier je 100 Stück — sie wird mitgeführt,
        # aber der Stückpreis entsteht später aus Pos Wert / Menge.
        assert zeile["preis"] == Decimal("12.50")
        assert zeile["pos_wert"] == Decimal("1250.00")

    def test_datum_ist_das_wareneingangsdatum_nicht_das_bestelldatum(self):
        """Die Datei hat zwei Spalten „Datum"; die zweite ist das Bestelldatum."""
        rows, _ = parse_materialpreise(lies("materialpreise_cp1252.txt"))
        zeile = next(r for r in rows if r["artnr"] == "A-100")
        assert zeile["datum"] == date(2026, 7, 21)
        assert zeile["raw"]["Datum.1"] == "01.07.2026"

    def test_unterposition_leer_ist_null(self):
        rows, _ = parse_materialpreise(lies("materialpreise_cp1252.txt"))
        zeile = next(r for r in rows if r["artnr"] == "L 9999")
        assert zeile["upos"] == 0

    def test_rohzeile_bleibt_erhalten(self):
        rows, _ = parse_materialpreise(lies("materialpreise_cp1252.txt"))
        zeile = next(r for r in rows if r["artnr"] == "L 9999")
        assert zeile["raw"]["Name 1"] == "KLEX Klaus Exportverpackungen GmbH"

    def test_titelzeile_vor_dem_kopf_wird_uebersprungen(self):
        inhalt = "Auswertung Wareneingang\n".encode("cp1252") + lies("materialpreise_cp1252.txt")
        rows, fehler = parse_materialpreise(inhalt)
        assert fehler == []
        assert len(rows) == 3


class TestUngueltigeZeilen:
    def test_gueltige_bleiben_ungueltige_werden_gemeldet(self):
        rows, fehler = parse_materialpreise(lies("materialpreise_fehler.txt"))
        assert [r["artnr"] for r in rows] == ["B-1", "B-5"]
        # ohne Vorgang, Pos unlesbar, ohne Artikel, doppelt
        assert sorted(f["field"] for f in fehler) == ["Artnr", "Pos", "Vorgang Nr.", "Vorgang Nr."]

    def test_doppelter_schluessel_in_der_datei_ist_ein_fehler(self):
        """Die erste Zeile gilt; die zweite wird gemeldet, nicht still übernommen."""
        rows, fehler = parse_materialpreise(lies("materialpreise_fehler.txt"))
        assert sum(1 for r in rows if r["vorgang_nr"] == "50001") == 1
        assert any("doppelt" in f["message"] for f in fehler)

    def test_unlesbares_datum_bleibt_als_zeile_ohne_datum(self):
        """Wie im Altsystem: die Zeile kommt mit, zählt aber für keinen Preis."""
        rows, _ = parse_materialpreise(lies("materialpreise_fehler.txt"))
        zeile = next(r for r in rows if r["artnr"] == "B-5")
        assert zeile["datum"] is None

    def test_leerzeilen_zaehlen_nicht(self):
        _, fehler = parse_materialpreise(lies("materialpreise_fehler.txt"))
        assert all(f["row"] > 1 for f in fehler)

    def test_fehlende_pflichtspalte(self):
        rows, fehler = parse_materialpreise(b"Vorgang Nr.\tPos\n1\t1\n")
        assert rows == []
        assert fehler[0]["field"] == "header" and "Artnr" in fehler[0]["message"]

    def test_leere_datei(self):
        rows, fehler = parse_materialpreise(b"")
        assert rows == []
        assert fehler and fehler[0]["field"] in ("file", "header")
