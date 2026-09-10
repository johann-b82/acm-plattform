"""Parser für die beiden Positions-Exporte aus dem ERP.

`AswKpf_AUF` auf Positionsebene (Auftragspositionen) und `AswKpf_LS`
(Lieferscheine) haben dieselbe Form: eine Zeile je Position, Schlüssel
`(Vorgang Nr., Pos, UPos)`, dieselben Spaltennamen. Im Altprojekt lagen dafür
zwei Dateien mit fast identischem Inhalt; hier ist es eine.

Zwei Unterschiede bleiben und stehen deshalb in der Beschreibung je Sorte:

* Der `Typ`-Filter — `AUF` bzw. `LS`. Der Export kann auch andere
  Vorgangstypen enthalten, die nicht mitzählen sollen.
* Die Zielspalte für „Lieferdatum": beim Auftrag ist es der **Zieltermin**,
  beim Lieferschein das **Ist-Datum**. Dieselbe Quellspalte, zwei Bedeutungen.

Die Lieferscheine kommen als Excel-Datei, die Auftragspositionen als Text.
"""
from __future__ import annotations

import io
from typing import Any

import pandas as pd

from app.parsing.german import parse_date, parse_decimal, read_tabular

COL_TYP = "Typ"
COL_VORGANG_NR = "Vorgang Nr."
COL_POS = "Pos"
COL_UPOS = "UPos"
COL_DATUM = "Datum"
COL_LIEFERDATUM = "Lieferdatum"
COL_ADR_NR = "Adr Nr."
COL_NAME = "Name 1"
COL_ORT = "Ort"
COL_ARTNR = "Artnr"
COL_ARTVERSION = "Version"
COL_BEZEICHNUNG = "Bezeichnung 1"
COL_MENGE = "Menge"
COL_EINHEIT = "ME"
COL_PREIS = "Preis"
COL_POS_WERT = "Pos Wert"
COL_POS_TYP_2 = "Pos Typ 2"
COL_FREMDNR = "Fremdnr"
COL_AUFTRAG = "Auftrag"

PFLICHT = (COL_VORGANG_NR, COL_POS)

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


def _lies_excel(contents: bytes) -> pd.DataFrame:
    df = pd.read_excel(io.BytesIO(contents), dtype=str, keep_default_na=False)
    df.columns = [str(c).strip() for c in df.columns]
    return df


def _parse(
    contents: bytes,
    *,
    typ_filter: str,
    datumsspalte: str,
    excel: bool,
    extra: tuple[str, ...] = (),
) -> tuple[list[Row], list[Fehler]]:
    try:
        df = _lies_excel(contents) if excel else read_tabular(contents)
    except ValueError as exc:
        return [], [_fehler(0, "file", str(exc))]
    except Exception as exc:  # defekte Excel-Datei
        return [], [_fehler(0, "file", f"Datei nicht lesbar: {exc}")]

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

        typ = row.get(COL_TYP, "")
        # Andere Vorgangstypen im selben Export gehören nicht in diese Tabelle.
        # Eine leere Typspalte wird durchgelassen: ältere Exporte haben sie nicht.
        if typ and typ.upper() != typ_filter:
            continue

        vorgang_nr = row.get(COL_VORGANG_NR, "")
        if not vorgang_nr:
            fehler.append(_fehler(zeile, COL_VORGANG_NR, "Vorgang Nr. fehlt"))
            continue

        pos = _parse_int(row.get(COL_POS, ""))
        if pos is None:
            fehler.append(_fehler(zeile, COL_POS, f"Position unlesbar oder leer: '{row.get(COL_POS, '')}'"))
            continue
        upos = _parse_int(row.get(COL_UPOS, "")) or 0

        schluessel = (vorgang_nr, pos, upos)
        if schluessel in gesehen:
            fehler.append(
                _fehler(zeile, COL_VORGANG_NR, f"Position doppelt in der Datei: {vorgang_nr}/{pos}/{upos}")
            )
            continue
        gesehen.add(schluessel)

        eintrag: Row = {
            "vorgang_nr": vorgang_nr,
            "pos": pos,
            "upos": upos,
            "typ": typ or None,
            "entry_date": parse_date(row.get(COL_DATUM, "")),
            datumsspalte: parse_date(row.get(COL_LIEFERDATUM, "")),
            "customer_id": row.get(COL_ADR_NR) or None,
            "customer_name": row.get(COL_NAME) or None,
            "customer_city": row.get(COL_ORT) or None,
            "article_number": row.get(COL_ARTNR) or None,
            "article_version": row.get(COL_ARTVERSION) or None,
            "article_name": row.get(COL_BEZEICHNUNG) or None,
            "quantity": parse_decimal(row.get(COL_MENGE, "")),
            "unit": row.get(COL_EINHEIT) or None,
            "price": parse_decimal(row.get(COL_PREIS, "")),
            "position_value": parse_decimal(row.get(COL_POS_WERT, "")),
            "raw": {k: v for k, v in row.items() if v},
        }
        if "pos_typ_2" in extra:
            eintrag["pos_typ_2"] = row.get(COL_POS_TYP_2) or None
        if "order_nr" in extra:
            eintrag["external_order_nr"] = row.get(COL_FREMDNR) or None
            eintrag["order_nr"] = row.get(COL_AUFTRAG) or None

        rows.append(eintrag)

    return rows, fehler


def parse_auftrag_positionen(contents: bytes) -> tuple[list[Row], list[Fehler]]:
    """AswKpf_AUF auf Positionsebene — `Lieferdatum` ist der Zieltermin."""
    return _parse(
        contents,
        typ_filter="AUF",
        datumsspalte="lieferdatum",
        excel=False,
        extra=("pos_typ_2",),
    )


def parse_lieferscheine(contents: bytes) -> tuple[list[Row], list[Fehler]]:
    """AswKpf_LS — `Lieferdatum` ist das Ist-Datum der Lieferung."""
    return _parse(
        contents,
        typ_filter="LS",
        datumsspalte="delivery_date",
        excel=True,
        extra=("order_nr",),
    )
