"""Der Wartungsnachweis als Bogen zum Aushängen.

Ein Raster, kein Terminplan: Kalenderwochen quer, Aufgaben untereinander. Wer
wartet, zeichnet in der Spalte der Woche ab. Das ist das Blatt, das an der
Maschine hängt — und der Grund, warum es keine Tabelle mit fälligen Terminen
gibt.

Zwei Blätter, bewusst getrennt:

* **Periodisch** — ein Halbjahr, KW 1–26 oder 27–52, eine Zeile je Aufgabe,
  gruppiert nach Intervall.
* **Täglich** — nur wenn es tägliche Aufgaben gibt: ein Monat mit den Tagen
  1–31 und einem Feld für Monat und Jahr zum Eintragen.

Gebaut mit openpyxl, gewandelt von LibreOffice — dieselbe Kette wie bei der
ATR-Mappe.
"""
from __future__ import annotations

from io import BytesIO

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.properties import PageSetupProperties

from app.dokumente.pdf import nach_pdf

#: Reihenfolge der Gruppen auf dem periodischen Bogen.
PERIODISCH = ["woechentlich", "monatlich", "quartalsweise", "alle_n_wochen"]

INTERVALL_LABEL = {
    "taeglich": "Täglich",
    "woechentlich": "Wöchentlich",
    "monatlich": "Monatlich",
    "quartalsweise": "Quartalsweise",
    "alle_n_wochen": "Alle N Wochen",
}

_DUENN = Side(style="thin", color="9CA3AF")
_RAHMEN = Border(left=_DUENN, right=_DUENN, top=_DUENN, bottom=_DUENN)
_KOPF_FUELLUNG = PatternFill("solid", fgColor="E5E7EB")
_GRUPPE_FUELLUNG = PatternFill("solid", fgColor="F3F4F6")
_MITTE = Alignment(horizontal="center", vertical="center", wrap_text=True)
_LINKS = Alignment(horizontal="left", vertical="center", wrap_text=True)
_LINKS_EINZEILIG = Alignment(horizontal="left", vertical="center", wrap_text=False)


def intervall_text(aufgabe: dict) -> str:
    if aufgabe["intervall"] == "alle_n_wochen" and aufgabe.get("wochen"):
        return f"Alle {aufgabe['wochen']} Wochen"
    return INTERVALL_LABEL.get(aufgabe["intervall"], aufgabe["intervall"])


def _kopf(blatt, maschine: dict, untertitel: str, spalten: int) -> int:
    """Titel und Maschinenblock. Gibt die nächste freie Zeile zurück."""
    blatt.merge_cells(start_row=1, start_column=1, end_row=1, end_column=spalten)
    zelle = blatt.cell(1, 1, "Wartungsnachweis")
    zelle.font = Font(bold=True, size=16)
    zelle.alignment = Alignment(horizontal="left", vertical="center")

    blatt.merge_cells(start_row=2, start_column=1, end_row=2, end_column=spalten)
    unter = blatt.cell(2, 1, untertitel)
    unter.font = Font(bold=True, size=11, color="374151")
    unter.alignment = Alignment(horizontal="left", vertical="center")

    angaben = [
        ("Maschine", maschine.get("name") or "—"),
        ("Inventar-Nr.", maschine.get("inventarnummer") or "—"),
        ("Standort", maschine.get("standort") or "—"),
        ("Verantwortlich", maschine.get("verantwortlich") or "—"),
    ]
    # Der Wert wird über eine lesbare Breite verbunden, damit er nicht in die
    # schmalen Wochenspalten umbricht.
    ende = min(spalten, 8)
    for i, (label, wert) in enumerate(angaben):
        zeile = 3 + i
        links = blatt.cell(zeile, 1, f"{label}:")
        links.font = Font(bold=True, size=10)
        links.alignment = _LINKS_EINZEILIG
        if ende > 2:
            blatt.merge_cells(start_row=zeile, start_column=2, end_row=zeile, end_column=ende)
        rechts = blatt.cell(zeile, 2, str(wert))
        rechts.font = Font(size=10)
        rechts.alignment = _LINKS_EINZEILIG
    return 3 + len(angaben) + 1


def _raster(
    blatt,
    maschine: dict,
    untertitel: str,
    erste_spalte: str,
    zweite_spalte: str | None,
    spaltenkoepfe: list[str],
    zeilen: list[tuple[str, str]],
) -> None:
    """Ein Rasterblatt. `zeilen` sind Paare aus Gruppenbeschriftung und Titel."""
    beschriftungsspalten = 2 if zweite_spalte else 1
    spalten = beschriftungsspalten + len(spaltenkoepfe)

    kopfzeile = _kopf(blatt, maschine, untertitel, spalten)

    blatt.cell(kopfzeile, 1, erste_spalte)
    if zweite_spalte:
        blatt.cell(kopfzeile, 2, zweite_spalte)
    for j, text in enumerate(spaltenkoepfe):
        blatt.cell(kopfzeile, beschriftungsspalten + 1 + j, text)
    for spalte in range(1, spalten + 1):
        zelle = blatt.cell(kopfzeile, spalte)
        zelle.font = Font(bold=True, size=9)
        zelle.alignment = _MITTE
        zelle.fill = _KOPF_FUELLUNG
        zelle.border = _RAHMEN

    z = kopfzeile + 1
    for gruppe, titel in zeilen:
        if zweite_spalte:
            links = blatt.cell(z, 1, gruppe)
            links.font = Font(size=9)
            links.alignment = _LINKS
            links.fill = _GRUPPE_FUELLUNG
            links.border = _RAHMEN
            titelzelle = blatt.cell(z, 2, titel)
        else:
            titelzelle = blatt.cell(z, 1, titel)
        titelzelle.font = Font(size=9)
        titelzelle.alignment = _LINKS
        titelzelle.border = _RAHMEN
        for j in range(len(spaltenkoepfe)):
            blatt.cell(z, beschriftungsspalten + 1 + j).border = _RAHMEN
        blatt.row_dimensions[z].height = 26
        z += 1

    if not zeilen:
        blatt.merge_cells(start_row=z, start_column=1, end_row=z, end_column=spalten)
        leer = blatt.cell(z, 1, "Für diesen Bereich ist keine Aufgabe hinterlegt.")
        leer.font = Font(italic=True, size=9, color="6B7280")
        z += 1

    z += 1
    blatt.merge_cells(start_row=z, start_column=1, end_row=z, end_column=spalten)
    hinweis = blatt.cell(
        z,
        1,
        "Durchgeführte Wartung mit Unterschrift oder Stempel in der jeweiligen "
        "Spalte bestätigen.",
    )
    hinweis.font = Font(italic=True, size=9, color="374151")
    hinweis.alignment = _LINKS

    blatt.column_dimensions[get_column_letter(1)].width = 20 if zweite_spalte else 40
    if zweite_spalte:
        blatt.column_dimensions[get_column_letter(2)].width = 40
    for j in range(len(spaltenkoepfe)):
        blatt.column_dimensions[get_column_letter(beschriftungsspalten + 1 + j)].width = 4.2

    blatt.print_area = f"A1:{get_column_letter(spalten)}{z}"
    blatt.page_setup.orientation = "landscape"
    blatt.page_setup.fitToWidth = 1
    blatt.page_setup.fitToHeight = 0
    blatt.sheet_properties.pageSetUpPr = PageSetupProperties(fitToPage=True)


def baue_xlsx(maschine: dict, aufgaben: list[dict], jahr: int, halbjahr: int) -> bytes:
    mappe = Workbook()

    blatt = mappe.active
    blatt.title = "Periodisch"
    wochen = list(range(27, 53)) if halbjahr == 2 else list(range(1, 27))
    untertitel = f"Jahr {jahr} · KW {wochen[0]:02d}–{wochen[-1]:02d}"

    periodisch = [a for a in aufgaben if a["intervall"] in PERIODISCH]
    periodisch.sort(key=lambda a: (PERIODISCH.index(a["intervall"]), a["erstellt_am"]))
    _raster(
        blatt,
        maschine,
        untertitel,
        erste_spalte="Intervall",
        zweite_spalte="Wartungsaufgabe",
        spaltenkoepfe=[f"KW {w:02d}" for w in wochen],
        zeilen=[(intervall_text(a), a["titel"]) for a in periodisch],
    )

    taeglich = [a for a in aufgaben if a["intervall"] == "taeglich"]
    if taeglich:
        tagblatt = mappe.create_sheet("Täglich")
        _raster(
            tagblatt,
            maschine,
            f"Tägliche Wartung · Monat / Jahr: ____________ / {jahr}",
            erste_spalte="Wartungsaufgabe",
            zweite_spalte=None,
            spaltenkoepfe=[str(t) for t in range(1, 32)],
            zeilen=[("", a["titel"]) for a in taeglich],
        )

    puffer = BytesIO()
    mappe.save(puffer)
    return puffer.getvalue()


async def baue_pdf(maschine: dict, aufgaben: list[dict], jahr: int, halbjahr: int) -> bytes:
    return await nach_pdf(baue_xlsx(maschine, aufgaben, jahr, halbjahr), name="wartung")
