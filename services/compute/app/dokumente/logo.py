"""Das Firmenlogo: hochladen und für die erzeugten Formblätter lesen.

Eine Stelle, an der es gepflegt wird — dieselbe Datei steht oben links in der
Anwendung und auf jedem Formblatt. Hochgeladen wird es über `compute`, nicht
mehr aus dem Browser direkt in den Eimer: nur hier lässt sich der Inhalt
prüfen und ein SVG reinigen (`logo_pruefung`). Geschrieben und gelesen wird mit
dem Dienstschlüssel; ein Formblatt entsteht auch ohne angemeldete Person
(etwa aus einem geplanten Lauf).

Der Objektname beginnt mit der Kennung der hochladenden Person, wie überall im
Speicher. Ein SVG bekommt ein PNG daneben (`raster_pfad`), denn openpyxl bettet
nur Raster ein. Fehlt das Logo, entsteht das Blatt trotzdem — ohne Bild, aber
vollständig.
"""
from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from io import BytesIO

import httpx
import sqlalchemy as sa

from app.config import settings
from app.db import SessionLocal, plattform_logo
from app.dokumente import logo_pruefung

log = logging.getLogger(__name__)

EIMER = "plattform"

#: Zielbreite auf dem Blatt in Pixeln; die Höhe folgt dem Seitenverhältnis.
#: Etwa 45 mm bei 96 dpi.
BREITE_PX = 170

#: Breite des Rasters aus einem SVG — gut das Vierfache der Blattbreite, damit
#: es auch im PDF scharf bleibt.
RASTER_PX = 800

ENDUNG = {"image/png": "png", "image/jpeg": "jpg", "image/svg+xml": "svg"}


class SpeicherFehler(RuntimeError):
    """Der Speicher hat die Datei nicht angenommen."""


@dataclass
class Logo:
    daten: bytes
    breite: int
    hoehe: int


def _kopf() -> dict[str, str]:
    return {
        "apikey": settings.SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {settings.SERVICE_ROLE_KEY}",
    }


async def _ablegen(pfad: str, daten: bytes, mime: str) -> None:
    async with httpx.AsyncClient(timeout=30) as klient:
        antwort = await klient.post(
            f"{settings.STORAGE_URL}/object/{EIMER}/{pfad}",
            headers={**_kopf(), "Content-Type": mime, "x-upsert": "false"},
            content=daten,
        )
    if antwort.is_error:
        raise SpeicherFehler(f"Speicher lehnt die Datei ab (HTTP {antwort.status_code}).")


async def _entfernen(pfade: list[str]) -> None:
    """Über die Storage-API, nicht per `delete` auf `storage.objects` — sonst
    bliebe die Datei liegen."""
    if not pfade:
        return
    try:
        async with httpx.AsyncClient(timeout=30) as klient:
            await klient.request(
                "DELETE", f"{settings.STORAGE_URL}/object/{EIMER}",
                headers=_kopf(), json={"prefixes": pfade},
            )
    except httpx.HTTPError as fehler:
        # Das neue Logo gilt schon; eine liegengebliebene alte Datei ist kein
        # Grund, den Upload als gescheitert zu melden.
        log.warning("Altes Logo nicht entfernt: %s", fehler)


async def hochladen(daten: bytes, dateiname: str, benutzer: str) -> dict:
    """Prüfen, ablegen, eintragen, alte Dateien entfernen — in dieser
    Reihenfolge, damit ein Fehler nie beides nimmt."""
    mime = logo_pruefung.pruefen(daten)
    raster: bytes | None = None
    if mime == "image/svg+xml":
        daten = logo_pruefung.svg_reinigen(daten)
        raster = logo_pruefung.rastern(daten, breite=RASTER_PX)

    kennung = uuid.uuid4()
    pfad = f"{benutzer}/{kennung}.{ENDUNG[mime]}"
    raster_pfad = f"{benutzer}/{kennung}.png" if raster is not None else pfad

    await _ablegen(pfad, daten, mime)
    if raster is not None:
        try:
            await _ablegen(raster_pfad, raster, "image/png")
        except SpeicherFehler:
            await _entfernen([pfad])
            raise

    jetzt = datetime.now(timezone.utc)
    async with SessionLocal() as sitzung:
        async with sitzung.begin():
            alt = (await sitzung.execute(
                sa.select(plattform_logo.c.pfad, plattform_logo.c.raster_pfad).with_for_update()
            )).mappings().one()
            await sitzung.execute(sa.update(plattform_logo).values(
                pfad=pfad, raster_pfad=raster_pfad, dateiname=dateiname[:200],
                mime=mime, geaendert_am=jetzt,
            ))

    await _entfernen(sorted({p for p in (alt["pfad"], alt["raster_pfad"]) if p}))
    return {"pfad": pfad, "dateiname": dateiname[:200], "mime": mime, "geaendert_am": jetzt.isoformat()}


async def lade_logo() -> Logo | None:
    """Das Logo als einbettbares Bild — oder nichts. Bei einem SVG das Raster."""
    async with SessionLocal() as sitzung:
        zeile = (
            await sitzung.execute(
                sa.select(plattform_logo.c.pfad, plattform_logo.c.raster_pfad, plattform_logo.c.mime)
            )
        ).mappings().one_or_none()

    if not zeile or not zeile["pfad"]:
        return None
    pfad = zeile["raster_pfad"] or (None if zeile["mime"] == "image/svg+xml" else zeile["pfad"])
    if not pfad:
        return None

    try:
        async with httpx.AsyncClient(timeout=20) as klient:
            antwort = await klient.get(
                f"{settings.STORAGE_URL}/object/{EIMER}/{pfad}", headers=_kopf()
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
