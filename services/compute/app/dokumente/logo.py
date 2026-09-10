"""Das Firmenlogo für die erzeugten Formblätter.

Eine Stelle, an der es gepflegt wird — dieselbe Datei steht auf jedem
Formblatt. Hochgeladen wird sie aus dem Browser in den Eimer `plattform`;
hier wird sie mit dem Dienstschlüssel gelesen, weil ein Formblatt ohne
angemeldete Person entsteht (etwa aus einem geplanten Lauf).

Nur Raster: openpyxl kann kein SVG einbetten. Fehlt das Logo, entsteht das
Blatt trotzdem — ohne Bild, aber vollständig.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from io import BytesIO

import httpx
import sqlalchemy as sa

from app.config import settings
from app.db import SessionLocal, plattform_logo

log = logging.getLogger(__name__)

EIMER = "plattform"

#: Zielbreite auf dem Blatt in Pixeln; die Höhe folgt dem Seitenverhältnis.
#: Etwa 45 mm bei 96 dpi.
BREITE_PX = 170


@dataclass
class Logo:
    daten: bytes
    breite: int
    hoehe: int


async def lade_logo() -> Logo | None:
    """Das Logo als einbettbares Bild — oder nichts."""
    async with SessionLocal() as sitzung:
        zeile = (
            await sitzung.execute(
                sa.select(plattform_logo.c.pfad, plattform_logo.c.mime)
            )
        ).mappings().one_or_none()

    if not zeile or not zeile["pfad"]:
        return None

    kopf = {
        "apikey": settings.SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {settings.SERVICE_ROLE_KEY}",
    }
    try:
        async with httpx.AsyncClient(timeout=20) as klient:
            antwort = await klient.get(
                f"{settings.STORAGE_URL}/object/{EIMER}/{zeile['pfad']}", headers=kopf
            )
        if antwort.status_code != 200:
            log.warning("Logo nicht lesbar: HTTP %s", antwort.status_code)
            return None
        daten = antwort.content
    except httpx.HTTPError as fehler:
        log.warning("Logo nicht lesbar: %s", fehler)
        return None

    try:
        from PIL import Image

        with Image.open(BytesIO(daten)) as bild:
            breite, hoehe = bild.size
    except Exception:  # noqa: BLE001 — ein unlesbares Bild ist kein Grund zu scheitern
        log.warning("Logo ließ sich nicht messen — wird ausgelassen.")
        return None

    if breite <= 0 or hoehe <= 0:
        return None
    return Logo(daten=daten, breite=BREITE_PX, hoehe=round(hoehe * BREITE_PX / breite))
