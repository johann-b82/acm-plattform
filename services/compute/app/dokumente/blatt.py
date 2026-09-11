"""Was jedes erzeugte Formblatt gemeinsam hat: A4.

LibreOffice nimmt ohne Angabe **Letter** — 216 × 279 mm statt 210 × 297. Wer
das ausdruckt, bekommt andere Ränder und ein Blatt, das nicht in den Ordner
passt. Beim Prüfen des Onboarding-Pakets ist es aufgefallen: `pdfinfo` meldete
`612 x 792 pts (letter)` für alle Formblätter, weil openpyxl die Papiergröße
nur schreibt, wenn man sie setzt.

Deshalb ein Helfer statt vier Stellen, an denen man es vergessen kann.
"""
from __future__ import annotations


def auf_a4(blatt, *, quer: bool = False) -> None:
    """Papiergröße und Ausrichtung setzen. Ohne das druckt LibreOffice Letter."""
    blatt.page_setup.paperSize = blatt.PAPERSIZE_A4
    blatt.page_setup.orientation = "landscape" if quer else "portrait"
