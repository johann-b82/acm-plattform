"""Parser der Vertriebs-Exporte — reine Funktionen, keine Datenbank."""
from datetime import date
from decimal import Decimal

import pytest

from app.parsing.german import parse_date, parse_decimal
from app.parsing.vertrieb import parse_auftraege, parse_umsatz

KOPF_RG = "Typ\tVorgang Nr.\tDatum\tAdr Nr.\tName 1\tWert"
KOPF_AUF = "Typ\tVorgang Nr.\tDatum\tAdr Nr.\tName 1\tErfasst durch\tWert"


def rg(*zeilen: str) -> bytes:
    return ("\n".join([KOPF_RG, *zeilen]) + "\n").encode("utf-8")


def auf(*zeilen: str) -> bytes:
    return ("\n".join([KOPF_AUF, *zeilen]) + "\n").encode("utf-8")


class TestDeutscheFormate:
    @pytest.mark.parametrize(
        "roh,erwartet",
        [
            ("1.234,56", Decimal("1234.56")),
            ("-500,00", Decimal("-500.00")),
            ("0,01", Decimal("0.01")),
            ("1.000.000,00", Decimal("1000000.00")),
            ("42", Decimal("42")),
        ],
    )
    def test_zahlen(self, roh, erwartet):
        assert parse_decimal(roh) == erwartet

    @pytest.mark.parametrize("roh", ["", "   ", "abc", "1,2,3"])
    def test_ungueltige_zahlen(self, roh):
        assert parse_decimal(roh) is None

    def test_datum(self):
        assert parse_date("31.12.2026") == date(2026, 12, 31)
        assert parse_date(" 01.02.2026 ") == date(2026, 2, 1)
        assert parse_date("2026-12-31") is None
        assert parse_date("") is None


class TestUmsatz:
    def test_rechnung_und_gutschrift(self):
        rows, fehler = parse_umsatz(
            rg(
                "RG\tR-1\t15.01.2026\t1000\tMüller GmbH\t1.234,56",
                "GS\tG-1\t20.01.2026\t1000\tMüller GmbH\t-234,56",
            )
        )
        assert fehler == []
        assert [r["vorgang_nr"] for r in rows] == ["R-1", "G-1"]
        # Gutschrift bleibt negativ, damit die Summe netto ist.
        assert sum(r["wert_eur"] for r in rows) == Decimal("1000.00")
        assert rows[0]["customer_name"] == "Müller GmbH"
        assert rows[0]["datum"] == date(2026, 1, 15)
        assert "erfasser" not in rows[0]

    def test_leerzeilen_am_ende_werden_uebersprungen(self):
        rows, fehler = parse_umsatz(rg("RG\tR-1\t15.01.2026\t1000\tKunde\t100,00", "\t\t\t\t\t", ""))
        assert len(rows) == 1
        assert fehler == []

    def test_fehlerhafte_zeilen_werden_gemeldet_und_uebersprungen(self):
        rows, fehler = parse_umsatz(
            rg(
                "RG\tR-1\t15.01.2026\t1000\tKunde\t100,00",
                "RG\t\t15.01.2026\t1000\tKunde\t100,00",
                "RG\tR-3\tkein-datum\t1000\tKunde\t100,00",
                "RG\tR-4\t15.01.2026\t1000\tKunde\tkeine-zahl",
                "\tR-5\t15.01.2026\t1000\tKunde\t100,00",
            )
        )
        assert [r["vorgang_nr"] for r in rows] == ["R-1"]
        assert [(f["row"], f["field"]) for f in fehler] == [
            (3, "Vorgang Nr."),
            (4, "Datum"),
            (5, "Wert"),
            (6, "Typ"),
        ]

    def test_doppelte_vorgangsnummer_letzte_gewinnt(self):
        """Wie der Upsert in der Datenbank: die letzte Zeile der Datei zählt."""
        rows, _ = parse_umsatz(
            rg(
                "RG\tR-1\t15.01.2026\t1000\tAlt\t100,00",
                "RG\tR-2\t16.01.2026\t1000\tAnderer\t50,00",
                "RG\tR-1\t17.01.2026\t1000\tNeu\t999,00",
            )
        )
        assert len(rows) == 3 - 1
        r1 = next(r for r in rows if r["vorgang_nr"] == "R-1")
        assert r1["customer_name"] == "Neu" and r1["wert_eur"] == Decimal("999.00")
        # Reihenfolge der übrigen Zeilen bleibt erhalten.
        assert [r["vorgang_nr"] for r in rows] == ["R-1", "R-2"]

    def test_fehlende_pflichtspalte(self):
        rows, fehler = parse_umsatz(b"Typ\tVorgang Nr.\tDatum\n" + "RG\tR-1\t15.01.2026\n".encode())
        assert rows == []
        assert fehler[0]["field"] == "header" and "Wert" in fehler[0]["message"]

    def test_latin1_wird_gelesen(self):
        daten = ("\n".join([KOPF_RG, "RG\tR-1\t15.01.2026\t1000\tMüller & Söhne\t100,00"]) + "\n").encode("latin-1")
        rows, fehler = parse_umsatz(daten)
        assert fehler == []
        assert rows[0]["customer_name"] == "Müller & Söhne"

    def test_vorgangsnummer_bleibt_text(self):
        """pandas darf aus 0012345 keine Zahl machen."""
        rows, _ = parse_umsatz(rg("RG\t0012345\t15.01.2026\t1000\tKunde\t100,00"))
        assert rows[0]["vorgang_nr"] == "0012345"


class TestAuftraege:
    def test_erfasser_wird_uebernommen(self):
        rows, fehler = parse_auftraege(
            auf("AUF\tA-1\t15.01.2026\t1000\tKunde\tSchmidt\t2.500,00")
        )
        assert fehler == []
        assert rows[0]["erfasser"] == "Schmidt"
        assert rows[0]["wert_eur"] == Decimal("2500.00")

    def test_fehlender_erfasser_ist_kein_fehler(self):
        rows, fehler = parse_auftraege(auf("AUF\tA-1\t15.01.2026\t1000\tKunde\t\t100,00"))
        assert fehler == []
        assert rows[0]["erfasser"] is None
