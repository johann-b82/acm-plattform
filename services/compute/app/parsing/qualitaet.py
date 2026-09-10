"""Parser des 8D-Exports.

Eine Zeile je 8D-Bericht: Audit-Befunde und Reklamationen liegen in derselben
Datei und werden beide übernommen. Welche Zeilen eine Kennzahl zählt,
entscheidet die Abfrage über den Code in `art`, nicht der Parser.

Zwei Eigenheiten der Quelle:

* Das Level eines Audit-Befunds steht **nicht** in einer eigenen Spalte,
  sondern im Freitext „Artikel": „Audit Major Level 1" oder „Audit Minor
  Level 2". Steht dort etwas anderes, bleibt das Level leer — die Zeile zählt
  dann in keiner Kachel, taucht aber in der Diagnoseliste auf.
* Gelöschte Berichte sind nicht entfernt, sondern mit `gelöscht = J`
  markiert. Sie werden hier verworfen.
"""
from __future__ import annotations

import re
from typing import Any

from app.parsing.german import parse_date, parse_decimal, read_tabular

COL_NR = "Nr."
COL_DATUM = "Datum"
COL_ART = "Art"
COL_ARTIKEL = "Artikel"
COL_AUSSTELLER = "Aussteller"
COL_ADRESSEN = "Adressen"
COL_ADRESS_NR = "Adress Nr."
COL_BEZEICHNUNG = "Bezeichnung"
COL_STATUS = "Status"
COL_PROBLEM = "Problembeschreibung"
COL_URSACHE = "Ursache"
COL_MENGE = "Menge"
COL_MENGE_AKZEPTIERT = "akzeptierte Menge"
COL_GELOESCHT = "gelöscht"

PFLICHT = (COL_NR, COL_DATUM)

# „Audit Major Level 1" bzw. „Audit Minor Level 2", Groß- und Kleinschreibung
# egal, mit beliebigem Text dazwischen.
_LEVEL_1 = re.compile(r"\bMajor\b.*\bLevel\s*1\b", re.IGNORECASE)
_LEVEL_2 = re.compile(r"\bMinor\b.*\bLevel\s*2\b", re.IGNORECASE)

Row = dict[str, Any]
Fehler = dict[str, Any]


def _fehler(row: int, feld: str, text: str) -> Fehler:
    return {"row": row, "field": feld, "message": text}


def level_aus_text(artikel: str) -> int | None:
    """Level aus dem Freitext ableiten; None, wenn nichts passt."""
    if not artikel:
        return None
    if _LEVEL_1.search(artikel):
        return 1
    if _LEVEL_2.search(artikel):
        return 2
    return None


def parse_8d(contents: bytes) -> tuple[list[Row], list[Fehler]]:
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

        # Gelöschte Berichte sind in der Quelle nur markiert, nicht entfernt.
        if row.get(COL_GELOESCHT, "").upper() == "J":
            continue

        report_nr = row.get(COL_NR, "")
        if not report_nr:
            fehler.append(_fehler(zeile, COL_NR, "Berichtsnummer fehlt"))
            continue
        if report_nr in gesehen:
            fehler.append(_fehler(zeile, COL_NR, f"Berichtsnummer doppelt in der Datei: {report_nr}"))
            continue
        gesehen.add(report_nr)

        report_date = parse_date(row.get(COL_DATUM, ""))
        if report_date is None:
            fehler.append(
                _fehler(zeile, COL_DATUM, f"Datum unlesbar oder leer: '{row.get(COL_DATUM, '')}'")
            )
            continue

        rows.append(
            {
                "report_nr": report_nr,
                "report_date": report_date,
                "art": row.get(COL_ART) or None,
                "level": level_aus_text(row.get(COL_ARTIKEL, "")),
                "issuer": row.get(COL_AUSSTELLER) or None,
                "customer_name": row.get(COL_ADRESSEN) or None,
                "customer_id": row.get(COL_ADRESS_NR) or None,
                "designation": row.get(COL_BEZEICHNUNG) or None,
                "status_code": row.get(COL_STATUS) or None,
                "problem_description": row.get(COL_PROBLEM) or None,
                "root_cause": row.get(COL_URSACHE) or None,
                # Fehlende Mengen bleiben leer statt 0: die Fehlerquote zählt
                # Zeilen ohne Zahl nicht mit, 0 würde sie fälschlich mitzählen.
                "quantity": parse_decimal(row.get(COL_MENGE, "")),
                "accepted_quantity": parse_decimal(row.get(COL_MENGE_AKZEPTIERT, "")),
                "raw": {k: v for k, v in row.items() if v},
            }
        )

    return rows, fehler
