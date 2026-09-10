"""Gemeinsame Umwandlungen für die ERP-Exporte (deutsches Zahlen- und Datumsformat).

Im Altprojekt war dieser Code in jedem der 15 Parser dupliziert.
"""
from __future__ import annotations

import io
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

import pandas as pd


def parse_date(raw: str) -> date | None:
    """`DD.MM.YYYY` → date; None bei leer oder unlesbar."""
    s = (raw or "").strip()
    if not s:
        return None
    try:
        return datetime.strptime(s, "%d.%m.%Y").date()
    except ValueError:
        return None


def parse_decimal(raw: str) -> Decimal | None:
    """Deutsches Format: Punkt als Tausendertrenner, Komma als Dezimalzeichen.

    Führendes Minus bleibt erhalten — Gutschriften stehen negativ in der Datei.
    """
    s = (raw or "").strip()
    if not s:
        return None
    try:
        return Decimal(s.replace(".", "").replace(",", "."))
    except InvalidOperation:
        return None


def parse_date_weit(raw: str) -> date | None:
    """Wie `parse_date`, akzeptiert zusätzlich ISO-Datum und -Zeitstempel.

    Der Liefertreue-Export aus dem Einkauf mischt beides. `parse_date` bleibt
    bewusst streng: die Vertriebsdateien enthalten nur deutsche Datumsangaben,
    und ein ISO-Datum wäre dort ein Hinweis auf die falsche Datei.
    """
    s = (raw or "").strip()
    if not s:
        return None
    for form in ("%d.%m.%Y", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, form).date()
        except ValueError:
            continue
    return None


def decode_erp(contents: bytes) -> str:
    """ERP-Bytes zu Text — UTF-8, sonst cp1252, sonst Latin-1.

    cp1252 steht vor Latin-1, weil die Exporte von einem Windows-System
    kommen: dort liegen €, Anführungszeichen und Gedankenstrich im Bereich
    0x80–0x9F, den Latin-1 als Steuerzeichen liest. cp1252 lehnt fünf Bytes
    in diesem Bereich ab und fällt dann auf Latin-1 durch.
    """
    for encoding in ("utf-8", "cp1252", "latin-1"):
        try:
            return contents.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise ValueError("Datei ist weder UTF-8 noch cp1252 noch Latin-1")


def read_tabular(contents: bytes, *, kopf_erkennen: tuple[str, ...] = ()) -> pd.DataFrame:
    """Tab-getrennte ERP-Datei einlesen.

    Alles bleibt Text (`dtype=str`), damit pandas keine Vorgangsnummern in
    Zahlen verwandelt und führende Nullen erhalten bleiben.

    `kopf_erkennen` nennt Spaltennamen, an denen die Kopfzeile zu erkennen
    ist. Manche Exporte stellen eine Titelzeile voran („Auswertung:
    Liefertreue (von … bis …)"); alles davor wird übersprungen. Ohne die
    Angabe gilt die erste Zeile als Kopfzeile.
    """
    text = decode_erp(contents)

    ueberspringen = 0
    if kopf_erkennen:
        for i, zeile in enumerate(text.splitlines()[:10]):
            if all(name in zeile for name in kopf_erkennen):
                ueberspringen = i
                break

    df = pd.read_csv(
        io.StringIO(text),
        sep="\t",
        dtype=str,
        keep_default_na=False,
        skiprows=ueberspringen,
    )
    df.columns = [c.strip() for c in df.columns]
    return df
