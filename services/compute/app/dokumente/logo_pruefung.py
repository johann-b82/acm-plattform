"""Das Firmenlogo prüfen, bevor es gespeichert wird (SET-07).

**Typ nach Inhalt.** Endung und `Content-Type` sagt der Browser, und beides
lässt sich frei setzen. Entschieden wird an den ersten Bytes: PNG- und
JPEG-Signatur, und das Bild muss sich öffnen lassen; ein SVG muss als XML mit
einer `svg`-Wurzel im SVG-Namensraum lesbar sein.

**5 MB einschließlich.** Genau 5 242 880 Bytes gehen, eines mehr nicht.

**SVG gereinigt, nicht abgelehnt.** Eine SVG-Datei kann Skripte, Handler und
Verweise ins Netz tragen. Liegt sie im Eimer und öffnet jemand ihre Adresse
direkt, liefe ein Skript im Ursprung der Plattform. Das Altprojekt lehnte mit
`nh3` jede Datei ab, die sich beim Reinigen änderte — `nh3` ist aber ein
HTML-Reiniger und serialisiert als HTML, nicht als XML. Hier wird das SVG mit
`defusedxml` gelesen (keine DTD, keine Entitäten), gegen eine Positivliste von
Elementen und Attributen gefiltert und wieder als XML geschrieben:

* nur Zeichenelemente — kein `script`, `style`, `foreignObject`, `image`;
* kein Attribut, das mit `on` beginnt;
* Verweise (`href`, `xlink:href`) nur innerhalb der Datei (`#…`);
* kein Attributwert mit `url(`, außer `url(#…)`, und keiner mit `javascript:`.

**Raster für die Formblätter.** openpyxl bettet nur Rasterbilder ein. Aus dem
gereinigten SVG entsteht deshalb mit CairoSVG ein PNG, das neben der Datei
liegt.
"""
from __future__ import annotations

import re
from io import BytesIO
from xml.etree import ElementTree as ET

from defusedxml import ElementTree as SicheresET
from defusedxml.common import DefusedXmlException

MAX_BYTES = 5 * 1024 * 1024

SVG_NS = "http://www.w3.org/2000/svg"
XLINK_NS = "http://www.w3.org/1999/xlink"

PNG_SIGNATUR = b"\x89PNG\r\n\x1a\n"
JPEG_SIGNATUR = b"\xff\xd8\xff"

ELEMENTE = {
    "svg", "g", "defs", "symbol", "use", "title", "desc",
    "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
    "text", "tspan", "linearGradient", "radialGradient", "stop", "clipPath", "mask", "a",
}

#: Attribute ohne Namensraum, die ein Logo braucht. `id` für interne Verweise.
ATTRIBUTE = {
    "id", "class", "viewBox", "width", "height", "x", "y", "x1", "y1", "x2", "y2",
    "cx", "cy", "r", "rx", "ry", "fx", "fy", "dx", "dy", "d", "points", "transform",
    "fill", "fill-opacity", "fill-rule", "clip-rule", "stroke", "stroke-width",
    "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray",
    "stroke-opacity", "opacity", "clip-path", "mask", "preserveAspectRatio", "version",
    "offset", "stop-color", "stop-opacity", "gradientUnits", "gradientTransform",
    "clipPathUnits", "maskUnits", "font-family", "font-size", "font-weight",
    "text-anchor", "href", "style",
}

_URL = re.compile(r"url\(\s*(?!['\"]?#)", re.IGNORECASE)


class LogoAbgelehnt(ValueError):
    """Die Datei taugt nicht als Logo. Die Meldung geht an die Maske."""


def _svg_wurzel(daten: bytes) -> ET.Element:
    try:
        wurzel = SicheresET.fromstring(daten, forbid_dtd=True)
    except (DefusedXmlException, ET.ParseError) as fehler:
        raise LogoAbgelehnt("Die SVG-Datei ist kein lesbares, eigenständiges SVG.") from fehler
    if wurzel.tag != f"{{{SVG_NS}}}svg":
        raise LogoAbgelehnt("Die Datei ist kein SVG.")
    return wurzel


def pruefen(daten: bytes) -> str:
    """Den Bildtyp aus dem Inhalt bestimmen — oder ablehnen."""
    if not daten:
        raise LogoAbgelehnt("Die Datei ist leer.")
    if len(daten) > MAX_BYTES:
        raise LogoAbgelehnt("Das Logo ist größer als 5 MB.")

    if daten.startswith(PNG_SIGNATUR) or daten.startswith(JPEG_SIGNATUR):
        from PIL import Image, UnidentifiedImageError

        try:
            with Image.open(BytesIO(daten)) as bild:
                format_ = bild.format
                bild.verify()
        except (UnidentifiedImageError, OSError, SyntaxError) as fehler:
            raise LogoAbgelehnt("Die Bilddatei ist beschädigt.") from fehler
        if format_ == "PNG":
            return "image/png"
        if format_ == "JPEG":
            return "image/jpeg"
        raise LogoAbgelehnt("Das Logo muss PNG, JPEG oder SVG sein.")

    anfang = daten.lstrip(b"\xef\xbb\xbf \t\r\n")[:1]
    if anfang == b"<":
        _svg_wurzel(daten)
        return "image/svg+xml"
    raise LogoAbgelehnt("Das Logo muss PNG, JPEG oder SVG sein.")


def _lokal(name: str) -> tuple[str | None, str]:
    if name.startswith("{"):
        ns, _, lokal = name[1:].partition("}")
        return ns, lokal
    return None, name


def _reinigen(element: ET.Element) -> None:
    for kind in list(element):
        ns, lokal = _lokal(kind.tag) if isinstance(kind.tag, str) else (None, "")
        if ns != SVG_NS or lokal not in ELEMENTE:
            element.remove(kind)
            continue
        _reinigen(kind)

    for name in list(element.attrib):
        ns, lokal = _lokal(name)
        wert = element.attrib[name]
        erlaubt = (ns is None and lokal in ATTRIBUTE) or (ns == XLINK_NS and lokal == "href")
        if lokal == "href" and not wert.strip().startswith("#"):
            erlaubt = False
        if _URL.search(wert) or "javascript:" in wert.lower().replace(" ", "") or "@import" in wert:
            erlaubt = False
        if not erlaubt:
            del element.attrib[name]


def svg_reinigen(daten: bytes) -> bytes:
    """Das SVG ohne Skripte, Handler und Verweise nach draußen."""
    wurzel = _svg_wurzel(daten)
    _reinigen(wurzel)
    ET.register_namespace("", SVG_NS)
    ET.register_namespace("xlink", XLINK_NS)
    return ET.tostring(wurzel, encoding="utf-8", xml_declaration=True)


def rastern(svg: bytes, breite: int = 800) -> bytes:
    """Ein gereinigtes SVG als PNG in der Zielbreite; die Höhe folgt dem
    Seitenverhältnis. CairoSVG lädt ohne `unsafe` keine Entitäten und keine
    übergroßen Dateien; externe Verweise hat die Reinigung schon entfernt."""
    import cairosvg

    try:
        return cairosvg.svg2png(bytestring=svg, output_width=breite)
    except Exception as fehler:  # noqa: BLE001 — jede Ausnahme heißt: nicht darstellbar
        raise LogoAbgelehnt("Das SVG lässt sich nicht als Bild darstellen.") from fehler
