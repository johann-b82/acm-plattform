"""Das ATR-Logo wird nachträglich in den PDF-Kopf gestempelt.

LibreOffice übernimmt die Druckkopf-Grafik nicht; das Altprojekt tat es per UNO,
hier geschieht es als PDF-Nachbearbeitung. Geprüft ohne LibreOffice: ein
einfaches PDF, ein Logo, und was der Stempel daraus macht.
"""
from __future__ import annotations

import io
import zipfile

from PIL import Image
from pypdf import PdfReader

from app.atr.pdf_logo import kopf_logo, logo_aus_geruest


def _png(w: int, h: int, farbe=(0, 0, 255)) -> bytes:
    b = io.BytesIO()
    Image.new("RGB", (w, h), farbe).save(b, format="PNG")
    return b.getvalue()


def _pdf(seiten: int = 2) -> bytes:
    blaetter = [Image.new("RGB", (842, 595), "white") for _ in range(seiten)]
    b = io.BytesIO()
    blaetter[0].save(b, format="PDF", save_all=True, append_images=blaetter[1:])
    return b.getvalue()


def test_stempelt_das_logo_auf_jede_seite():
    pdf = _pdf(2)
    out = kopf_logo(pdf, _png(300, 100))
    r = PdfReader(io.BytesIO(out))
    assert len(r.pages) == 2
    # Jede Seite trägt nach dem Stempeln mehr XObjects (Grundbild + Logo).
    for seite in r.pages:
        xobjekte = seite["/Resources"]["/XObject"]
        assert len(xobjekte) >= 2


def test_logo_aus_geruest_liest_die_kopfgrafik():
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w") as z:
        z.writestr("xl/media/image1.png", _png(10, 10))
    assert logo_aus_geruest(b.getvalue()) is not None
    # Ohne Grafik oder bei kaputtem Zip: kein Logo, kein Fehler.
    leer = io.BytesIO()
    with zipfile.ZipFile(leer, "w") as z:
        z.writestr("xl/worksheets/sheet1.xml", b"<x/>")
    assert logo_aus_geruest(leer.getvalue()) is None
    assert logo_aus_geruest(b"kein zip") is None


def test_kaputtes_logo_laesst_das_pdf_unveraendert():
    pdf = _pdf(1)
    assert kopf_logo(pdf, b"kein bild") == pdf
