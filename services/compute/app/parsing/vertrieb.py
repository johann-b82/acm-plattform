"""Parser für die beiden Vertriebs-Exporte aus dem ERP.

`AswKpf_RG.txt` (Rechnungen und Gutschriften) und `AswKpf_AUF.txt`
(Auftragseingang) haben dieselbe Form: 18 Spalten, Tab-getrennt, deutsche
Zahlen und Datumsangaben. Aus lumeapps übernommen und zusammengeführt —
dort waren es zwei fast identische Dateien.

Gutschriften stehen negativ in der Datei; das bleibt so, damit eine einfache
Summe über `wert_eur` den Nettoumsatz ergibt.

Rückgabe ist immer `(gültige Zeilen, Fehler)`. Der Aufrufer ergänzt
`upload_batch_id` und `imported_at`.
"""
from __future__ import annotations

from typing import Any

from app.parsing.german import parse_date, parse_decimal, read_tabular

COL_TYP = "Typ"
COL_VORGANG_NR = "Vorgang Nr."
COL_DATUM = "Datum"
COL_ADR_NR = "Adr Nr."
COL_NAME = "Name 1"
COL_ERFASSER = "Erfasst durch"
COL_WERT = "Wert"

Row = dict[str, Any]
Fehler = dict[str, Any]


def _fehler(row: int, feld: str, text: str) -> Fehler:
    return {"row": row, "field": feld, "message": text}


def _parse(contents: bytes, *, mit_erfasser: bool) -> tuple[list[Row], list[Fehler]]:
    try:
        df = read_tabular(contents)
    except ValueError as exc:
        return [], [_fehler(0, "file", str(exc))]

    fehlend = [c for c in (COL_TYP, COL_VORGANG_NR, COL_DATUM, COL_WERT) if c not in df.columns]
    if fehlend:
        return [], [_fehler(0, "header", f"Fehlende Spalte(n): {', '.join(fehlend)}")]

    rows: list[Row] = []
    fehler: list[Fehler] = []
    index_je_nr: dict[str, int] = {}

    for idx, raw_row in df.iterrows():
        zeile = int(idx) + 2  # 1-basiert plus Kopfzeile
        row = {k: ("" if v is None else str(v)).strip() for k, v in raw_row.to_dict().items()}

        typ = row.get(COL_TYP, "")
        vorgang_nr = row.get(COL_VORGANG_NR, "")
        datum_roh = row.get(COL_DATUM, "")
        wert_roh = row.get(COL_WERT, "")

        # Der Export hängt Leerzeilen an.
        if not any((typ, vorgang_nr, datum_roh, wert_roh)):
            continue

        if not vorgang_nr:
            fehler.append(_fehler(zeile, COL_VORGANG_NR, "Vorgang Nr. fehlt"))
            continue
        if not typ:
            fehler.append(_fehler(zeile, COL_TYP, "Typ fehlt"))
            continue

        datum = parse_date(datum_roh)
        if datum is None:
            fehler.append(_fehler(zeile, COL_DATUM, f"Datum unlesbar oder leer: '{datum_roh}'"))
            continue

        wert = parse_decimal(wert_roh)
        if wert is None:
            fehler.append(_fehler(zeile, COL_WERT, f"Wert unlesbar oder leer: '{wert_roh}'"))
            continue

        eintrag: Row = {
            "vorgang_nr": vorgang_nr,
            "typ": typ,
            "datum": datum,
            "adr_nr": row.get(COL_ADR_NR) or None,
            "customer_name": row.get(COL_NAME) or None,
            "wert_eur": wert,
            "raw": {k: v for k, v in row.items() if v},
        }
        if mit_erfasser:
            eintrag["erfasser"] = row.get(COL_ERFASSER) or None

        # Doppelte Vorgangsnummer in einer Datei: die letzte Zeile gewinnt,
        # genau wie der Upsert in der Datenbank.
        vorher = index_je_nr.get(vorgang_nr)
        if vorher is not None:
            rows[vorher] = eintrag
        else:
            index_je_nr[vorgang_nr] = len(rows)
            rows.append(eintrag)

    return rows, fehler


def parse_umsatz(contents: bytes) -> tuple[list[Row], list[Fehler]]:
    """AswKpf_RG.txt — Rechnungen (RG) und Gutschriften (GS, negativer Wert)."""
    return _parse(contents, mit_erfasser=False)


def parse_auftraege(contents: bytes) -> tuple[list[Row], list[Fehler]]:
    """AswKpf_AUF.txt — Auftragseingang inklusive Erfasser für Kennzahlen je Vertriebler."""
    return _parse(contents, mit_erfasser=True)
