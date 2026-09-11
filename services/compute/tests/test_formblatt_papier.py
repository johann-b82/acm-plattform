"""Jedes erzeugte Formblatt ist A4 — und passt in die Breite.

Zwei Fehler, die beim Prüfen des Onboarding-Pakets aufgefallen sind und die
sonst niemand meldet, weil sie erst am Drucker auftauchen:

1. **Ohne gesetzte Papiergröße druckt LibreOffice Letter.** `pdfinfo` meldete
   `612 x 792 pts (letter)` für alle Formblätter — 216 × 279 mm statt
   210 × 297. Wer das ausdruckt, bekommt andere Ränder und ein Blatt, das nicht
   in den Ordner passt.

2. **Der Einarbeitungsplan lief seitlich über.** Die zweite Seite trug nur die
   abgeschnittenen rechten Spalten — „Wann?" und „Erledigt / Unterschrift",
   also genau die Felder, die von Hand ausgefüllt werden.

Spaltenbreiten in „Zeichen" lassen sich nicht ausrechnen: LibreOffice hat im
Abbild kein Calibri und ersetzt es durch eine breitere Schrift. Deshalb prüft
dieser Test die Einrichtung, nicht die Zahlen.
"""
from __future__ import annotations

from datetime import date
from io import BytesIO

import pytest
from openpyxl import load_workbook

from app.einarbeitung.bogen import Inhalt
from app.einarbeitung.bogen import baue_xlsx as einarbeitung_xlsx
from app.onboarding.paket import baue_xlsx as paket_xlsx
from app.onboarding.uebersicht import Zeile
from app.onboarding.uebersicht import baue_xlsx as uebersicht_xlsx
from app.wartung.bogen import baue_xlsx as wartung_xlsx

EINARBEITUNG = [Inhalt("Produktion", "Frau Meier", "Sicherheitsunterweisung an der Fräse")]
SCHULUNGEN = [Zeile(bezeichnung="Produktion: Brandschutzunterweisung")]


def blaetter(daten: bytes):
    return load_workbook(BytesIO(daten)).worksheets


def alle_formblaetter() -> list[tuple[str, bytes]]:
    return [
        ("Einarbeitungsplan", einarbeitung_xlsx("Dana Neu", "CNC", date(2026, 9, 5), EINARBEITUNG)),
        ("Schulungsübersicht", uebersicht_xlsx("Dana Neu", "CNC", SCHULUNGEN)),
        ("Onboarding-Paket", paket_xlsx("Dana Neu", "CNC", date(2026, 9, 5), EINARBEITUNG, SCHULUNGEN)),
    ]


@pytest.mark.parametrize("name, daten", alle_formblaetter(), ids=lambda x: x if isinstance(x, str) else "")
def test_jedes_blatt_ist_a4(name, daten):
    for blatt in blaetter(daten):
        # openpyxl liest die Größe als Zahl zurück, schreibt sie aber als Text.
        assert int(blatt.page_setup.paperSize) == int(blatt.PAPERSIZE_A4), (
            f"{name}/{blatt.title} ist nicht A4"
        )


@pytest.mark.parametrize("name, daten", alle_formblaetter(), ids=lambda x: x if isinstance(x, str) else "")
def test_jedes_blatt_passt_in_die_breite(name, daten):
    """Eine Seite breit, so viele Seiten hoch wie nötig."""
    for blatt in blaetter(daten):
        assert blatt.page_setup.fitToWidth == 1, f"{name}/{blatt.title} passt nicht in die Breite"
        assert blatt.page_setup.fitToHeight == 0, f"{name}/{blatt.title} wird in der Höhe gequetscht"
        assert blatt.sheet_properties.pageSetUpPr.fitToPage is True


def test_der_wartungsbogen_ist_a4_quer():
    """Quer, weil er eine Tabelle über das Halbjahr trägt — aber A4."""
    maschine = {"bezeichnung": "Fräse 1", "inventarnummer": "F-001", "standort": "Halle 1"}
    for blatt in blaetter(wartung_xlsx(maschine, [], 2026, 1)):
        assert int(blatt.page_setup.paperSize) == int(blatt.PAPERSIZE_A4)
        assert blatt.page_setup.orientation == "landscape"
