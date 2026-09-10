"""Die Qualifikationsmatrix aus Excel lesen.

Die vier Bereichsdateien sind gleich gebaut, nur die Kopfzeile sitzt je nach
Datei auf Zeile 4 bis 6. Sie wird deshalb nicht festgeschrieben, sondern über
den Text „Anzahl Mitarbeiter" gesucht.

Aufbau eines Blattes::

      B     C           D              F        G         I    J    K    L
    R6  | Nr | Kategorie | Bezeichnung | Anzahl | Schnitt | <Name 1> | <Name 2>
    R7  | 1  | Allgemein | Deutsch     | 2      | 90      | AL | E% | AL | E%

Je Person zwei Spalten: Anforderungslevel (0–4) und Erfüllungsgrad (0–100 %).
„Anzahl Mitarbeiter" und „Durchschnitt" sind Formeln und kommen bewusst nicht
mit — beides ist aus den Bewertungen ableitbar, und eine gespeicherte
Ableitung geht beim ersten Schreibvorgang daneben.
"""
from __future__ import annotations

import io
from dataclasses import dataclass, field
from datetime import date, datetime

from openpyxl import load_workbook

#: Erste Spalte mit Personendaten (I).
ERSTE_PERSONENSPALTE = 9
SPALTE_NR = 2
SPALTE_KATEGORIE = 3
SPALTE_BEZEICHNUNG = 4
#: Blätter ohne Matrix.
UEBERSPRINGEN = ("diagramm",)


class MatrixUnbrauchbar(ValueError):
    """In der Datei war keine Qualifikationsmatrix zu finden."""


@dataclass
class Bewertung:
    person: int
    anforderungslevel: int | None
    erfuellungsgrad: int | None


@dataclass
class Qualifikation:
    nr: int | None
    kategorie: str | None
    bezeichnung: str
    reihenfolge: int
    bewertungen: list[Bewertung] = field(default_factory=list)


@dataclass
class Matrix:
    blatt: str
    titel: str | None
    stand: date | None
    personen: list[str]
    qualifikationen: list[Qualifikation]


@dataclass
class Datei:
    dateiname: str
    matrizen: list[Matrix]
    hinweise: list[str] = field(default_factory=list)


def _text(wert: object) -> str | None:
    if wert is None:
        return None
    zusammen = " ".join(str(wert).split())
    return zusammen or None


def _zahl(wert: object, unten: int, oben: int) -> int | None:
    """Zahl im erlaubten Bereich, sonst nichts — „N/A" kommt als Text vor."""
    if isinstance(wert, bool) or not isinstance(wert, (int, float)):
        return None
    gerundet = int(round(wert))
    return gerundet if unten <= gerundet <= oben else None


def _kopfzeile(blatt) -> int | None:
    for zeile in range(1, min(blatt.max_row, 15) + 1):
        for spalte in range(1, 9):
            wert = blatt.cell(row=zeile, column=spalte).value
            if wert and "Anzahl Mitarbeiter" in str(wert):
                return zeile
    return None


def _stand(blatt) -> date | None:
    """Das „Stand"-Datum: Beschriftung in der Kopfzeile, Wert daneben."""
    for zeile in range(1, 4):
        for spalte in range(1, 10):
            wert = blatt.cell(row=zeile, column=spalte).value
            if wert and str(wert).strip().rstrip(":").lower() == "stand":
                nachbar = blatt.cell(row=zeile, column=spalte + 1).value
                if isinstance(nachbar, datetime):
                    return nachbar.date()
                if isinstance(nachbar, date):
                    return nachbar
    return None


def _lies_blatt(blatt) -> Matrix | None:
    kopf = _kopfzeile(blatt)
    if kopf is None:
        return None

    # Personen: ab Spalte I in Zweierschritten, der Name steht über der
    # Anforderungsspalte.
    personen: list[str] = []
    spalten: list[int] = []
    for spalte in range(ERSTE_PERSONENSPALTE, blatt.max_column + 1, 2):
        name = _text(blatt.cell(row=kopf, column=spalte).value)
        if name:
            personen.append(name)
            spalten.append(spalte)
    if not personen:
        return None

    qualifikationen: list[Qualifikation] = []
    for zeile in range(kopf + 1, blatt.max_row + 1):
        bezeichnung = _text(blatt.cell(row=zeile, column=SPALTE_BEZEICHNUNG).value)
        if not bezeichnung:
            continue  # Leer- und Zwischenzeilen

        qualifikation = Qualifikation(
            nr=_zahl(blatt.cell(row=zeile, column=SPALTE_NR).value, 0, 10_000),
            kategorie=_text(blatt.cell(row=zeile, column=SPALTE_KATEGORIE).value),
            bezeichnung=bezeichnung,
            reihenfolge=len(qualifikationen),
        )
        for index, spalte in enumerate(spalten):
            level = _zahl(blatt.cell(row=zeile, column=spalte).value, 0, 4)
            grad = _zahl(blatt.cell(row=zeile, column=spalte + 1).value, 0, 100)
            if level is None and grad is None:
                continue  # nichts eingetragen — keine Zelle anlegen
            qualifikation.bewertungen.append(Bewertung(index, level, grad))
        qualifikationen.append(qualifikation)

    titel = None
    for spalte in range(1, 8):
        wert = _text(blatt.cell(row=1, column=spalte).value)
        if wert and "matrix" in wert.lower():
            titel = wert
            break

    return Matrix(
        blatt=blatt.title.strip(),
        titel=titel,
        stand=_stand(blatt),
        personen=personen,
        qualifikationen=qualifikationen,
    )


def lies_matrixdatei(daten: bytes, dateiname: str) -> Datei:
    """Alle Matrix-Blätter einer Bereichsdatei einlesen.

    Quality bringt drei Blätter mit (QM, CS, QS), die anderen Bereiche eines.
    Das Diagrammblatt enthält nur Formelverweise und wird übersprungen.
    """
    mappe = load_workbook(io.BytesIO(daten), data_only=True)
    ergebnis = Datei(dateiname=dateiname, matrizen=[])

    for name in mappe.sheetnames:
        if any(teil in name.lower() for teil in UEBERSPRINGEN):
            continue
        matrix = _lies_blatt(mappe[name])
        if matrix is None:
            ergebnis.hinweise.append(
                f"Blatt \u201e{name}\u201c \u00fcbersprungen: keine Kopfzeile "
                "\u201eAnzahl Mitarbeiter\u201c oder keine Personenspalten."
            )
            continue
        ergebnis.matrizen.append(matrix)

    if not ergebnis.matrizen:
        raise MatrixUnbrauchbar("In der Datei steht keine Qualifikationsmatrix.")
    return ergebnis
