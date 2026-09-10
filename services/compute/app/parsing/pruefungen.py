"""Parser des Qualitätsprüfungs-Exports `AswQs2151.txt`.

Eine Zeile je Prüfbuchung. Zwei Dinge passieren beim Einlesen, die man später
nicht mehr nachholen kann:

* **Die Größenklasse wird abgeleitet.** Sie steht nicht in den Daten, sondern
  ergibt sich aus Produktgruppe und Bezeichnung. Die Regeln kommen vom Kunden
  und stehen unten; sie werden übernommen, nicht neu erfunden.
* **Werkzeugbuchungen fallen raus** (`Typ = WKZ`). Sie sind keine Prüfung.

Der Kostenschlüssel `RSC` bleibt erhalten und wird erst beim Rechnen
gefiltert: nur `70000` ist eine echte Qualitätsprüfung, alles andere eine
Sonderbuchung. Die Zeilen sollen trotzdem in der Tabelle stehen, damit
sichtbar bleibt, was gebucht wurde.
"""
from __future__ import annotations

import re
from datetime import time
from typing import Any

from app.parsing.german import parse_date, parse_decimal, read_tabular

COL_TYP = "Typ"
COL_DATUM = "Datum"
COL_ZEIT = "Zeit"
COL_BENUTZER = "Benutzer"
COL_FA = "FA"
COL_ARTIKEL = "Artikel"
COL_BEZEICHNUNG = "Bezeichnung"
COL_BUCHUNGS_MENGE = "Buchungs-Menge"
COL_AUSSCHUSS_MENGE = "Ausschuss-Menge"
COL_PRODUKTGRUPPE = "Produktgruppe"
COL_RSC = "RSC"

PFLICHT = (COL_DATUM,)

# Bezeichnungen, die auf ein kleines Produkt hinweisen. Wortlaut aus dem
# Altprojekt, inklusive der beiden Schreibweisen mit und ohne Punkt.
KLEIN_SCHLUESSELWOERTER = (
    "LITERATURE POCKET",
    "LIT POCKET",
    "STRAP ",
    "STRAP,",
    "LEDERRIEMEN",
    "STOWAGE POUCH",
    "AUFBEWAHRUNGSTASCHE",
)

# „net" oder „netz" als Wortanfang. Ohne die Grenze würde „Internet" oder
# „Kabinett" mitzählen.
_NETZ = re.compile(r"(?i)(?:^|[^a-z])(net|netz)")

Row = dict[str, Any]
Fehler = dict[str, Any]


def groessenklasse(bezeichnung: str | None, produktgruppe: str | None) -> str:
    """`small` oder `large` nach den Regeln des Kunden.

    Reihenfolge ist Absicht: die Produktgruppe schlägt die Bezeichnung, und
    ein Schlüsselwort schlägt die Netz-Regel.
    """
    bez = (bezeichnung or "").upper()
    pg = (produktgruppe or "").upper()

    # Jede Produktgruppe aus dem Diehl-Katalog zählt als klein.
    if "DIEHL" in pg:
        return "small"
    if any(k in bez for k in KLEIN_SCHLUESSELWOERTER):
        return "small"
    if _NETZ.search(bez):
        return "small"
    return "large"


def _fehler(row: int, feld: str, text: str) -> Fehler:
    return {"row": row, "field": feld, "message": text}


def _parse_zeit(roh: str) -> time | None:
    s = (roh or "").strip()
    if not s:
        return None
    for form in ("%H:%M:%S", "%H:%M"):
        try:
            from datetime import datetime

            return datetime.strptime(s, form).time()
        except ValueError:
            continue
    return None


def parse_pruefungen(contents: bytes) -> tuple[list[Row], list[Fehler]]:
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

        typ = row.get(COL_TYP, "")
        # Werkzeugbuchungen sind keine Prüfung.
        if typ.upper() == "WKZ":
            continue

        pruef_datum = parse_date(row.get(COL_DATUM, ""))
        if pruef_datum is None:
            fehler.append(
                _fehler(zeile, COL_DATUM, f"Datum unlesbar oder leer: '{row.get(COL_DATUM, '')}'")
            )
            continue

        bezeichnung = row.get(COL_BEZEICHNUNG, "")
        produktgruppe = row.get(COL_PRODUKTGRUPPE, "")

        rows.append(
            {
                "pruef_datum": pruef_datum,
                "pruef_zeit": _parse_zeit(row.get(COL_ZEIT, "")),
                "benutzer": row.get(COL_BENUTZER) or None,
                "fa": row.get(COL_FA) or None,
                "artikel": row.get(COL_ARTIKEL) or None,
                "bezeichnung": bezeichnung or None,
                "buchungs_menge": parse_decimal(row.get(COL_BUCHUNGS_MENGE, "")),
                "ausschuss_menge": parse_decimal(row.get(COL_AUSSCHUSS_MENGE, "")),
                "produktgruppe": produktgruppe or None,
                "typ": typ or None,
                "size_class": groessenklasse(bezeichnung, produktgruppe),
                "rsc": row.get(COL_RSC) or None,
                "raw": {k: v for k, v in row.items() if v},
            }
        )

    return rows, fehler
