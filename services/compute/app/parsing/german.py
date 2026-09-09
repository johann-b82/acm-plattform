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


def read_tabular(contents: bytes) -> pd.DataFrame:
    """Tab-getrennte ERP-Datei einlesen; erst UTF-8, dann Latin-1.

    Alles bleibt Text (`dtype=str`), damit pandas keine Vorgangsnummern in
    Zahlen verwandelt und führende Nullen erhalten bleiben.
    """
    last_error: Exception | None = None
    for encoding in ("utf-8", "latin-1"):
        try:
            df = pd.read_csv(
                io.BytesIO(contents),
                sep="\t",
                dtype=str,
                keep_default_na=False,
                encoding=encoding,
            )
            df.columns = [c.strip() for c in df.columns]
            return df
        except UnicodeDecodeError as exc:
            last_error = exc
    raise ValueError("Datei ist weder UTF-8 noch Latin-1") from last_error
