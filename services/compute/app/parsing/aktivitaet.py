"""Parser für die drei Exporte hinter der Vertriebsaktivität.

Drei Dateien, drei Formen — aus lumeapps übernommen und auf die Helfer in
`german.py` gezogen:

  Kontakte           Tab-getrennt, Latin-1. Zwei Kopfzeilen-Varianten sind im
                     Umlauf; die ältere heißt die Spalten `Wer`, `Sta`,
                     `Kommentar`, die jüngere `Mitarbeiter`, `St`, `Textfeld`.
                     Zellen können in `="…"` eingefasst sein. `Typ` kommt
                     doppelt vor: die erste Spalte trägt die Kontaktart
                     (ERS/ORT/ONL/…), die zweite die ERP-Verknüpfung (ANG/RG).
  AswKpf_ANG.txt     Angebote, dieselbe Form wie die Auftrags- und
                     Rechnungsdatei, aber ohne die `="…"`-Einfassung.
  dev_excel_INT.txt  Interessenten-Stammdaten, 88 Spalten, mit einer Titelzeile
                     vor der Kopfzeile. Drei Spalten werden gebraucht.

Rückgabe ist immer `(gültige Zeilen, Fehler)`. Der Aufrufer ergänzt
`upload_batch_id` und `imported_at`.
"""
from __future__ import annotations

import re
from typing import Any

from app.parsing.german import parse_date, parse_decimal, read_tabular

Row = dict[str, Any]
Fehler = dict[str, Any]

_EINFASSUNG = re.compile(r'^="?(.*?)"?$')


def _fehler(row: int, feld: str, text: str) -> Fehler:
    return {"row": row, "field": feld, "message": text}


def _ohne_einfassung(wert: Any) -> str:
    """`="4711"` → `4711`. Der Export fasst Zellen so ein, damit Excel
    Vorgangsnummern nicht in Zahlen verwandelt."""
    if wert is None:
        return ""
    s = str(wert).strip()
    treffer = _EINFASSUNG.match(s)
    return (treffer.group(1) if treffer else s).strip()


def _eindeutige_spalten(spalten: list[str]) -> list[str]:
    """Wiederholte Spaltennamen bekommen `.1`, `.2` …

    Die Kontaktdatei führt `Typ` zweimal. pandas würde beim Einlesen selbst
    umbenennen — aber wir setzen `df.columns` nach dem Entfernen der
    Einfassung neu, also machen wir es hier selbst.
    """
    gesehen: dict[str, int] = {}
    aus: list[str] = []
    for s in spalten:
        if s in gesehen:
            gesehen[s] += 1
            aus.append(f"{s}.{gesehen[s]}")
        else:
            gesehen[s] = 0
            aus.append(s)
    return aus


def _erste(zeile: dict[str, Any], *namen: str) -> str:
    """Erste gefüllte Zelle unter diesen Spaltennamen.

    Damit kommt der Parser mit beiden Kopfzeilen-Varianten aus, ohne an der
    Aufrufstelle zu verzweigen.
    """
    for name in namen:
        wert = _ohne_einfassung(zeile.get(name, ""))
        if wert:
            return wert
    return ""


def parse_kontakte(contents: bytes) -> tuple[list[Row], list[Fehler]]:
    """Kontaktprotokoll des Vertriebs."""
    try:
        df = read_tabular(contents)
    except ValueError as exc:
        return [], [_fehler(0, "file", str(exc))]

    df.columns = _eindeutige_spalten([_ohne_einfassung(c) for c in df.columns])

    rows: list[Row] = []
    fehler: list[Fehler] = []
    for idx, roh in df.iterrows():
        zeile = int(idx) + 2
        werte = roh.to_dict()

        wer = _erste(werte, "Mitarbeiter", "Wer").upper()
        datum = parse_date(_erste(werte, "Datum"))

        if datum is None and not wer and not any(_ohne_einfassung(v) for v in werte.values()):
            continue  # angehängte Leerzeile
        if datum is None or not wer:
            fehler.append(_fehler(zeile, "Datum/Mitarbeiter", "fehlt oder unlesbar"))
            continue

        status_roh = _erste(werte, "St", "Sta")
        try:
            status = int(status_roh) if status_roh else 0
        except ValueError:
            status = 0
        if status not in (0, 1):
            status = 0

        rows.append({
            "contact_date": datum,
            "employee_token": wer,
            # Die erste `Typ`-Spalte trägt die Kontaktart. Die zweite heißt
            # nach `_eindeutige_spalten` `Typ.1` und bleibt in `raw`.
            "contact_type": _erste(werte, "Typ") or None,
            "customer_group": _erste(werte, "Gruppe") or None,
            "status": status,
            "customer_name": _erste(werte, "Name 1", "Name") or None,
            "comment": _erste(werte, "Textfeld", "Kommentar") or None,
            "external_id": _erste(werte, "Vorgang Nr.", "VrgID") or None,
            "raw": {k: _ohne_einfassung(v) for k, v in werte.items() if _ohne_einfassung(v)},
        })
    return rows, fehler


def parse_angebote(contents: bytes) -> tuple[list[Row], list[Fehler]]:
    """AswKpf_ANG.txt — geschriebene Angebote mit Wert und Erfasser."""
    try:
        df = read_tabular(contents)
    except ValueError as exc:
        return [], [_fehler(0, "file", str(exc))]

    fehlend = [c for c in ("Vorgang Nr.", "Datum", "Wert") if c not in df.columns]
    if fehlend:
        return [], [_fehler(0, "header", f"Fehlende Spalte(n): {', '.join(fehlend)}")]

    rows: list[Row] = []
    fehler: list[Fehler] = []
    index_je_nr: dict[str, int] = {}

    for idx, roh in df.iterrows():
        zeile = int(idx) + 2
        werte = {k: ("" if v is None else str(v)).strip() for k, v in roh.to_dict().items()}

        vorgang_nr = _ohne_einfassung(werte.get("Vorgang Nr.", ""))
        datum_roh = werte.get("Datum", "")
        wert_roh = werte.get("Wert", "")

        if not any((vorgang_nr, datum_roh, wert_roh)):
            continue
        if not vorgang_nr:
            fehler.append(_fehler(zeile, "Vorgang Nr.", "fehlt"))
            continue

        datum = parse_date(datum_roh)
        if datum is None:
            fehler.append(_fehler(zeile, "Datum", f"unlesbar oder leer: '{datum_roh}'"))
            continue

        wert = parse_decimal(wert_roh)
        if wert is None:
            fehler.append(_fehler(zeile, "Wert", f"unlesbar oder leer: '{wert_roh}'"))
            continue

        eintrag: Row = {
            "vorgang_nr": vorgang_nr,
            "datum": datum,
            "adr_nr": werte.get("Adr Nr.") or None,
            "customer_name": werte.get("Name 1") or None,
            "ort": werte.get("Ort") or None,
            "erfasser": werte.get("Erfasst durch") or None,
            "wert_eur": wert,
            "raw": {k: v for k, v in werte.items() if v},
        }

        # Doppelte Vorgangsnummer in einer Datei: die letzte Zeile gewinnt,
        # genau wie der Upsert in der Datenbank.
        vorher = index_je_nr.get(vorgang_nr)
        if vorher is not None:
            rows[vorher] = eintrag
        else:
            index_je_nr[vorgang_nr] = len(rows)
            rows.append(eintrag)

    return rows, fehler


def parse_interessenten(contents: bytes) -> tuple[list[Row], list[Fehler]]:
    """dev_excel_INT.txt — Stammdaten der Interessenten.

    Die Datei stellt der Kopfzeile eine Titelzeile voran („Adressen
    Interessenten"). `read_tabular` sucht die Kopfzeile an den drei Spalten,
    die wir brauchen.
    """
    try:
        df = read_tabular(contents, kopf_erkennen=("Adress-Nr.", "Name 1", "Datum Save"))
    except ValueError as exc:
        return [], [_fehler(0, "file", str(exc))]

    fehlend = [c for c in ("Adress-Nr.", "Datum Save") if c not in df.columns]
    if fehlend:
        return [], [_fehler(0, "header", f"Fehlende Spalte(n): {', '.join(fehlend)}")]

    rows: list[Row] = []
    fehler: list[Fehler] = []
    index_je_nr: dict[str, int] = {}

    for idx, roh in df.iterrows():
        zeile = int(idx) + 2
        werte = {k: ("" if v is None else str(v)).strip() for k, v in roh.to_dict().items()}

        adress_nr = _ohne_einfassung(werte.get("Adress-Nr.", ""))
        if not adress_nr:
            if any(werte.values()):
                fehler.append(_fehler(zeile, "Adress-Nr.", "fehlt"))
            continue

        eintrag: Row = {
            "adress_nr": adress_nr,
            "customer_name": werte.get("Name 1") or None,
            # Ohne Datum zählt der Interessent in keiner Woche mit. Er wird
            # trotzdem gespeichert: die Datei ist eine Momentaufnahme der
            # Stammdaten, und ein Datum kann später nachkommen.
            "datum_save": parse_date(werte.get("Datum Save", "")),
            "raw": {k: v for k, v in werte.items() if v},
        }

        vorher = index_je_nr.get(adress_nr)
        if vorher is not None:
            rows[vorher] = eintrag
        else:
            index_je_nr[adress_nr] = len(rows)
            rows.append(eintrag)

    return rows, fehler
