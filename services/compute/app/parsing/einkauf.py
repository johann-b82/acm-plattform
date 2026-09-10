"""Parser für den Liefertreue-Export aus dem Einkauf.

`dev_excel_Liefertreue_Einkauf.txt`, tab-getrennt, eine Zeile je
Lieferposition. Zwei Eigenheiten gegenüber den Vertriebsdateien:

* Vor der Kopfzeile kann eine Titelzeile stehen („Auswertung: Liefertreue
  (von 01.01.2026 bis 30.04.2026)"). Sie wird übersprungen, der Zeitraum
  daraus zurückgegeben — der Aufrufer kann ihn protokollieren.
* Datumsangaben kommen mal deutsch, mal als ISO-Zeitstempel.

Der Geschäftsschlüssel ist `(auftrag, pos, upos)`. Doppelte Schlüssel in
derselben Datei sind ein Fehler und keine stille Übernahme: anders als bei
den Vorgangsnummern im Vertrieb gibt es hier keinen Grund, warum dieselbe
Position zweimal auftauchen sollte.
"""
from __future__ import annotations

import re
from datetime import date
from typing import Any

from app.parsing.german import decode_erp, parse_date_weit, parse_decimal, read_tabular

COL_AUFTRAG = "Auftrag"
COL_POS = "Pos"
COL_UPOS = "UPos"
COL_ADR_NR = "Kundennummer"
COL_LIEFERANT = "Kunde"
COL_GELIEFERT = "geliefert"
COL_ZIELDATUM = "Lieferdatum"
COL_VERZUG = "Verzug (Tage)"
COL_MENGE = "Menge"
COL_EINHEIT = "ME"
COL_ARTIKEL = "Artikel"
COL_BEZEICHNUNG = "Bezeichnung"

PFLICHT = (COL_AUFTRAG, COL_POS, COL_VERZUG)

# „von 01.01.2026 bis 30.04.2026" irgendwo in der Titelzeile.
_ZEITRAUM = re.compile(r"von\s+(\d{1,2}\.\d{1,2}\.\d{4})\s+bis\s+(\d{1,2}\.\d{1,2}\.\d{4})")

Row = dict[str, Any]
Fehler = dict[str, Any]


def _fehler(row: int, feld: str, text: str) -> Fehler:
    return {"row": row, "field": feld, "message": text}


def _parse_int(roh: str) -> int | None:
    s = (roh or "").strip()
    if not s:
        return None
    try:
        # Der Export schreibt Ganzzahlen gelegentlich als „3.0".
        return int(float(s.replace(",", ".")))
    except (ValueError, TypeError):
        return None


def lies_zeitraum(contents: bytes) -> tuple[date, date] | None:
    """Auswertungszeitraum aus der Titelzeile, falls vorhanden."""
    for zeile in decode_erp(contents).splitlines()[:5]:
        treffer = _ZEITRAUM.search(zeile)
        if treffer:
            von, bis = parse_date_weit(treffer.group(1)), parse_date_weit(treffer.group(2))
            if von and bis:
                return von, bis
    return None


def parse_liefertreue(contents: bytes) -> tuple[list[Row], list[Fehler]]:
    try:
        df = read_tabular(contents, kopf_erkennen=(COL_AUFTRAG, "Verzug"))
    except ValueError as exc:
        return [], [_fehler(0, "file", str(exc))]

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

        auftrag = row.get(COL_AUFTRAG, "")
        if not auftrag:
            fehler.append(_fehler(zeile, COL_AUFTRAG, "Auftragsnummer fehlt"))
            continue

        pos = _parse_int(row.get(COL_POS, ""))
        if pos is None:
            fehler.append(_fehler(zeile, COL_POS, f"Position unlesbar oder leer: '{row.get(COL_POS, '')}'"))
            continue
        upos = _parse_int(row.get(COL_UPOS, "")) or 0

        schluessel = (auftrag, pos, upos)
        if schluessel in gesehen:
            fehler.append(
                _fehler(zeile, COL_AUFTRAG, f"Position doppelt in der Datei: {auftrag}/{pos}/{upos}")
            )
            continue
        gesehen.add(schluessel)

        rows.append(
            {
                "auftrag": auftrag,
                "pos": pos,
                "upos": upos,
                "adr_nr": row.get(COL_ADR_NR) or None,
                "supplier_name": row.get(COL_LIEFERANT) or None,
                "delivered_date": parse_date_weit(row.get(COL_GELIEFERT, "")),
                "target_date": parse_date_weit(row.get(COL_ZIELDATUM, "")),
                # Bleibt bewusst None, wenn unlesbar: eine Position ohne
                # Verzugswert kann nie pünktlich sein, das ist eine Aussage.
                "verzug_tage": _parse_int(row.get(COL_VERZUG, "")),
                "quantity": parse_decimal(row.get(COL_MENGE, "")),
                "unit": row.get(COL_EINHEIT) or None,
                "article_number": row.get(COL_ARTIKEL) or None,
                "article_name": row.get(COL_BEZEICHNUNG) or None,
                "raw": {k: v for k, v in row.items() if v},
            }
        )

    return rows, fehler
