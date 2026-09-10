"""Parser der Lagerbewegungen `AswLagBew.txt`.

Eine Zeile je Bewegung. Das Vorzeichen trägt die Bedeutung: Entnahmen (`M`)
stehen negativ, Stornos (`SM`) positiv. Der Verbrauch eines Artikels ist
deshalb die negierte Summe über beide Buchtypen.

Gefiltert wird hier nichts. Welche Buchtypen in eine Kennzahl eingehen,
entscheidet die Abfrage — die Lagerbewegungen speisen später auch die
Ladenhüter-Auswertung im Einkauf, und die zählt alle Typen.
"""
from __future__ import annotations

from typing import Any

from app.parsing.german import parse_date, parse_decimal, read_tabular

COL_ARTIKELNR = "Artikelnr"
COL_BEZEICHNUNG = "Bezeichnung 1"
COL_BUCH_DATUM = "BuchDatum"
COL_BEWEGUNGSMENGE = "Bewegungsmenge"
COL_BUCHTYP = "BuchTyp"
COL_KOMMENTAR = "Kommentar"

PFLICHT = (COL_ARTIKELNR, COL_BUCH_DATUM)

Row = dict[str, Any]
Fehler = dict[str, Any]


def _fehler(row: int, feld: str, text: str) -> Fehler:
    return {"row": row, "field": feld, "message": text}


def parse_lagerbewegungen(contents: bytes) -> tuple[list[Row], list[Fehler]]:
    try:
        df = read_tabular(contents)
    except ValueError as exc:
        return [], [_fehler(0, "file", str(exc))]

    fehlend = [c for c in PFLICHT if c not in df.columns]
    if fehlend:
        return [], [_fehler(0, "header", f"Fehlende Spalte(n): {', '.join(fehlend)}")]

    rows: list[Row] = []
    fehler: list[Fehler] = []

    for idx, raw_row in df.iterrows():
        zeile = int(idx) + 2
        row = {k: ("" if v is None else str(v)).strip() for k, v in raw_row.to_dict().items()}

        if not any(row.values()):
            continue

        artikelnr = row.get(COL_ARTIKELNR, "")
        if not artikelnr:
            fehler.append(_fehler(zeile, COL_ARTIKELNR, "Artikelnummer fehlt"))
            continue

        buch_datum = parse_date(row.get(COL_BUCH_DATUM, ""))
        if buch_datum is None:
            fehler.append(
                _fehler(zeile, COL_BUCH_DATUM, f"Datum unlesbar oder leer: '{row.get(COL_BUCH_DATUM, '')}'")
            )
            continue

        rows.append(
            {
                "artikelnr": artikelnr,
                "article_name": row.get(COL_BEZEICHNUNG) or None,
                "buch_datum": buch_datum,
                # Bleibt vorzeichenbehaftet: das Minus ist die Aussage.
                "bewegungsmenge": parse_decimal(row.get(COL_BEWEGUNGSMENGE, "")),
                "buchtyp": row.get(COL_BUCHTYP) or None,
                "kommentar": row.get(COL_KOMMENTAR) or None,
                "raw": {k: v for k, v in row.items() if v},
            }
        )

    return rows, fehler
