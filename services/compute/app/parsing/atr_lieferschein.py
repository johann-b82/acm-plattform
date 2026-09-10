"""Parser für den Diehl-Lieferschein.

Zwei Teile, absichtlich getrennt:

* `lies_lieferschein(text)` wertet den Text aus. Rein, ohne Umwelt, und
  deshalb ohne PDF prüfbar — was hier zählt, ist die Erkennung der Felder,
  nicht die Extraktion.
* `text_aus_pdf(bytes)` ruft `pdftotext -layout`.

Der Spaltenerhalt (`-layout`) ist nicht Beiwerk: der Parser erkennt eine
Positionszeile an vier Feldern in fester Reihenfolge, und er schneidet eine
angeklebte Randnotiz an drei aufeinanderfolgenden Leerzeichen ab. Eine
Textextraktion ohne Layout liefert eine andere Reihenfolge und damit andere
Ergebnisse.

Aus `lumeapps` übernommen (`backend/app/services/atr_lieferschein.py`),
unverändert im Verhalten.
"""
from __future__ import annotations

import asyncio
import re
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

#: „  10  4711  2  Stk" — Position, Lieferantennummer, Menge, Einheit.
POSITION = re.compile(r"^\s*(\d+)\s+(\d+)\s+(\d+)\s+([A-Za-z]+)\b")
NUMMER = re.compile(r"\bNr\.\s+(\d+)")
DATUM = re.compile(r"\bDatum\s+(\d{2}\.\d{2}\.\d{4})")
INDEX = re.compile(r"Bauteil[- ]?[Ii]ndex:\s*([A-Za-z0-9]+)")
IHRE_NR = re.compile(r"Ihre Nr\.\s*(\S+)")
AUFTRAG = re.compile(r"Auftrag Nr\.\s*(\d+)\s*/\s*(\d+)")
BESTELLDATEN = re.compile(r"Bestelldaten\s*(\S+)")
SERIEN = re.compile(r"Seriennr\.\s*(.+)", re.IGNORECASE)


@dataclass
class Position:
    pos: int | None = None
    lieferantennummer: str | None = None
    menge: int = 1
    bezeichnung: str | None = None
    index: str | None = None
    teilenummer: str | None = None
    ba_auftrag: str | None = None
    bestellposition: str | None = None
    bestellnummer: str | None = None
    programm: str | None = None
    bereich: str | None = None
    msn: str | None = None
    bettvariante: str | None = None
    seriennummern: list[str] = field(default_factory=list)


@dataclass
class Lieferschein:
    lieferschein_nr: str | None = None
    datum: str | None = None
    positionen: list[Position] = field(default_factory=list)
    hinweise: list[str] = field(default_factory=list)


def _bestelldaten(kennung: str, p: Position) -> None:
    """„4711/CCRC/MSN123/2-Bett/A350" — durch Schrägstriche getrennte Merkmale
    in beliebiger Reihenfolge."""
    teile = kennung.split("/")
    if teile:
        p.bestellnummer = teile[0] or None
    for abschnitt in teile[1:]:
        s = abschnitt.strip()
        if s in ("CCRC", "FCRC"):
            p.bereich = s
        elif s.upper().startswith("MSN"):
            p.msn = s[3:] or None
        elif re.fullmatch(r"\d-?Bett", s, re.IGNORECASE) or s.lower().endswith("bett"):
            treffer = re.match(r"(\d+)", s)
            p.bettvariante = treffer.group(1) if treffer else None
        elif re.fullmatch(r"A\d{3}", s):
            p.programm = s


def lies_lieferschein(text: str) -> Lieferschein:
    schein = Lieferschein()
    zeilen = text.splitlines()

    for zeile in zeilen:
        if schein.lieferschein_nr is None:
            treffer = NUMMER.search(zeile)
            if treffer:
                schein.lieferschein_nr = treffer.group(1)
        if schein.datum is None:
            treffer = DATUM.search(zeile)
            if treffer:
                schein.datum = treffer.group(1)
        if schein.lieferschein_nr and schein.datum:
            break

    aktuell: Position | None = None
    for zeile in zeilen:
        kopf = POSITION.match(zeile)
        if kopf:
            if aktuell is not None:
                schein.positionen.append(aktuell)
            aktuell = Position(
                pos=int(kopf.group(1)),
                lieferantennummer=kopf.group(2),
                menge=int(kopf.group(3)),
            )
            continue
        if aktuell is None:
            continue

        if treffer := IHRE_NR.search(zeile):
            aktuell.teilenummer = treffer.group(1)
            continue
        if treffer := AUFTRAG.search(zeile):
            # „Auftrag Nr. <BA> / <Pos>" — die Zahl hinter dem Schrägstrich ist
            # die Bestellposition.
            aktuell.ba_auftrag = treffer.group(1)
            aktuell.bestellposition = treffer.group(2)
            continue
        if treffer := BESTELLDATEN.search(zeile):
            _bestelldaten(treffer.group(1), aktuell)
            continue
        if treffer := SERIEN.search(zeile):
            # „Seriennr. A08UAEL3376, A08UAEL3377" — eine je geliefertem Stück.
            aktuell.seriennummern = [
                s.strip() for s in treffer.group(1).split(",") if s.strip()
            ]
            continue
        if treffer := INDEX.search(zeile):
            aktuell.index = treffer.group(1)
            continue

        # Die erste Zeile nach dem Positionskopf, die kein Schlüsselwort trägt,
        # ist die Bezeichnung. `pdftotext -layout` klebt eine Randnotiz aus der
        # rechten Spalte mit an („Freigabe durch AV"); abgeschnitten wird am
        # ersten Lauf von drei Leerzeichen.
        s = zeile.strip()
        if s and aktuell.bezeichnung is None and not s.lower().startswith("teppich"):
            aktuell.bezeichnung = re.split(r"\s{3,}", s, maxsplit=1)[0].strip()

    if aktuell is not None:
        schein.positionen.append(aktuell)

    # Ein Lieferschein steckt manchmal zweimal in derselben PDF — zwei Kopien
    # hintereinander. Der Fließtext liefert dann jede Position doppelt.
    gesehen: set[tuple] = set()
    einmalig: list[Position] = []
    for p in schein.positionen:
        schluessel = (p.pos, p.teilenummer, p.ba_auftrag, p.bestellposition)
        if schluessel in gesehen:
            continue
        gesehen.add(schluessel)
        einmalig.append(p)
    entfernt = len(schein.positionen) - len(einmalig)
    if entfernt:
        schein.hinweise.append(
            f"Doppelter Lieferschein erkannt: {entfernt} Position(en) einmal gezählt."
        )
    schein.positionen = einmalig

    for p in schein.positionen:
        for feld, name in (
            ("ba_auftrag", "Auftrag"),
            ("teilenummer", "Ihre Nr."),
            ("bestellnummer", "Bestelldaten"),
        ):
            if getattr(p, feld) is None:
                schein.hinweise.append(f"Position {p.pos}: {name} fehlt")

    if not schein.positionen:
        schein.hinweise.append("Keine Positionen erkannt.")
    return schein


class TextNichtLesbar(ValueError):
    """`pdftotext` kam nicht durch."""


async def text_aus_pdf(daten: bytes) -> str:
    """Ruft `pdftotext -layout` und gibt den Text zurück."""
    with tempfile.TemporaryDirectory() as ordner:
        quelle = Path(ordner) / "ein.pdf"
        quelle.write_bytes(daten)
        prozess = await asyncio.create_subprocess_exec(
            "pdftotext",
            "-layout",
            str(quelle),
            "-",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            aus, fehler = await asyncio.wait_for(prozess.communicate(), timeout=30)
        except asyncio.TimeoutError as ausnahme:
            try:
                prozess.kill()
            except ProcessLookupError:
                pass
            await prozess.wait()
            raise TextNichtLesbar("pdftotext hat nach 30 s nicht geantwortet.") from ausnahme
        if prozess.returncode != 0:
            raise TextNichtLesbar(
                "pdftotext ist gescheitert: "
                + fehler.decode("utf-8", "replace")[-300:]
            )
        return aus.decode("utf-8", "replace")


async def lies_pdf(daten: bytes) -> Lieferschein:
    return lies_lieferschein(await text_aus_pdf(daten))
