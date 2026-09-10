"""Parser für die Positions-Exporte aus dem ERP.

Drei Dateien, eine Form: `AswKpf_AUF` auf Positionsebene (Auftragspositionen),
`AswKpf_LS` (Lieferscheine) und `AswKpf_WE` (Wareneingänge). Eine Zeile je
Position, Schlüssel `(Vorgang Nr., Pos, UPos)`, dieselben Spaltennamen. Im
Altprojekt lagen dafür drei Dateien mit fast identischem Inhalt.

Was sich je Sorte unterscheidet, steht in einer `Sorte` beisammen:

* der `Typ`-Filter — `AUF`, `LS` oder `WE`. Der Export kann auch andere
  Vorgangstypen enthalten, die nicht mitzählen sollen.
* die Bedeutung von „Lieferdatum": Zieltermin beim Auftrag, Ist-Datum beim
  Lieferschein, Eingangsdatum beim Wareneingang. Dieselbe Quellspalte, drei
  Bedeutungen — und deshalb drei Zielspalten.
* wie die Gegenseite heißt: Kunde beim Auftrag und Lieferschein, Lieferant
  beim Wareneingang. Die Quellspalten sind dieselben.
* zusätzliche Felder, die nur eine Sorte kennt.

Die Lieferscheine kommen als Excel-Datei, die anderen beiden als Text.
"""
from __future__ import annotations

import io
from dataclasses import dataclass, field
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

COL_ORT = "Ort"
COL_BESTELLUNG = "Bestellung"
COL_BESTELLDATUM = "Datum.1"
COL_WGR = "WGR"
COL_EK_KONTO = "EK Konto"

PFLICHT = (COL_VORGANG_NR, COL_POS)

Row = dict[str, Any]
Fehler = dict[str, Any]


@dataclass(frozen=True)
class Sorte:
    """Was eine Dateisorte von den anderen unterscheidet."""

    typ: str
    """Wert der Spalte `Typ`; andere Zeilen werden übergangen."""

    datumsspalte: str
    """Zielspalte für „Lieferdatum" — die Bedeutung wechselt je Sorte."""

    praefix: str
    """`customer` oder `supplier`: wie die Gegenseite in der Tabelle heißt."""

    excel: bool = False

    zusatz: dict[str, str] = field(default_factory=dict)
    """Zielspalte → Quellspalte für Felder, die nur diese Sorte kennt."""


AUFTRAGSPOSITIONEN = Sorte(
    typ="AUF",
    datumsspalte="lieferdatum",
    praefix="customer",
    zusatz={"pos_typ_2": COL_POS_TYP_2},
)

LIEFERSCHEINE = Sorte(
    typ="LS",
    datumsspalte="delivery_date",
    praefix="customer",
    excel=True,
    zusatz={"external_order_nr": COL_FREMDNR, "order_nr": COL_AUFTRAG},
)

WARENEINGAENGE = Sorte(
    typ="WE",
    datumsspalte="receipt_date",
    praefix="supplier",
    zusatz={
        "order_nr": COL_BESTELLUNG,
        "material_group": COL_WGR,
        "purchase_account": COL_EK_KONTO,
    },
)


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


def _parse(contents: bytes, sorte: Sorte) -> tuple[list[Row], list[Fehler]]:
    try:
        df = _lies_excel(contents) if sorte.excel else read_tabular(contents)
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
        if typ and typ.upper() != sorte.typ:
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

        p = sorte.praefix
        eintrag: Row = {
            "vorgang_nr": vorgang_nr,
            "pos": pos,
            "upos": upos,
            "typ": typ or None,
            "entry_date": parse_date(row.get(COL_DATUM, "")),
            sorte.datumsspalte: parse_date(row.get(COL_LIEFERDATUM, "")),
            f"{p}_id": row.get(COL_ADR_NR) or None,
            f"{p}_name": row.get(COL_NAME) or None,
            f"{p}_city": row.get(COL_ORT) or None,
            "article_number": row.get(COL_ARTNR) or None,
            "article_version": row.get(COL_ARTVERSION) or None,
            "article_name": row.get(COL_BEZEICHNUNG) or None,
            "quantity": parse_decimal(row.get(COL_MENGE, "")),
            "unit": row.get(COL_EINHEIT) or None,
            "price": parse_decimal(row.get(COL_PREIS, "")),
            "position_value": parse_decimal(row.get(COL_POS_WERT, "")),
            "raw": {k: v for k, v in row.items() if v},
        }
        for ziel, quelle in sorte.zusatz.items():
            eintrag[ziel] = (
                parse_date(row.get(quelle, "")) if ziel.endswith("_date") else (row.get(quelle) or None)
            )

        rows.append(eintrag)

    return rows, fehler


def parse_auftrag_positionen(contents: bytes) -> tuple[list[Row], list[Fehler]]:
    """AswKpf_AUF auf Positionsebene — `Lieferdatum` ist der Zieltermin."""
    return _parse(contents, AUFTRAGSPOSITIONEN)


def parse_lieferscheine(contents: bytes) -> tuple[list[Row], list[Fehler]]:
    """AswKpf_LS — `Lieferdatum` ist das Ist-Datum der Lieferung."""
    return _parse(contents, LIEFERSCHEINE)


def parse_wareneingaenge(contents: bytes) -> tuple[list[Row], list[Fehler]]:
    """AswKpf_WE — `Lieferdatum` ist das Eingangsdatum beim Lieferanten."""
    return _parse(contents, WARENEINGAENGE)
