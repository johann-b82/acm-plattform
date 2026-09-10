"""Die Schulungsübersicht aus Excel lesen.

Aufbau der Quelldatei:

* Je Bereich ein Arbeitsblatt: „betrieblich (gesamt)", „Produktion",
  „Verwaltung".
* Die Matrix ist **transponiert**: Spalten sind Mitarbeiter, Zeilen sind
  Schulungen.
* Kopfbereich je Blatt (Spalte E beschriftet, ab Spalte F die Mitarbeiter):
  „Pers.Nr." / „Name, Vorname" / „Abt."
* Je Schulung **drei aufeinanderfolgende Zeilen**: Spalte B trägt den Turnus,
  Spalte C den Namen (nur in der ersten Zeile), Spalte D die Art des Werts —
  Initial, aktuell, nächste.

Der Leser ist bewusst nachsichtig: die Datei ist gewachsen und führt Daten mal
als echtes Datum, mal als Jahreszahl, mal als Freitext. Was sich nicht deuten
lässt, wird gemeldet — nicht geraten.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime
from io import BytesIO

import openpyxl

#: Turnustext → Periode in Monaten. Bewusst zurückhaltend: eine Spanne
#: („alle 3 - 5 Jahre") und „bei Bedarf" ergeben keine berechenbare Frist.
TURNUS_MONATE: dict[str, int | None] = {
    "jährlich": 12,
    "jaehrlich": 12,
    "alle 2 jahre": 24,
    "alle 2 jahre (und bei bedarf)": 24,
    "alle 3 - 5 jahre": None,
    "alle 3-5 jahre": None,
    "bei bedarf": None,
}

KOPF_NUMMER = "pers.nr."
KOPF_NAME = "name, vorname"
KOPF_ABTEILUNG = "abt."
ERSTE_PERSONENSPALTE = 6  # Spalte F


@dataclass
class Teilnahme:
    personalnummer: str
    mitarbeiter_name: str | None
    abteilung_kuerzel: str | None
    initial_datum: date | None = None
    aktuell_datum: date | None = None
    naechste_faellig: str | None = None


@dataclass
class Schulung:
    bereich: str
    name: str
    turnus: str | None
    turnus_monate: int | None
    sortierung: int
    teilnahmen: list[Teilnahme] = field(default_factory=list)


@dataclass
class Uebersicht:
    schulungen: list[Schulung] = field(default_factory=list)
    hinweise: list[str] = field(default_factory=list)

    @property
    def teilnahmen(self) -> int:
        return sum(len(s.teilnahmen) for s in self.schulungen)


def _norm(wert: object) -> str:
    """Weißraum — auch Zeilenumbrüche in Zellen — auf ein Leerzeichen bringen."""
    if wert is None:
        return ""
    return re.sub(r"\s+", " ", str(wert)).strip()


def turnus_zu_monaten(turnus: str | None) -> int | None:
    if not turnus:
        return None
    return TURNUS_MONATE.get(_norm(turnus).lower())


def als_datum(wert: object) -> date | None:
    """Eine Zelle als Datum lesen — echtes Datum, Jahreszahl oder Text."""
    if wert is None or wert == "":
        return None
    if isinstance(wert, datetime):
        return wert.date()
    if isinstance(wert, date):
        return wert
    text = _norm(wert)
    # Eine reine Jahreszahl wird der 1. Januar, damit die Reihenfolge stimmt.
    if re.fullmatch(r"(19|20)\d{2}", text):
        return date(int(text), 1, 1)
    for muster in ("%Y-%m-%d", "%d.%m.%Y", "%d.%m.%y"):
        try:
            return datetime.strptime(text, muster).date()
        except ValueError:
            continue
    return None


def _personenspalten(blatt) -> tuple[dict[int, tuple[str, str | None, str | None]], list[str]]:
    """Den Kopfbereich lesen: Spalte → (Personalnummer, Name, Abteilungskürzel)."""
    hinweise: list[str] = []
    zeile_nummer = zeile_name = zeile_abteilung = None
    for zeile in range(1, 12):
        beschriftung = _norm(blatt.cell(zeile, 5).value).lower()  # Spalte E
        if beschriftung.startswith(KOPF_NUMMER):
            zeile_nummer = zeile
        elif beschriftung.startswith(KOPF_NAME):
            zeile_name = zeile
        elif beschriftung.startswith(KOPF_ABTEILUNG):
            zeile_abteilung = zeile

    if zeile_nummer is None:
        hinweise.append(
            f"[{blatt.title}] Kopfzeile „Pers.Nr.“ nicht gefunden — "
            "Blatt übersprungen."
        )
        return {}, hinweise

    spalten: dict[int, tuple[str, str | None, str | None]] = {}
    for spalte in range(ERSTE_PERSONENSPALTE, blatt.max_column + 1):
        nummer = _norm(blatt.cell(zeile_nummer, spalte).value)
        if not nummer:
            continue
        name = _norm(blatt.cell(zeile_name, spalte).value) if zeile_name else ""
        abteilung = _norm(blatt.cell(zeile_abteilung, spalte).value) if zeile_abteilung else ""
        spalten[spalte] = (nummer, name or None, abteilung or None)
    return spalten, hinweise


def lies_uebersicht(daten: bytes) -> Uebersicht:
    """Die Übersicht einlesen; wirft nicht, sondern sammelt Hinweise."""
    ergebnis = Uebersicht()
    mappe = openpyxl.load_workbook(BytesIO(daten), data_only=True)

    for blatt in mappe.worksheets:
        bereich = _norm(blatt.title).replace(" (gesamt)", "")
        spalten, hinweise = _personenspalten(blatt)
        ergebnis.hinweise.extend(hinweise)
        if not spalten:
            continue

        sortierung = 0
        zeile = 1
        while zeile <= blatt.max_row:
            name = _norm(blatt.cell(zeile, 3).value)  # Spalte C
            art = _norm(blatt.cell(zeile, 4).value).lower()  # Spalte D
            # Eine Schulung beginnt, wo ein Name **und** „Initial" stehen.
            if not name or art != "initial":
                zeile += 1
                continue

            turnus = _norm(blatt.cell(zeile, 2).value) or None  # Spalte B
            if turnus in ("-", "–"):
                turnus = None
            monate = turnus_zu_monaten(turnus)
            if turnus and monate is None and _norm(turnus).lower() not in TURNUS_MONATE:
                ergebnis.hinweise.append(
                    f"[{blatt.title}] Unbekannter Turnus „{turnus}“ bei "
                    f"„{name}“ — keine Fälligkeit berechenbar."
                )

            sortierung += 1
            schulung = Schulung(
                bereich=bereich,
                name=name,
                turnus=turnus,
                turnus_monate=monate,
                sortierung=sortierung,
            )

            # Die beiden Folgezeilen tragen „aktuell" und „nächste".
            zeile_aktuell = (
                zeile + 1 if _norm(blatt.cell(zeile + 1, 4).value).lower() == "aktuell" else None
            )
            zeile_naechste = (
                zeile + 2
                if _norm(blatt.cell(zeile + 2, 4).value).lower().startswith("näch")
                else None
            )

            for spalte, (nummer, person, abteilung) in spalten.items():
                initial = als_datum(blatt.cell(zeile, spalte).value)
                aktuell = (
                    als_datum(blatt.cell(zeile_aktuell, spalte).value) if zeile_aktuell else None
                )
                naechste = (
                    _norm(blatt.cell(zeile_naechste, spalte).value) if zeile_naechste else ""
                )
                # Nur Zeilen aufnehmen, die für diese Person etwas aussagen.
                if initial is None and aktuell is None and not naechste:
                    continue
                schulung.teilnahmen.append(
                    Teilnahme(
                        personalnummer=nummer,
                        mitarbeiter_name=person,
                        abteilung_kuerzel=abteilung,
                        initial_datum=initial,
                        aktuell_datum=aktuell,
                        naechste_faellig=naechste or None,
                    )
                )

            ergebnis.schulungen.append(schulung)
            zeile += 3

    return ergebnis
