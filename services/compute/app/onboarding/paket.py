"""Das Onboarding-Paket: Einarbeitungsplan **und** Schulungsübersicht.

Ein Dokument zur Übergabe an die Führungskraft, nicht zwei. Beide Formblätter
landen als zwei Blätter **einer** Arbeitsmappe; LibreOffice wandelt sie in
einem Zug zu einem mehrseitigen PDF. Das spart eine PDF-Zusammenführung als
zusätzliche Abhängigkeit — und die beiden Blätter behalten je ihre eigene
Seiteneinrichtung, was eine Zusammenführung nicht garantieren würde.

Reihenfolge: erst der Einarbeitungsplan (was in den ersten vier Wochen
passiert), dann die Schulungsübersicht (was darüber hinaus ansteht).
"""
from __future__ import annotations

from datetime import date
from io import BytesIO

from openpyxl import Workbook

from app.dokumente.logo import Logo
from app.dokumente.pdf import nach_pdf
from app.einarbeitung.bogen import Inhalt
from app.einarbeitung.bogen import fuelle_blatt as fuelle_einarbeitung
from app.onboarding.uebersicht import Zeile
from app.onboarding.uebersicht import fuelle_blatt as fuelle_uebersicht


def baue_xlsx(
    name: str,
    stelle: str | None,
    beginn: date | None,
    einarbeitung: list[Inhalt],
    schulungen: list[Zeile],
    logo: Logo | None = None,
) -> bytes:
    mappe = Workbook()
    fuelle_einarbeitung(mappe.active, name, stelle, beginn, einarbeitung, logo)
    fuelle_uebersicht(mappe.create_sheet(), name, stelle or "", schulungen, logo=logo)
    puffer = BytesIO()
    mappe.save(puffer)
    return puffer.getvalue()


async def baue_pdf(
    name: str,
    stelle: str | None,
    beginn: date | None,
    einarbeitung: list[Inhalt],
    schulungen: list[Zeile],
    logo: Logo | None = None,
) -> bytes:
    return await nach_pdf(
        baue_xlsx(name, stelle, beginn, einarbeitung, schulungen, logo),
        name="onboarding-paket",
    )
