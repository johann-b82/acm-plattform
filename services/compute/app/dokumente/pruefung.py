"""Den zurückgegebenen Scan prüfen: steht in jedem Pflichtfeld etwas?

Der Ablauf:

  1. Scan rastern — ein PDF über `pdftoppm`, ein Bild direkt.
  2. Den QR lesen: die Vorgangskennung **und** seine vier Ecken.
  3. Aus QR-Ecken und den beiden Passermarken eine Abbildung
     Blatt → Scan schätzen. Sie fängt Verschiebung, Skalierung, Drehung und
     leichte Verzerrung auf.
  4. Jedes Feldrechteck aus `feld_layout` in den Scan abbilden und dort die
     Tinte zählen.

**Erkannt wird, *ob* etwas im Feld steht — nicht *was*.** Keine
Zeichenerkennung. Eine Unterschrift ist für dieses Verfahren dasselbe wie ein
Datum: dunkle Pixel, wo vorher keine waren. Deshalb ist das Gesamturteil
ausdrücklich von Hand überstimmbar; die Maske bietet es an.

**Gegen das Blanko gerechnet.** Rahmen und Unterstriche des Formulars sind
selbst Tinte. Zieht man sie nicht ab, gilt jedes Feld mit einer Linie darunter
als ausgefüllt. Deshalb wird dasselbe Blatt leer mitgerendert und feldweise
abgezogen; übrig bleibt die Handschrift.

Aus lumeapps übernommen (`einarbeitung_pruefung.py`) — die Schwellen sind dort
an echten Scans kalibriert, und daran zu drehen wäre leichtsinnig.
"""
from __future__ import annotations

import asyncio
import shutil
import uuid as _uuid
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path

import numpy as np
from PIL import Image

#: Grauwert, unterhalb dessen ein Pixel als Tinte gilt (0 = schwarz).
TINTE_SCHWELLE = 140
#: Ränder, die je Feld verworfen werden. Unten mehr, weil dort die
#: Unterschriftslinie sitzt: eine hauchdünne, kontrastreiche Linie zählte sonst
#: bei geringstem Restversatz als Tinte.
EINZUG_X, EINZUG_OBEN, EINZUG_UNTEN = 0.12, 0.14, 0.30
#: Ausgefüllt, wenn die Netto-Tinte beide Schwellen übertrifft. Maßgeblich ist
#: der Flächenanteil (auflösungsunabhängig); die Pixelzahl ist nur ein
#: Rauschboden. Kalibriert: Blanko-Rest ≤ ~1,3 %, echte Einträge ≥ ~9 %.
MIN_ANTEIL = 0.02
MIN_PIXEL = 200
#: Auflösung der Rasterung — genug für QR und Tintenmessung.
SCAN_DPI = 300

#: LibreOffice und pdftoppm nacheinander, nicht nebeneinander: zwei gleichzeitige
#: Läufe treiben den Speicher des Containers hoch.
_EINER_NACH_DEM_ANDEREN = asyncio.Semaphore(1)


class ScanFehlgeschlagen(RuntimeError):
    """Der Scan ließ sich nicht rastern."""


@dataclass
class QRTreffer:
    doc_uid: str
    #: 4×2, sortiert oben-links, oben-rechts, unten-rechts, unten-links.
    ecken: np.ndarray


async def rastern(daten: bytes, ist_pdf: bool) -> Image.Image:
    """Den hochgeladenen Scan als RGB-Bild öffnen; ein PDF wird gerastert."""
    if not ist_pdf:
        return Image.open(BytesIO(daten)).convert("RGB")

    async with _EINER_NACH_DEM_ANDEREN:
        ordner = Path(f"/tmp/scan_{_uuid.uuid4()}")
        try:
            ordner.mkdir(parents=True, exist_ok=True)
            quelle = ordner / "scan.pdf"
            quelle.write_bytes(daten)
            lauf = await asyncio.create_subprocess_exec(
                "pdftoppm", "-png", "-r", str(SCAN_DPI), "-singlefile",
                str(quelle), str(ordner / "seite"),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            _, fehler = await lauf.communicate()
            ziel = ordner / "seite.png"
            if lauf.returncode != 0 or not ziel.exists():
                raise ScanFehlgeschlagen(
                    f"pdftoppm: {fehler.decode('utf-8', 'replace')[-300:]}"
                )
            return Image.open(ziel).convert("RGB")
        finally:
            shutil.rmtree(ordner, ignore_errors=True)


# --- QR und Geometrie -------------------------------------------------------


def _sortiere(punkte: np.ndarray) -> np.ndarray:
    """Vier Punkte in die Reihenfolge oben-links, oben-rechts, unten-rechts, unten-links."""
    punkte = np.asarray(punkte, dtype=float)
    summe = punkte.sum(axis=1)
    diagonale = punkte[:, 1] - punkte[:, 0]
    return np.array([
        punkte[np.argmin(summe)],
        punkte[np.argmin(diagonale)],
        punkte[np.argmax(summe)],
        punkte[np.argmax(diagonale)],
    ])


def qr_lesen(bild: Image.Image) -> QRTreffer | None:
    """Den ersten QR lesen — Inhalt und sortierte Ecken."""
    from pyzbar.pyzbar import ZBarSymbol, decode

    for code in decode(bild.convert("L"), symbols=[ZBarSymbol.QRCODE]):
        inhalt = code.data.decode("utf-8", "replace").strip()
        if not inhalt:
            continue
        if len(code.polygon) >= 4:
            punkte = np.array([(p.x, p.y) for p in code.polygon], dtype=float)
        else:
            r = code.rect
            punkte = np.array([
                (r.left, r.top),
                (r.left + r.width, r.top),
                (r.left + r.width, r.top + r.height),
                (r.left, r.top + r.height),
            ], dtype=float)
        if len(punkte) > 4:
            summe = punkte.sum(axis=1)
            diagonale = punkte[:, 1] - punkte[:, 0]
            auswahl = {np.argmin(summe), np.argmax(summe),
                       np.argmin(diagonale), np.argmax(diagonale)}
            punkte = punkte[sorted(auswahl)]
        return QRTreffer(doc_uid=inhalt, ecken=_sortiere(punkte))
    return None


def _aehnlichkeit(quelle: np.ndarray, ziel: np.ndarray) -> np.ndarray:
    """Beste Ähnlichkeit (Skalierung, Drehung, Verschiebung) — Umeyama.

    Nur vier Freiheitsgrade. Aus dem kleinen QR allein ist das gut
    konditioniert; eine volle Affine wäre es nicht.
    """
    quelle = np.asarray(quelle, dtype=float)
    ziel = np.asarray(ziel, dtype=float)
    mq, mz = quelle.mean(0), ziel.mean(0)
    xq, xz = quelle - mq, ziel - mz
    sigma = (xz.T @ xq) / len(quelle)
    u, d, vt = np.linalg.svd(sigma)
    s = np.eye(2)
    if np.linalg.det(u) * np.linalg.det(vt) < 0:
        s[-1, -1] = -1
    drehung = u @ s @ vt
    varianz = (xq ** 2).sum() / len(quelle)
    skala = float((d * np.diag(s)).sum() / varianz)
    verschiebung = mz - skala * (drehung @ mq)
    return np.hstack([skala * drehung, verschiebung.reshape(2, 1)])


def _affine(quelle: np.ndarray, ziel: np.ndarray) -> np.ndarray:
    """Beste Affine (sechs Freiheitsgrade) als 2×3-Matrix."""
    quelle = np.asarray(quelle, dtype=float)
    ziel = np.asarray(ziel, dtype=float)
    a = np.c_[quelle, np.ones(len(quelle))]
    loesung, *_ = np.linalg.lstsq(a, ziel, rcond=None)
    return loesung.T


def _abbilden(matrix: np.ndarray, punkte: np.ndarray) -> np.ndarray:
    punkte = np.asarray(punkte, dtype=float)
    return punkte @ matrix[:, :2].T + matrix[:, 2]


def _box_ecken(box: list[float], breite_pt: float, hoehe_pt: float) -> np.ndarray:
    """Normiertes Rechteck → vier Ecken im Punktraum.

    Der Umweg über Punkte macht die Geometrie gleichmäßig: dort ist der QR
    quadratisch. In normierten Koordinaten wäre er es nicht, und eine
    Ähnlichkeitstransformation ließe sich gar nicht anpassen.
    """
    x0, y0 = box[0] * breite_pt, box[1] * hoehe_pt
    x1, y1 = box[2] * breite_pt, box[3] * hoehe_pt
    return np.array([[x0, y0], [x1, y0], [x1, y1], [x0, y1]])


def _finde_marke(grau: np.ndarray, cx: float, cy: float, radius: float, k: int):
    """Das dunkelste k×k-Quadrat um (cx, cy) — so liegt die Passermarke."""
    hoehe, breite = grau.shape
    x0, x1 = max(0, int(cx - radius)), min(breite, int(cx + radius))
    y0, y1 = max(0, int(cy - radius)), min(hoehe, int(cy + radius))
    if x1 - x0 <= k or y1 - y0 <= k:
        return None
    fenster = (grau[y0:y1, x0:x1] < 128).astype(np.int32)
    summiert = np.zeros((fenster.shape[0] + 1, fenster.shape[1] + 1), dtype=np.int32)
    summiert[1:, 1:] = fenster.cumsum(0).cumsum(1)
    summe = (summiert[k:, k:] - summiert[:-k, k:]
             - summiert[k:, :-k] + summiert[:-k, :-k])
    if summe.size == 0 or summe.max() < 0.5 * k * k:
        return None  # nichts hinreichend Dunkles — die Marke ist nicht da
    by, bx = np.unravel_index(int(np.argmax(summe)), summe.shape)
    return (x0 + bx + k / 2, y0 + by + k / 2)


#: Breite des linken Randstreifens, in dem die Passermarken stehen. Die Tabelle
#: beginnt weiter rechts; so gerät ihr Rahmen nicht in die Suche.
MARKEN_STREIFEN = 0.085


def marken_im_streifen(grau: np.ndarray) -> list[tuple[float, float]]:
    """Die Passermarken im linken Rand finden — ohne Vorhersage.

    Der Umweg über eine Vorhersage aus dem QR ist unzuverlässig: die grobe
    Ausrichtung allein aus dem kleinen QR kann am Blattfuß um mehrere Zentimeter
    danebenliegen, und dann sucht sie an der falschen Stelle. Nachgemessen: die
    untere Marke wurde so nie gefunden, die Ausrichtung fiel auf die
    QR-Ähnlichkeit zurück, und die Prüfrechtecke landeten eine Zeile zu hoch.

    Im Randstreifen stehen die Marken dagegen allein — es sind die einzigen
    vollflächig schwarzen Quadrate dort. Zwei zusammenhängende dunkle Blöcke,
    einer oben, einer unten.
    """
    hoehe, breite = grau.shape
    streifen = grau[:, : max(1, int(MARKEN_STREIFEN * breite))] < 128
    je_zeile = streifen.sum(axis=1)
    # Ein Block ist eine Folge von Zeilen mit genug dunklen Punkten.
    schwelle = max(3, int(0.02 * streifen.shape[1]))
    bloecke: list[tuple[int, int]] = []
    start = None
    for i, anzahl in enumerate(je_zeile):
        if anzahl > schwelle and start is None:
            start = i
        elif anzahl <= schwelle and start is not None:
            bloecke.append((start, i - 1))
            start = None
    if start is not None:
        bloecke.append((start, len(je_zeile) - 1))

    gefunden = []
    for oben, unten in bloecke:
        # Eine Marke ist ungefähr so hoch wie breit; ein Tabellenrahmen wäre
        # ein dünner Strich.
        spalten = np.where(streifen[oben:unten + 1].any(axis=0))[0]
        if spalten.size == 0:
            continue
        h = unten - oben + 1
        b = spalten.max() - spalten.min() + 1
        if h < 6 or b < 6 or not (0.4 <= h / b <= 2.5):
            continue
        gefunden.append(((spalten.min() + spalten.max()) / 2, (oben + unten) / 2))
    return gefunden


def _ausrichten(bild: Image.Image, layout: dict):
    """Abbildung Blatt → Scan: grob aus dem QR, verfeinert mit den Marken."""
    treffer = qr_lesen(bild)
    if treffer is None:
        return None
    seite = layout["seite"]
    breite_pt, hoehe_pt = seite["w_pt"], seite["h_pt"]
    qr_quelle = _box_ecken(layout["qr"]["box"], breite_pt, hoehe_pt)
    grob = _aehnlichkeit(qr_quelle, treffer.ecken)
    grau = np.asarray(bild.convert("L"))
    skala = float(np.hypot(grob[0, 0], grob[1, 0]))  # Scanpixel je Punkt

    quelle = [list(qr_quelle.mean(0))]
    ziel = [list(treffer.ecken.mean(0))]

    modell = [
        ((m[0] + m[2]) / 2 * breite_pt, (m[1] + m[3]) / 2 * hoehe_pt)
        for m in layout.get("marken", [])
    ]
    # Zuerst der direkte Weg: die Marken stehen im linken Rand allein.
    im_streifen = marken_im_streifen(grau)
    if len(im_streifen) == len(modell) and modell:
        # Beide Listen von oben nach unten — die Zuordnung ist dann eindeutig.
        for (mx, my), (sx, sy) in zip(
            sorted(modell, key=lambda p: p[1]), sorted(im_streifen, key=lambda p: p[1])
        ):
            quelle.append([mx, my])
            ziel.append([sx, sy])
    else:
        # Ein schiefer oder beschnittener Scan: dann doch über die Vorhersage.
        for (mx, my), marke in zip(modell, layout.get("marken", [])):
            k = max(4, int(round((marke[2] - marke[0]) * breite_pt * skala)))
            geschaetzt = _abbilden(grob, np.array([[mx, my]]))[0]
            gefunden = _finde_marke(
                grau, geschaetzt[0], geschaetzt[1],
                radius=max(8 * k, int(0.16 * grau.shape[0])), k=k,
            )
            if gefunden is not None:
                quelle.append([mx, my])
                ziel.append(list(gefunden))

    # Drei gut verteilte Punkte tragen eine stabile Affine; darunter bleibt es
    # bei der Ähnlichkeit aus dem QR.
    matrix = _affine(np.array(quelle), np.array(ziel)) if len(quelle) >= 3 else grob
    return matrix, treffer.doc_uid


def _tinte(grau: np.ndarray, box: tuple[float, float, float, float]) -> tuple[int, int]:
    """Dunkle Pixel und Fläche im eingerückten Inneren eines Rechtecks."""
    x0, y0, x1, y1 = box
    breite, hoehe = x1 - x0, y1 - y0
    ix0 = int(round(x0 + EINZUG_X * breite))
    iy0 = int(round(y0 + EINZUG_OBEN * hoehe))
    ix1 = int(round(x1 - EINZUG_X * breite))
    iy1 = int(round(y1 - EINZUG_UNTEN * hoehe))
    h, w = grau.shape
    ix0, iy0 = max(0, ix0), max(0, iy0)
    ix1, iy1 = min(w, ix1), min(h, iy1)
    if ix1 <= ix0 or iy1 <= iy0:
        return 0, 0
    ausschnitt = grau[iy0:iy1, ix0:ix1]
    return int((ausschnitt < TINTE_SCHWELLE).sum()), int(ausschnitt.size)


def _feld_box(matrix, box: list[float], breite_pt: float, hoehe_pt: float):
    punkte = _abbilden(matrix, _box_ecken(box, breite_pt, hoehe_pt))
    return (punkte[:, 0].min(), punkte[:, 1].min(), punkte[:, 0].max(), punkte[:, 1].max())


def felder_pruefen(bild: Image.Image, layout: dict, blanko: Image.Image | None = None) -> dict:
    """Die Pflichtfelder im Scan nachsehen.

    `blanko` ist dasselbe Blatt leer gerendert; seine Tinte wird feldweise
    abgezogen. Ohne das gälte jedes Feld mit einer Linie darunter als
    ausgefüllt.
    """
    ausrichtung = _ausrichten(bild, layout)
    if ausrichtung is None:
        return {"qr_ok": False, "doc_uid": None, "felder": [],
                "vollstaendig": False, "fehlend": []}
    matrix, doc_uid = ausrichtung
    grau = np.asarray(bild.convert("L"))
    seite = layout["seite"]
    breite_pt, hoehe_pt = seite["w_pt"], seite["h_pt"]

    blanko_grau = blanko_matrix = None
    if blanko is not None:
        blanko_ausrichtung = _ausrichten(blanko, layout)
        if blanko_ausrichtung is not None:
            blanko_matrix = blanko_ausrichtung[0]
            blanko_grau = np.asarray(blanko.convert("L"))

    felder = []
    for feld in layout.get("felder", []):
        dunkel, flaeche = _tinte(grau, _feld_box(matrix, feld["box"], breite_pt, hoehe_pt))
        grundrauschen = 0
        if blanko_grau is not None:
            grundrauschen, _ = _tinte(
                blanko_grau, _feld_box(blanko_matrix, feld["box"], breite_pt, hoehe_pt)
            )
        netto = max(0, dunkel - grundrauschen)
        anteil = netto / flaeche if flaeche else 0.0
        felder.append({
            "key": feld["key"],
            "label": feld["label"],
            "erkannt": netto >= MIN_PIXEL and anteil >= MIN_ANTEIL,
            "netto_px": netto,
            "anteil": round(anteil, 4),
        })

    fehlend = [f["label"] for f in felder if not f["erkannt"]]
    return {
        "qr_ok": True,
        "doc_uid": doc_uid,
        "felder": felder,
        "vollstaendig": bool(felder) and not fehlend,
        "fehlend": fehlend,
    }


def gilt_als_erledigt(feld: dict) -> bool:
    """Ein Feld zählt als erledigt, wenn die Automatik Tinte erkannt hat **oder**
    es von Hand bestätigt bzw. als nicht erforderlich markiert wurde."""
    return bool(feld.get("erkannt") or feld.get("bestaetigt") or feld.get("nicht_erforderlich"))


def neu_bewerten(ergebnis: dict) -> dict:
    """`fehlend` und `vollstaendig` aus den — womöglich von Hand übersteuerten —
    Feldern neu rechnen. Für die Pro-Feld-Bestätigung und das „nicht
    erforderlich" mit Kommentar."""
    felder = list(ergebnis.get("felder", []))
    fehlend = [f["label"] for f in felder if not gilt_als_erledigt(f)]
    return {**ergebnis, "fehlend": fehlend, "vollstaendig": bool(felder) and not fehlend}
