"""Das ACM-Logo nachträglich in den PDF-Kopf stempeln.

LibreOffice übernimmt beim Umwandeln der Mappe nach PDF die **Druckkopf-Grafik**
(`&G`) nicht — das Blatt trägt das Logo, das erzeugte PDF nicht. Das Altprojekt
setzte es über ein UNO-Makro als Kopf-Hintergrundgrafik (`atr_uno_header.py`,
`HeaderBackGraphic`, links oben, ~14 mm hoch, auf jeder Seite). Das
`python3-uno`-Paket ist im Abbild nicht vorhanden; deshalb stempeln wir das Logo
hier nachträglich — links oben auf **jede** Seite, in derselben Lage und Größe.

Das Logo kommt aus der Gerüst-Vorlage (`xl/media/image1.png`) — dieselbe Grafik,
die das Blatt in seiner Druckkopfzeile trägt.
"""
from __future__ import annotations

import zipfile
from io import BytesIO

from PIL import Image
from pypdf import PdfReader, PdfWriter, Transformation

#: Höhe des Logos im Kopf (~14 mm wie in der Referenz) und die Ränder. Der obere
#: Rand ist knapp gehalten, damit der Logo-Unterrand nicht auf der oberen
#: Tabellenlinie sitzt.
LOGO_HOEHE_PT = 40.0
RAND_LINKS_PT = 24.0
RAND_OBEN_PT = 8.0


def logo_aus_geruest(geruest: bytes) -> bytes | None:
    """Die Kopfgrafik der Vorlage, oder `None`, wenn keine da ist."""
    try:
        with zipfile.ZipFile(BytesIO(geruest)) as z:
            return z.read("xl/media/image1.png")
    except (KeyError, zipfile.BadZipFile):
        return None


def _logo_als_pdfseite(logo_png: bytes):
    bild = Image.open(BytesIO(logo_png))
    # PDF kennt keine Transparenz — auf Weiß legen, sonst würde der Alpha-Rand
    # schwarz. `P`/`LA`/`RGBA` tragen einen Alphakanal.
    if bild.mode in ("RGBA", "LA") or (bild.mode == "P" and "transparency" in bild.info):
        rgba = bild.convert("RGBA")
        grund = Image.new("RGB", rgba.size, "white")
        grund.paste(rgba, mask=rgba.split()[-1])
        bild = grund
    else:
        bild = bild.convert("RGB")
    puffer = BytesIO()
    bild.save(puffer, format="PDF")
    return PdfReader(BytesIO(puffer.getvalue())).pages[0]


def kopf_logo(pdf: bytes, logo_png: bytes) -> bytes:
    """Stempelt das Logo links oben auf jede Seite des PDF und gibt es zurück.

    Schlägt das Bild fehl, kommt das PDF unverändert zurück — ein fehlendes Logo
    darf die Erzeugung nicht kippen."""
    try:
        logo = _logo_als_pdfseite(logo_png)
    except Exception:  # noqa: BLE001 — ein kaputtes Logo ist kein Grund zu scheitern
        return pdf

    lbreite = float(logo.mediabox.width) or 1.0
    lhoehe = float(logo.mediabox.height) or 1.0
    faktor = LOGO_HOEHE_PT / lhoehe

    reader = PdfReader(BytesIO(pdf))
    schreiber = PdfWriter()
    for seite in reader.pages:
        hoehe = float(seite.mediabox.height)
        # Links oben: unten-links des Logos bei (linker Rand, Seitenhöhe − oberer
        # Rand − Logohöhe).
        umformung = Transformation().scale(faktor).translate(
            RAND_LINKS_PT, hoehe - RAND_OBEN_PT - LOGO_HOEHE_PT
        )
        seite.merge_transformed_page(logo, umformung)
        schreiber.add_page(seite)
    aus = BytesIO()
    schreiber.write(aus)
    return aus.getvalue()
