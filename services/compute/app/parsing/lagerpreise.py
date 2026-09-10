"""Parser der Artikel-Preiskonditionen aus dem `AswLagBew`-Umfeld.

Trotz des Namens keine Bewegungsdatei, sondern eine Preisliste: eine Zeile je
Preiskondition. Der Stückpreis ist `Wert / Preismenge` — der Rohwert gilt je
100 oder 1000 Stück, deshalb die Division.

Je Artikel gewinnt die **erste** Zeile. Staffelpreise stehen als weitere
Zeilen darunter und werden übergangen; welche Staffel gilt, hängt von der
Bestellmenge ab, und die Lagerbewertung nimmt den Grundpreis.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Any

from app.parsing.german import parse_decimal, read_tabular

COL_ARTNR = "Artikelnr3"
COL_WERT = "Wert"
COL_PREISMENGE = "Preismenge"
COL_PREISEINHEIT = "Preiseinheit"
COL_BEZEICHNUNG = "Bezeichnung 1"

PFLICHT = (COL_ARTNR, COL_WERT, COL_PREISMENGE)

Row = dict[str, Any]
Fehler = dict[str, Any]


def _fehler(row: int, feld: str, text: str) -> Fehler:
    return {"row": row, "field": feld, "message": text}


def parse_lagerpreise(contents: bytes) -> tuple[list[Row], list[Fehler]]:
    try:
        df = read_tabular(contents)
    except ValueError as exc:
        return [], [_fehler(0, "file", str(exc))]

    fehlend = [c for c in PFLICHT if c not in df.columns]
    if fehlend:
        return [], [_fehler(0, "header", f"Fehlende Spalte(n): {', '.join(fehlend)}")]

    rows: list[Row] = []
    fehler: list[Fehler] = []
    gesehen: set[str] = set()

    for idx, raw_row in df.iterrows():
        zeile = int(idx) + 2
        row = {k: ("" if v is None else str(v)).strip() for k, v in raw_row.to_dict().items()}

        if not any(row.values()):
            continue

        artnr = row.get(COL_ARTNR, "")
        if not artnr:
            fehler.append(_fehler(zeile, COL_ARTNR, "Artikelnummer fehlt"))
            continue
        # Staffelpreise: die erste Zeile je Artikel gewinnt, still.
        if artnr in gesehen:
            continue
        gesehen.add(artnr)

        wert = parse_decimal(row.get(COL_WERT, ""))
        if wert is None:
            fehler.append(_fehler(zeile, COL_WERT, f"Wert unlesbar oder leer: '{row.get(COL_WERT, '')}'"))
            continue

        preismenge = parse_decimal(row.get(COL_PREISMENGE, ""))
        # Ohne Preismenge gilt der Wert je Stück; das ist die übliche Angabe
        # bei Artikeln, die einzeln geführt werden.
        if preismenge is None or preismenge == 0:
            preismenge = Decimal(1)

        rows.append(
            {
                "artnr": artnr,
                "unit_price": wert / preismenge,
                "price_unit": row.get(COL_PREISEINHEIT) or None,
                "article_name": row.get(COL_BEZEICHNUNG) or None,
            }
        )

    return rows, fehler
