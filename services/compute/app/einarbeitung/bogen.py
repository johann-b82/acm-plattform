"""Der Einarbeitungsbogen als Formblatt.

Bildet die Vorlage nach: ACM-Kopfzeilentabelle mit Formblattnummer, Revision
und Logo; Kopf mit Name, Stelle, Beginn und Zeitraum; die Regeln und das Ziel;
die Inhaltstabelle (Abteilung · Ansprechpartner · Inhalt · Wann · Erledigt);
zuletzt die Freigabezeile.

Wie beim Wartungsnachweis: openpyxl schreibt eine Mappe, LibreOffice macht ein
PDF daraus. **Ohne Druckskalierung** — sonst verschieben sich Zeilenhöhen, und
die Freigabezeile sitzt nicht mehr am Blattfuß.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from io import BytesIO

from openpyxl import Workbook
from openpyxl.drawing.image import Image as ExcelBild
from openpyxl.styles import Alignment, Border, Font, Side
from openpyxl.worksheet.page import PageMargins
from openpyxl.worksheet.properties import PageSetupProperties

from app.dokumente.blatt import auf_a4
from app.dokumente.logo import Logo
from app.dokumente.pdf import nach_pdf

#: Kopfzeilentabelle nach ACM-Standard. Bei einer neuen Revision hier ändern.
FORMBLATT = "Fbl. 28 Einarbeitungsplan Rev. C vom 14.08.2026"
TITEL = "Einarbeitungsplan"
REVISION = "C"

#: Dauer ab Tätigkeitsbeginn, für das vorausgefüllte „bis".
DAUER = timedelta(days=28)

REGELN = [
    "Jeder neue Mitarbeiter wird anhand eines Einarbeitungsplans systematisch eingelernt.",
    "Die einzelnen Einarbeitungsschritte werden vom Mitarbeiter dokumentiert.",
    "Innerhalb der ersten 4 Wochen findet ein Feedbackgespräch statt.",
]
ZIEL = (
    "Ziel der Einarbeitung ist die gezielte Unterstützung der Abteilung durch den "
    "Aufbau der notwendigen Kenntnisse und Fähigkeiten in den relevanten Prozessen."
)
FREIGABE = [
    ("Erstellt durch:", "[Name] (QM/CMM)"),
    ("Geprüft durch:", "[Name] (TBL)"),
    ("Freigegeben durch:", "[Name] (QM/CMM)"),
]

#: Spalten wie in der Vorlage: A ist eine schmale Randspalte.
SP_ABTEILUNG, SP_PARTNER, SP_INHALT, SP_WANN, SP_ERLEDIGT = 2, 3, 4, 7, 8
SPALTENBREITEN = (3, 13, 17, 13, 13, 13, 8, 14)

_DUENN = Side(style="thin", color="000000")
_RAHMEN = Border(left=_DUENN, right=_DUENN, top=_DUENN, bottom=_DUENN)
_OBEN_LINKS = Alignment(horizontal="left", vertical="top", wrap_text=True)
_LINKS = Alignment(horizontal="left", vertical="center")
_MITTE = Alignment(horizontal="center", vertical="center", wrap_text=True)

#: Zeichen je Zeile für den Umbruch (9-pt-Text in der jeweiligen Spaltenbreite).
_ZEICHEN_ABTEILUNG, _ZEICHEN_PARTNER, _ZEICHEN_INHALT = 14, 19, 46
_ZEILE_PT, _POLSTER = 12.0, 5.0


@dataclass
class Inhalt:
    abteilung: str
    ansprechpartner: str
    inhalt: str


def _zeilen(text: str, breite: int) -> int:
    """Wie viele Zeilen der Text in dieser Spaltenbreite braucht."""
    if not text:
        return 1
    zeilen = 0
    for absatz in text.splitlines() or [""]:
        zeilen += max(1, -(-len(absatz) // breite))
    return zeilen


def _rahmen(blatt, zeile: int, von: int, bis: int) -> None:
    for spalte in range(von, bis + 1):
        blatt.cell(zeile, spalte).border = _RAHMEN


def _kopftabelle(blatt, logo: Logo | None) -> int:
    """Die ACM-Kopfzeilentabelle in den Zeilen 1–3: links Formblattnummer über
    Titel, in der Mitte die Revision, rechts das Logo. Gibt die erste freie
    Inhaltszeile zurück."""
    for zeile in (1, 2, 3):
        blatt.row_dimensions[zeile].height = 16

    blatt.merge_cells("B1:E1")
    nummer = blatt.cell(1, 2, FORMBLATT)
    nummer.font = Font(size=9, color="595959")
    nummer.alignment = _MITTE

    blatt.merge_cells("B2:E3")
    titel = blatt.cell(2, 2, TITEL)
    titel.font = Font(size=16, bold=True)
    titel.alignment = _MITTE

    blatt.merge_cells("F1:G3")
    revision = blatt.cell(1, 6, f"Revisions-Index: {REVISION}")
    revision.font = Font(size=8)
    revision.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)

    blatt.merge_cells("H1:H3")
    if logo is not None:
        # Auf Kopfzeilenhöhe verkleinert: drei Zeilen à 16 pt sind gut 64 px.
        breite = 90
        bild = ExcelBild(BytesIO(logo.daten))
        bild.width = breite
        bild.height = max(1, round(breite * logo.hoehe / logo.breite))
        blatt.add_image(bild, "H1")

    for zeile in (1, 2, 3):
        _rahmen(blatt, zeile, 2, 8)

    return 5


def _kopf(blatt, zeile: int, name: str, stelle: str | None, beginn: date | None) -> int:
    """Name, Stelle, Beginn und Zeitraum."""
    angaben = [
        ("Name:", name),
        ("Stelle:", stelle or ""),
        (
            "Tätigkeitsbeginn:",
            beginn.strftime("%d.%m.%Y") if beginn else "",
        ),
        (
            "Einarbeitung bis:",
            (beginn + DAUER).strftime("%d.%m.%Y") if beginn else "",
        ),
    ]
    for beschriftung, wert in angaben:
        # Beschriftung über zwei Spalten: „Tätigkeitsbeginn:" passt sonst nicht
        # und läuft in den Wert hinein.
        blatt.merge_cells(start_row=zeile, start_column=2, end_row=zeile, end_column=3)
        links = blatt.cell(zeile, SP_ABTEILUNG, beschriftung)
        links.font = Font(bold=True, size=10)
        links.alignment = _LINKS
        blatt.merge_cells(start_row=zeile, start_column=4, end_row=zeile, end_column=8)
        rechts = blatt.cell(zeile, 4, wert)
        rechts.font = Font(size=10)
        rechts.alignment = _LINKS
        rechts.border = Border(bottom=_DUENN)
        blatt.row_dimensions[zeile].height = 18
        zeile += 1
    return zeile + 1


def _einleitung(blatt, zeile: int) -> int:
    ueberschrift = blatt.cell(zeile, SP_ABTEILUNG, "Regeln")
    ueberschrift.font = Font(bold=True, size=10)
    zeile += 1
    for regel in REGELN:
        blatt.merge_cells(start_row=zeile, start_column=2, end_row=zeile, end_column=8)
        zelle = blatt.cell(zeile, 2, f"• {regel}")
        zelle.font = Font(size=9)
        zelle.alignment = _LINKS
        blatt.row_dimensions[zeile].height = 14
        zeile += 1

    zeile += 1
    blatt.merge_cells(start_row=zeile, start_column=2, end_row=zeile + 1, end_column=8)
    ziel = blatt.cell(zeile, 2, ZIEL)
    ziel.font = Font(size=9, italic=True)
    ziel.alignment = _OBEN_LINKS
    return zeile + 3


def _tabelle(blatt, zeile: int, inhalte: list[Inhalt]) -> int:
    kopf = [
        (SP_ABTEILUNG, "Abteilung"),
        (SP_PARTNER, "Ansprechpartner"),
        (SP_INHALT, "Inhalt"),
        (SP_WANN, "Wann?"),
        (SP_ERLEDIGT, "Erledigt / Unterschrift"),
    ]
    blatt.merge_cells(start_row=zeile, start_column=SP_INHALT, end_row=zeile, end_column=6)
    for spalte, text in kopf:
        zelle = blatt.cell(zeile, spalte, text)
        zelle.font = Font(bold=True, size=9)
        zelle.alignment = _MITTE
    _rahmen(blatt, zeile, 2, 8)
    blatt.row_dimensions[zeile].height = 22
    zeile += 1

    for eintrag in inhalte:
        blatt.merge_cells(start_row=zeile, start_column=SP_INHALT, end_row=zeile, end_column=6)
        for spalte, wert in (
            (SP_ABTEILUNG, eintrag.abteilung),
            (SP_PARTNER, eintrag.ansprechpartner),
            (SP_INHALT, eintrag.inhalt),
        ):
            zelle = blatt.cell(zeile, spalte, wert)
            zelle.font = Font(size=9)
            zelle.alignment = _OBEN_LINKS
        _rahmen(blatt, zeile, 2, 8)
        hoehe = max(
            _zeilen(eintrag.abteilung, _ZEICHEN_ABTEILUNG),
            _zeilen(eintrag.ansprechpartner, _ZEICHEN_PARTNER),
            _zeilen(eintrag.inhalt, _ZEICHEN_INHALT),
        )
        blatt.row_dimensions[zeile].height = hoehe * _ZEILE_PT + _POLSTER
        zeile += 1

    if not inhalte:
        blatt.merge_cells(start_row=zeile, start_column=2, end_row=zeile, end_column=8)
        leer = blatt.cell(zeile, 2, "Für diese Abteilung ist kein Inhalt hinterlegt.")
        leer.font = Font(italic=True, size=9)
        _rahmen(blatt, zeile, 2, 8)
        zeile += 1

    return zeile + 1


def _freigabe(blatt, zeile: int) -> int:
    spalten = [(2, 3), (4, 5), (6, 8)]
    for (von, bis), (rolle, wer) in zip(spalten, FREIGABE):
        blatt.merge_cells(start_row=zeile, start_column=von, end_row=zeile, end_column=bis)
        zelle = blatt.cell(zeile, von, f"{rolle} {wer}")
        zelle.font = Font(size=8)
        zelle.alignment = _LINKS
        zelle.border = Border(top=_DUENN)
    blatt.row_dimensions[zeile].height = 16
    return zeile + 1


def fuelle_blatt(
    blatt,
    name: str,
    stelle: str | None,
    beginn: date | None,
    inhalte: list[Inhalt],
    logo: Logo | None = None,
) -> None:
    """Das Formblatt in ein vorhandenes Arbeitsblatt schreiben.

    Herausgezogen aus `baue_xlsx`, damit dasselbe Blatt auch als erste Seite
    des Onboarding-Pakets dienen kann — zwei Formblätter in einer Mappe werden
    von LibreOffice in einem Zug zu einem mehrseitigen PDF.
    """
    blatt.title = "Einarbeitungsplan"

    for i, breite in enumerate(SPALTENBREITEN, start=1):
        blatt.column_dimensions[chr(64 + i)].width = breite

    zeile = _kopftabelle(blatt, logo)
    zeile = _kopf(blatt, zeile, name, stelle, beginn)
    zeile = _einleitung(blatt, zeile)
    zeile = _tabelle(blatt, zeile, inhalte)
    zeile = _freigabe(blatt, zeile + 1)

    blatt.print_area = f"A1:H{zeile}"
    auf_a4(blatt)
    blatt.page_margins = PageMargins(left=0.5, right=0.4, top=0.5, bottom=0.4)
    # Auf **eine** Seite Breite, so viele Seiten hoch wie nötig.
    #
    # Vorher stand hier feste Skalierung ohne Anpassung, weil eine Skalierung
    # die Zeilenhöhen verschiebt. Das Ergebnis war schlimmer: der Bogen lief
    # auf eine zweite Seite über, und die trug nur die abgeschnittenen rechten
    # Spalten — „Wann?" und „Erledigt / Unterschrift", die Felder also, die von
    # Hand ausgefüllt werden. Aufgefallen beim Prüfen des Onboarding-Pakets.
    #
    # Spaltenbreiten in „Zeichen" lassen sich nicht zuverlässig ausrechnen:
    # LibreOffice hat im Abbild kein Calibri und ersetzt es durch eine breitere
    # Schrift. Die Anpassung ist deshalb nicht Bequemlichkeit, sondern das
    # einzig Verlässliche.
    blatt.page_setup.scale = None  # schließt sich mit fitToPage aus
    blatt.page_setup.fitToWidth = 1
    blatt.page_setup.fitToHeight = 0
    blatt.sheet_properties.pageSetUpPr = PageSetupProperties(fitToPage=True)


def baue_xlsx(
    name: str,
    stelle: str | None,
    beginn: date | None,
    inhalte: list[Inhalt],
    logo: Logo | None = None,
) -> bytes:
    mappe = Workbook()
    fuelle_blatt(mappe.active, name, stelle, beginn, inhalte, logo)
    puffer = BytesIO()
    mappe.save(puffer)
    return puffer.getvalue()


async def baue_pdf(
    name: str,
    stelle: str | None,
    beginn: date | None,
    inhalte: list[Inhalt],
    logo: Logo | None = None,
) -> bytes:
    return await nach_pdf(
        baue_xlsx(name, stelle, beginn, inhalte, logo), name="einarbeitung"
    )
