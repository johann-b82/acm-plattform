"""Parser der Materialpreise aus `AswKpf_WE.txt`.

Dieselbe Datei wie der Wareneingangsimport, aber ein anderer Zweck und darum
ein eigener Parser: der Wareneingang ist Bezugsgröße der Reklamationsquote
und zählt nach `Lieferdatum`; die Materialpreise liefern der
Materialkostenquote den Stückpreis und zählen nach dem Wareneingangsdatum
`Datum`. Die Datei hat zwei Spalten dieses Namens — die zweite ist das
Bestelldatum, pandas nennt sie `Datum.1`.

Der Stückpreis entsteht erst in der Abfrage aus `Pos Wert / Menge`. Die
Rohspalte `Preis` wird mitgeführt, aber nicht benutzt: sie gilt je nach
Artikel für 1, 100 oder 1000 Stück.

Wie im Altsystem (`material_prices_parser.py`):
  * Pflicht sind Vorgangsnummer, Position und Artikelnummer; `UPos` leer ist 0.
  * Ein Schlüssel `(Vorgang, Pos, UPos)` doppelt in derselben Datei ist ein
    Fehler — die erste Zeile gilt.
  * Ein unlesbares Datum verwirft die Zeile nicht; sie kommt ohne Datum mit
    und liefert dann keinen Preis.
"""
from __future__ import annotations

from typing import Any

import pandas as pd

from app.parsing.german import parse_date_weit, parse_decimal, read_tabular

COL_VORGANG = "Vorgang Nr."
COL_POS = "Pos"
COL_UPOS = "UPos"
COL_TYP = "Typ"
COL_DATUM = "Datum"
COL_ARTNR = "Artnr"
COL_BEZEICHNUNG = "Bezeichnung 1"
COL_MENGE = "Menge"
COL_EINHEIT = "ME"
COL_PREIS = "Preis"
COL_POS_WERT = "Pos Wert"

PFLICHT = (COL_VORGANG, COL_POS, COL_ARTNR)

Row = dict[str, Any]
Fehler = dict[str, Any]


def _fehler(row: int, feld: str, text: str) -> Fehler:
    return {"row": row, "field": feld, "message": text}


def _parse_int(roh: str) -> int | None:
    s = (roh or "").strip()
    if not s:
        return None
    try:
        return int(float(s.replace(",", ".")))
    except (ValueError, TypeError):
        return None


def parse_materialpreise(contents: bytes) -> tuple[list[Row], list[Fehler]]:
    try:
        df = read_tabular(contents, kopf_erkennen=(COL_VORGANG, COL_ARTNR))
    except (ValueError, pd.errors.EmptyDataError) as exc:
        return [], [_fehler(0, "file", str(exc) or "Datei ist leer")]

    fehlend = [c for c in PFLICHT if c not in df.columns]
    if fehlend:
        return [], [_fehler(0, "header", f"Fehlende Spalte(n): {', '.join(fehlend)}")]

    rows: list[Row] = []
    fehler: list[Fehler] = []
    gesehen: set[tuple[str, int, int]] = set()

    for idx, raw_row in df.iterrows():
        zeile = int(idx) + 2
        row = {k: ("" if v is None else str(v)).strip() for k, v in raw_row.to_dict().items()}

        if not any(row.values()):
            continue

        vorgang = row.get(COL_VORGANG, "")
        if not vorgang:
            fehler.append(_fehler(zeile, COL_VORGANG, "Vorgangsnummer fehlt"))
            continue

        pos = _parse_int(row.get(COL_POS, ""))
        if pos is None:
            fehler.append(_fehler(zeile, COL_POS, f"Position unlesbar oder leer: '{row.get(COL_POS, '')}'"))
            continue
        upos = _parse_int(row.get(COL_UPOS, "")) or 0

        artnr = row.get(COL_ARTNR, "")
        if not artnr:
            fehler.append(_fehler(zeile, COL_ARTNR, "Artikelnummer fehlt"))
            continue

        schluessel = (vorgang, pos, upos)
        if schluessel in gesehen:
            fehler.append(
                _fehler(zeile, COL_VORGANG, f"Position doppelt in der Datei: {vorgang}/{pos}/{upos}")
            )
            continue
        gesehen.add(schluessel)

        rows.append(
            {
                "vorgang_nr": vorgang,
                "pos": pos,
                "upos": upos,
                "typ": row.get(COL_TYP) or None,
                "datum": parse_date_weit(row.get(COL_DATUM, "")),
                "artnr": artnr,
                "article_name": row.get(COL_BEZEICHNUNG) or None,
                "menge": parse_decimal(row.get(COL_MENGE, "")),
                "unit": row.get(COL_EINHEIT) or None,
                "preis": parse_decimal(row.get(COL_PREIS, "")),
                "pos_wert": parse_decimal(row.get(COL_POS_WERT, "")),
                "raw": {k: v for k, v in row.items() if v},
            }
        )

    return rows, fehler
