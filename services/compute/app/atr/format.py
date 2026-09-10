"""Gemeinsame Formatierung für die ATR-Ausgaben."""
from __future__ import annotations

from datetime import date


def bestellposition(wert: str | None) -> str | None:
    """Rein numerische Bestellposition auf drei Stellen bringen.

    ``"1" → "010"``, ``"12" → "120"``, ``"5" → "050"``. Eine Angabe, die schon
    drei Stellen hat, bleibt — die Funktion läuft beim Schreiben **und** beim
    Erzeugen und muss deshalb wiederholbar sein. Leeres, Nicht-Numerisches und
    alles über drei Stellen bleibt unangetastet; Positionen sind in der Praxis
    ein- bis zweistellig.
    """
    if wert is None:
        return None
    gestutzt = wert.strip()
    if not gestutzt.isdigit():
        return wert
    if len(gestutzt) == 3:
        return gestutzt
    if len(gestutzt) <= 2:
        return (gestutzt + "0").zfill(3)
    return wert


def deutsches_datum(wert) -> str:
    """TT.MM.JJJJ; alles, was kein Datum ist, kommt unverändert zurück."""
    try:
        return wert.strftime("%d.%m.%Y")
    except AttributeError:
        return str(wert)


def dokumentnummer(atr_nummer: str | None, programm: str | None) -> str:
    """Die Doc-No der Druckkopfzeile, aus der ATR-Nummer abgeleitet.

    ``4820`` → ``ACM-A350CRC-ATR-4820-01 / Issue: 01``. Ohne ATR-Nummer bleibt
    die Familienkonstante stehen.
    """
    nummer = (atr_nummer or "").strip()
    if not nummer:
        return "ACM-A350CRC-ATR-000-01 / Issue: 01"
    if "380" in (programm or ""):
        return f"ACM-A380-ATR-{nummer}-01 / Issue: 01"
    return f"ACM-A350CRC-ATR-{nummer}-01 / Issue: 01"


def heute() -> date:
    return date.today()


def programmfamilie(text: str | None) -> str | None:
    """Reduziert eine Programmangabe auf ihre Familie.

    Die Referenzmappe schreibt ``A350 XWB`` und ``A380 - 800``, der
    Lieferschein ``A350`` — dieselbe Sache in drei Schreibweisen. Als Schlüssel
    taugt nur die Familie, sonst fände eine Lieferung ihre Vorlage nie.
    Nachgesehen an den echten Vorlagen aus der Produktion.
    """
    if not text:
        return None
    gestutzt = text.strip().upper()
    for familie in ("A350", "A380"):
        if familie in gestutzt.replace(" ", "").replace("-", ""):
            return familie
    return text.strip() or None
