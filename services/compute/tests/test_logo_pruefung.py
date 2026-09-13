"""Die Prüfung des Firmenlogos (SET-07): Typ nach Inhalt, Grenze 5 MB
einschließlich, SVG gereinigt, für die Formblätter ein Raster.
"""
from __future__ import annotations

from io import BytesIO
from xml.etree import ElementTree as ET

import pytest
from PIL import Image

from app.dokumente.logo_pruefung import (
    MAX_BYTES,
    LogoAbgelehnt,
    pruefen,
    rastern,
    svg_reinigen,
)

SVG_NS = "http://www.w3.org/2000/svg"


def bild(format_: str) -> bytes:
    puffer = BytesIO()
    Image.new("RGB", (40, 20), (0, 65, 246)).save(puffer, format=format_)
    return puffer.getvalue()


EINFACH = (
    b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20" width="40" height="20">'
    b'<rect width="40" height="20" fill="#0041F6"/></svg>'
)

BOESE = b"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     viewBox="0 0 40 20" onload="alert(1)">
  <script>alert('x')</script>
  <style>@import url(https://boese.example/a.css); rect { fill: red }</style>
  <defs><path id="form" d="M0 0 L10 10"/></defs>
  <a xlink:href="javascript:alert(2)"><rect width="10" height="10" onclick="alert(3)"/></a>
  <image href="https://boese.example/spion.png" width="10" height="10"/>
  <use href="https://boese.example/extern.svg#x"/>
  <use href="#form"/>
  <foreignObject width="10" height="10"><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject>
  <rect width="5" height="5" style="fill:url(https://boese.example/f)"/>
  <path d="M1 1 L2 2" fill="url(#verlauf)"/>
</svg>"""


class TestTypNachInhalt:
    def test_png_jpeg_svg(self):
        assert pruefen(bild("PNG")) == "image/png"
        assert pruefen(bild("JPEG")) == "image/jpeg"
        assert pruefen(EINFACH) == "image/svg+xml"

    def test_andere_formate_abgelehnt(self):
        with pytest.raises(LogoAbgelehnt):
            pruefen(bild("GIF"))
        with pytest.raises(LogoAbgelehnt):
            pruefen(b"<html><script>alert(1)</script></html>")
        with pytest.raises(LogoAbgelehnt):
            pruefen(b"")

    def test_kaputtes_png_mit_richtiger_signatur_abgelehnt(self):
        with pytest.raises(LogoAbgelehnt):
            pruefen(b"\x89PNG\r\n\x1a\n" + b"kein bild")

    def test_xml_ohne_svg_wurzel_abgelehnt(self):
        with pytest.raises(LogoAbgelehnt):
            pruefen(b'<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"/>')


class TestGroesse:
    def test_genau_5_mb_zulaessig(self):
        png = bild("PNG")
        genau = png + b"\0" * (MAX_BYTES - len(png))
        assert len(genau) == 5 * 1024 * 1024
        assert pruefen(genau) == "image/png"

    def test_ein_byte_mehr_abgelehnt(self):
        png = bild("PNG")
        zu_gross = png + b"\0" * (MAX_BYTES - len(png) + 1)
        with pytest.raises(LogoAbgelehnt, match="5 MB"):
            pruefen(zu_gross)


class TestSvgReinigen:
    def test_entfernt_skripte_handler_und_externe_verweise(self):
        sauber = svg_reinigen(BOESE)
        text = sauber.decode()
        for verboten in ("script", "alert", "onload", "onclick", "javascript:", "boese.example",
                         "foreignObject", "<image", "@import"):
            assert verboten not in text, verboten

    def test_behaelt_zeichnung_und_interne_verweise(self):
        wurzel = ET.fromstring(svg_reinigen(BOESE))
        assert wurzel.tag == f"{{{SVG_NS}}}svg"
        pfade = wurzel.findall(f".//{{{SVG_NS}}}path")
        assert {p.get("d") for p in pfade} == {"M0 0 L10 10", "M1 1 L2 2"}
        assert any(p.get("fill") == "url(#verlauf)" for p in pfade)
        interne = [u for u in wurzel.iter(f"{{{SVG_NS}}}use") if u.get("href") == "#form"]
        assert len(interne) == 1
        assert wurzel.get("viewBox") == "0 0 40 20"

    def test_entitaeten_abgelehnt(self):
        xxe = (b'<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>'
               b'<svg xmlns="http://www.w3.org/2000/svg"><text>&x;</text></svg>')
        with pytest.raises(LogoAbgelehnt):
            svg_reinigen(xxe)

    def test_harmloses_svg_bleibt_darstellbar(self):
        sauber = svg_reinigen(EINFACH)
        assert pruefen(sauber) == "image/svg+xml"


class TestRastern:
    def test_svg_wird_png_in_zielbreite(self):
        png = rastern(svg_reinigen(EINFACH), breite=400)
        assert pruefen(png) == "image/png"
        with Image.open(BytesIO(png)) as b:
            assert b.size == (400, 200)
