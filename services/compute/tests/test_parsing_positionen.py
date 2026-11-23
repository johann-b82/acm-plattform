"""Parser der beiden Positions-Exporte — reine Funktionen, keine Datenbank."""
import io
from datetime import date, datetime
from decimal import Decimal

import openpyxl
import pandas as pd

from app.parsing.positionen import parse_auftrag_positionen, parse_lieferscheine

SPALTEN = [
    "Typ", "Vorgang Nr.", "Pos", "UPos", "Datum", "Lieferdatum", "Adr Nr.", "Name 1",
    "Ort", "Artnr", "Version", "Bezeichnung 1", "Menge", "ME", "Preis", "Pos Wert",
    "Pos Typ 2", "Fremdnr", "Auftrag",
]


def zeile(**werte) -> list[str]:
    return [str(werte.get(s, "")) for s in SPALTEN]


def txt(*zeilen: list[str]) -> bytes:
    inhalt = "\t".join(SPALTEN) + "\n" + "\n".join("\t".join(z) for z in zeilen) + "\n"
    return inhalt.encode("utf-8")


def xlsx(*zeilen: list[str]) -> bytes:
    puffer = io.BytesIO()
    pd.DataFrame(list(zeilen), columns=SPALTEN).to_excel(puffer, index=False)
    return puffer.getvalue()


class TestAuftragPositionen:
    def test_lieferdatum_ist_der_zieltermin(self):
        (row,), fehler = parse_auftrag_positionen(
            txt(zeile(**{"Typ": "AUF", "Vorgang Nr.": "A-1", "Pos": "10", "Lieferdatum": "15.03.2026"}))
        )
        assert fehler == []
        assert row["lieferdatum"] == date(2026, 3, 15)
        assert "delivery_date" not in row

    def test_andere_vorgangstypen_werden_uebergangen(self):
        """Der Export kann auch Angebote und Lieferscheine enthalten."""
        rows, fehler = parse_auftrag_positionen(
            txt(
                zeile(**{"Typ": "AUF", "Vorgang Nr.": "A-1", "Pos": "10", "Lieferdatum": "15.03.2026"}),
                zeile(**{"Typ": "ANG", "Vorgang Nr.": "N-1", "Pos": "10", "Lieferdatum": "15.03.2026"}),
                zeile(**{"Typ": "LS", "Vorgang Nr.": "L-1", "Pos": "10", "Lieferdatum": "15.03.2026"}),
            )
        )
        assert [r["vorgang_nr"] for r in rows] == ["A-1"]
        assert fehler == []

    def test_leere_typspalte_wird_durchgelassen(self):
        """Ältere Exporte haben die Spalte nicht."""
        rows, _ = parse_auftrag_positionen(
            txt(zeile(**{"Vorgang Nr.": "A-1", "Pos": "10", "Lieferdatum": "15.03.2026"}))
        )
        assert len(rows) == 1

    def test_merkmal_seriengeschaeft_wird_uebernommen(self):
        (row,), _ = parse_auftrag_positionen(
            txt(zeile(**{"Typ": "AUF", "Vorgang Nr.": "A-1", "Pos": "10", "Pos Typ 2": "SG"}))
        )
        assert row["pos_typ_2"] == "SG"

    def test_position_ohne_lieferdatum_bleibt_leer(self):
        """Sie fällt später aus dem Zieltermin heraus, nicht schon hier."""
        (row,), fehler = parse_auftrag_positionen(
            txt(zeile(**{"Typ": "AUF", "Vorgang Nr.": "A-1", "Pos": "10"}))
        )
        assert fehler == []
        assert row["lieferdatum"] is None

    def test_zahlen_und_mengen(self):
        (row,), _ = parse_auftrag_positionen(
            txt(zeile(**{"Typ": "AUF", "Vorgang Nr.": "A-1", "Pos": "10", "Menge": "1.250,500", "Pos Wert": "12.345,67"}))
        )
        assert row["quantity"] == Decimal("1250.500")
        assert row["position_value"] == Decimal("12345.67")

    def test_doppelte_position_ist_ein_fehler(self):
        rows, fehler = parse_auftrag_positionen(
            txt(
                zeile(**{"Typ": "AUF", "Vorgang Nr.": "A-1", "Pos": "10", "UPos": "0"}),
                zeile(**{"Typ": "AUF", "Vorgang Nr.": "A-1", "Pos": "10", "UPos": "0"}),
            )
        )
        assert len(rows) == 1 and "doppelt" in fehler[0]["message"]

    def test_fehlende_pflichtspalte(self):
        rows, fehler = parse_auftrag_positionen(b"Typ\tPos\nAUF\t10\n")
        assert rows == []
        assert fehler[0]["field"] == "header"


class TestLieferscheine:
    def test_lieferdatum_ist_das_ist_datum(self):
        (row,), fehler = parse_lieferscheine(
            xlsx(zeile(**{"Typ": "LS", "Vorgang Nr.": "L-1", "Pos": "10", "Lieferdatum": "20.03.2026", "Auftrag": "A-1"}))
        )
        assert fehler == []
        assert row["delivery_date"] == date(2026, 3, 20)
        assert "lieferdatum" not in row

    def test_auftragsnummer_ist_der_join_schluessel(self):
        (row,), _ = parse_lieferscheine(
            xlsx(zeile(**{"Typ": "LS", "Vorgang Nr.": "L-1", "Pos": "10", "Auftrag": "A-1", "Fremdnr": "K-77"}))
        )
        assert row["order_nr"] == "A-1"
        assert row["external_order_nr"] == "K-77"

    def test_nur_lieferscheine_zaehlen(self):
        rows, _ = parse_lieferscheine(
            xlsx(
                zeile(**{"Typ": "LS", "Vorgang Nr.": "L-1", "Pos": "10"}),
                zeile(**{"Typ": "AUF", "Vorgang Nr.": "A-1", "Pos": "10"}),
            )
        )
        assert [r["vorgang_nr"] for r in rows] == ["L-1"]

    def test_kaputte_datei_meldet_sich(self):
        rows, fehler = parse_lieferscheine(b"das ist keine Excel-Datei")
        assert rows == []
        assert fehler[0]["field"] == "file"


def xlsx_typisiert(*zeilen: dict) -> bytes:
    """Excel-Datei wie aus dem ERP: echte Datums- und Zahlzellen, nicht nur Text.

    Werte, die als `str` übergeben werden, landen als Textzelle in der Datei —
    auch `="…"`, das openpyxl sonst als Formel speichern würde.
    """
    mappe = openpyxl.Workbook()
    blatt = mappe.active
    blatt.append(SPALTEN)
    for nr, werte in enumerate(zeilen, start=2):
        for sp, name in enumerate(SPALTEN, start=1):
            wert = werte.get(name)
            if wert is None:
                continue
            zelle = blatt.cell(row=nr, column=sp, value=wert)
            if isinstance(wert, str):
                zelle.data_type = "s"
    puffer = io.BytesIO()
    mappe.save(puffer)
    return puffer.getvalue()


class TestLieferscheineMitZelltypen:
    """Regression: die ERP-Excel-Datei hat echte Datums- und Zahlzellen.

    Früher wurde alles als Text gelesen — aus dem Datum wurde
    `2026-09-01 00:00:00` (kein Lieferdatum), aus `552.12` die Zahl 55212.
    """

    def test_datums_und_zahlzellen_behalten_ihren_wert(self):
        (row,), fehler = parse_lieferscheine(
            xlsx_typisiert(
                {
                    "Typ": "LS", "Vorgang Nr.": "L-1", "Pos": 10, "UPos": 0,
                    "Datum": datetime(2026, 9, 1), "Lieferdatum": datetime(2026, 9, 2, 14, 30),
                    "Menge": 6.5, "Preis": 552.12, "Pos Wert": 3588.78, "Auftrag": "A-1",
                }
            )
        )
        assert fehler == []
        assert row["pos"] == 10
        assert row["upos"] == 0
        assert row["entry_date"] == date(2026, 9, 1)
        assert row["delivery_date"] == date(2026, 9, 2)
        assert row["quantity"] == Decimal("6.5")
        assert row["price"] == Decimal("552.12")
        assert row["position_value"] == Decimal("3588.78")
        assert row["raw"]["Lieferdatum"] == "02.09.2026"

    def test_ganze_zahlen_und_datum_ohne_uhrzeit(self):
        (row,), _ = parse_lieferscheine(
            xlsx_typisiert(
                {"Typ": "LS", "Vorgang Nr.": 4711, "Pos": 20, "Lieferdatum": date(2026, 9, 3), "Menge": 1250}
            )
        )
        assert row["vorgang_nr"] == "4711"
        assert row["delivery_date"] == date(2026, 9, 3)
        assert row["quantity"] == Decimal("1250")

    def test_textzellen_bleiben_deutsch(self):
        (row,), fehler = parse_lieferscheine(
            xlsx_typisiert(
                {
                    "Typ": "LS", "Vorgang Nr.": '="L-2"', "Pos": "10",
                    "Datum": "01.09.2026", "Lieferdatum": "02.09.2026",
                    "Menge": "1.234,5", "Preis": "6,50", "Pos Wert": '="8.024,25"',
                }
            )
        )
        assert fehler == []
        assert row["vorgang_nr"] == "L-2"
        assert row["entry_date"] == date(2026, 9, 1)
        assert row["delivery_date"] == date(2026, 9, 2)
        assert row["quantity"] == Decimal("1234.5")
        assert row["price"] == Decimal("6.50")
        assert row["position_value"] == Decimal("8024.25")

    def test_gemischte_zeilen_in_einer_datei(self):
        rows, fehler = parse_lieferscheine(
            xlsx_typisiert(
                {"Typ": "LS", "Vorgang Nr.": "L-1", "Pos": 10, "Lieferdatum": datetime(2026, 9, 2), "Menge": 6.5},
                {"Typ": "LS", "Vorgang Nr.": "L-1", "Pos": "20", "Lieferdatum": "03.09.2026", "Menge": "6,5"},
                {"Typ": "LS", "Vorgang Nr.": "L-1", "Pos": 30},
            )
        )
        assert fehler == []
        assert [r["delivery_date"] for r in rows] == [date(2026, 9, 2), date(2026, 9, 3), None]
        assert [r["quantity"] for r in rows] == [Decimal("6.5"), Decimal("6.5"), None]
