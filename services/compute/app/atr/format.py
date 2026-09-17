"""Gemeinsame Formatierung für die ATR-Ausgaben."""
from __future__ import annotations

import re
from datetime import date

#: In Windows- und SMB-Dateinamen unzulässig. Leerzeichen, Komma, Punkt,
#: Binde- und Unterstrich bleiben.
_UNZULAESSIG = re.compile(r'[\\/:*?"<>|\x00-\x1f]+')

#: Grenze für Name samt Positionsliste. Wie im Altprojekt: so bleibt der ganze
#: Pfad in den tief verschachtelten QS-Ordnern unter der Windows-Grenze.
_NAME_HOECHSTENS = 130


def dateiname_basis(lieferung: dict, positionen: list[dict]) -> str:
    """Der beschreibende Dateiname eines ATR, ohne Endung.

    Wörtlich nach `delivery_filename_base` im Altprojekt — QS und Logistik
    suchen die Dateien unter diesem Namen, z. B.
    ``ACM_ATR_WR_COC_A350_ATR-4820-01 BA1024796_FCRC_MSN 844_4501124711 6 BED Head Pos 190, 200``.

    Teile ohne Wert fallen weg. Die Positionsliste am Ende entfällt ganz, wenn
    der Name damit zu lang würde.
    """

    def wert(feld: str) -> str:
        return str(lieferung.get(feld) or "").strip()

    programm = wert("programm") or "A350"
    atr = wert("atr_nummer")
    teile = [
        f"ACM_ATR_WR_COC_{programm}_ATR-{atr}-01" if atr
        else f"ACM_ATR_WR_COC_{programm}_ATR"
    ]
    if wert("ba_auftrag"):
        teile.append(f" BA{wert('ba_auftrag')}")
    if wert("bereich"):
        teile.append(f"_{wert('bereich')}")
    if wert("msn"):
        teile.append(f"_MSN {wert('msn')}")
    if wert("bestellnummer"):
        teile.append(f"_{wert('bestellnummer')}")
    if wert("bettvariante"):
        teile.append(f" {wert('bettvariante')} BED")
    kategorie = next((p["kategorie"] for p in positionen if p.get("kategorie")), None)
    if kategorie:
        teile.append(f" {kategorie.strip().title()}")
    name = "".join(teile)

    nummern = [
        b for b in (bestellposition(p.get("bestellposition")) for p in positionen) if b
    ]
    if nummern:
        mit_positionen = f"{name} Pos {', '.join(nummern)}"
        if len(mit_positionen) <= _NAME_HOECHSTENS:
            name = mit_positionen
    return _UNZULAESSIG.sub("", name).strip().rstrip(". ") or "atr"


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
