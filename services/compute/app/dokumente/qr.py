"""QR-Code und Passermarken auf einem Formblatt — und wo die Felder liegen.

Ein gedrucktes Blatt kommt als Scan zurück: schief, anders skaliert, vielleicht
auf dem Kopf. Damit sich trotzdem sagen lässt „in diesem Feld steht etwas",
braucht es zweierlei auf dem Papier:

  **Ein QR-Code** mit der Vorgangskennung. Er ordnet den Scan dem Vorgang zu —
  unabhängig von Dateiname und Schreibweise des Namens — und seine vier Ecken
  sind der erste Passer.

  **Zwei Passermarken**, kleine schwarze Quadrate in der leeren Randspalte oben
  und unten links. Zusammen mit dem QR oben rechts ergeben sie drei über die
  Seite verteilte Referenzpunkte. Mit einem einzigen Passer ließe sich die
  Skalierung nicht von der Verschiebung trennen.

Dazu die Rechnung, wo eine Zelle auf der Seite liegt: aus Spaltenbreiten und
Zeilenhöhen, normiert auf 0..1. Diese Rechteckliste wandert als `feld_layout`
in die Vorgangszeile und wird beim Prüfen wieder auf den Scan abgebildet.

**Die Umrechnung ist eine Näherung**, und das ist in Ordnung: openpyxl misst
Spalten in Zeichen der Standardschrift, LibreOffice rendert mit einer anderen.
Ein systematischer Skalierungsfehler fällt bei der Ausrichtung über die Passer
heraus — genau dafür sind sie da.
"""
from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO

#: A4 hochkant in Punkten.
A4_BREITE_PT, A4_HOEHE_PT = 595.276, 841.890

#: Umrechnungen openpyxl → Punkte. Eine Breiteneinheit sind rund 7 px, dazu
#: 5 px Innenabstand je Spalte; ein Pixel bei 96 dpi sind 0,75 pt.
PX_PRO_BREITE, PX_POLSTER, PT_PRO_PX = 7.0, 5.0, 0.75
#: Zeilenhöhe, wenn keine gesetzt ist.
STANDARD_ZEILE_PT = 15.0

#: Kantenlänge des QR in Pixel (rund 1,2 cm im Druck) und der Marken.
QR_PX = 46
MARKE_PX = 16


@dataclass(frozen=True)
class Geometrie:
    """Wie das Blatt auf der Seite sitzt."""

    spaltenbreiten: tuple[float, ...]
    #: Linker Rand in Pixeln (96 dpi), oberer in Punkten — so, wie
    #: `PageMargins` sie bekommt.
    rand_links_px: float = 48.0
    rand_oben_pt: float = 36.0


def x_norm(geo: Geometrie, spalte: int) -> float:
    """Linke Kante von `spalte` (1-basiert), auf die Seitenbreite normiert."""
    px = geo.rand_links_px
    for i in range(1, spalte):
        breite = geo.spaltenbreiten[i - 1] if i - 1 < len(geo.spaltenbreiten) else 8.43
        px += breite * PX_PRO_BREITE + PX_POLSTER
    return (px * PT_PRO_PX) / A4_BREITE_PT


def y_norm(blatt, geo: Geometrie, zeile: int) -> float:
    """Oberkante von `zeile` (1-basiert), auf die Seitenhöhe normiert."""
    pt = geo.rand_oben_pt
    for i in range(1, zeile):
        hoehe = blatt.row_dimensions[i].height
        pt += hoehe if hoehe is not None else STANDARD_ZEILE_PT
    return pt / A4_HOEHE_PT


def zellen_box(blatt, geo: Geometrie, zeile: int, von: int, bis: int) -> list[float]:
    """Das normierte Rechteck der Zelle(n) `zeile`, `von`..`bis`."""
    return [
        round(x_norm(geo, von), 5),
        round(y_norm(blatt, geo, zeile), 5),
        round(x_norm(geo, bis + 1), 5),
        round(y_norm(blatt, geo, zeile + 1), 5),
    ]


def bild_box(blatt, geo: Geometrie, spalte: int, zeile: int, px: int) -> list[float]:
    """Das normierte Rechteck eines quadratischen Bildes an (spalte, zeile)."""
    x0, y0 = x_norm(geo, spalte), y_norm(blatt, geo, zeile)
    return [
        round(x0, 5),
        round(y0, 5),
        round(x0 + (px * PT_PRO_PX) / A4_BREITE_PT, 5),
        round(y0 + (px * PT_PRO_PX) / A4_HOEHE_PT, 5),
    ]


def hoehen_festschreiben(blatt, bis: int) -> None:
    """Jeder Zeile eine Höhe geben.

    Die Feldliste rechnet die Lage der Prüfrechtecke aus den Zeilenhöhen.
    Bleibt eine ungesetzt, entscheidet LibreOffice selbst — je nach Inhalt
    anders, als ein Vorgabewert annimmt. Der Fehler summiert sich nach unten.

    Nachgemessen: ohne das saßen die Rechtecke eine Zeile zu hoch, nämlich auf
    dem Tabellenkopf statt auf der ersten Inhaltszeile. Die Passer können das
    nicht auffangen — sie korrigieren eine gleichmäßige Verzerrung, nicht ein
    Verrutschen mittendrin.
    """
    for zeile in range(1, bis + 1):
        if blatt.row_dimensions[zeile].height is None:
            blatt.row_dimensions[zeile].height = STANDARD_ZEILE_PT


def qr_png(doc_uid: str) -> bytes:
    """Der QR als scharfes PNG.

    Bewusst groß gerendert und erst beim Einsetzen verkleinert: rechnet man ihn
    vorher herunter, verwaschen die Module und der Scanner liest ihn nicht mehr.
    Fehlerkorrektur Q, weil ein Blatt geknickt und gestempelt zurückkommt.
    """
    import qrcode  # träge geladen: das Modul bleibt auch ohne qrcode importierbar

    code = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_Q, box_size=8, border=2)
    code.add_data(doc_uid)
    code.make(fit=True)
    puffer = BytesIO()
    code.make_image(fill_color="black", back_color="white").convert("RGB").save(
        puffer, format="PNG"
    )
    return puffer.getvalue()


def marke_png() -> bytes:
    """Eine Passermarke: ein schwarzes Quadrat, sonst nichts."""
    from PIL import Image

    puffer = BytesIO()
    Image.new("RGB", (40, 40), (0, 0, 0)).save(puffer, format="PNG")
    return puffer.getvalue()


def _einsetzen(blatt, daten: bytes, anker: str, px: int) -> None:
    from openpyxl.drawing.image import Image as ExcelBild

    bild = ExcelBild(BytesIO(daten))
    bild.width = bild.height = px  # nur die Anzeigegröße; die Quelle bleibt scharf
    blatt.add_image(bild, anker)


def qr_einsetzen(blatt, doc_uid: str, anker: str) -> None:
    _einsetzen(blatt, qr_png(doc_uid), anker, QR_PX)


def marke_einsetzen(blatt, anker: str) -> None:
    _einsetzen(blatt, marke_png(), anker, MARKE_PX)


def layout(
    blatt,
    geo: Geometrie,
    *,
    doc_uid: str,
    felder: list[tuple[str, str, int, int, int]],
    qr_spalte: int,
    qr_zeile: int,
    marken: list[tuple[int, int]],
) -> dict:
    """Das fertige `feld_layout` für die Vorgangszeile.

    `felder` ist eine Liste aus (Schlüssel, Beschriftung, Zeile, von, bis) —
    gesammelt beim Bauen des Blattes, denn erst dann stehen die Zeilenhöhen
    fest. Vorher gerechnet wären die Rechtecke falsch.
    """
    return {
        "seite": {"w_pt": A4_BREITE_PT, "h_pt": A4_HOEHE_PT},
        "felder": [
            {"key": schluessel, "label": beschriftung, "box": zellen_box(blatt, geo, zeile, von, bis)}
            for schluessel, beschriftung, zeile, von, bis in felder
        ],
        "qr": {"doc_uid": doc_uid, "box": bild_box(blatt, geo, qr_spalte, qr_zeile, QR_PX)},
        "marken": [bild_box(blatt, geo, s, z, MARKE_PX) for s, z in marken],
    }
