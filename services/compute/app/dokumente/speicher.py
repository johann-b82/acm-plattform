"""Die Blätter des Dokumentenlaufs im Eimer `dokumente`.

Dieselbe Begründung wie bei ATR: compute spricht die Storage-API mit dem
Service-Schlüssel an, nicht über die Regeln auf `storage.objects`. Die
verlangen, dass der erste Pfadabschnitt die Kennung der hochladenden Person
ist — richtig für einen Upload aus dem Browser, aber nicht für ein Blatt, das
der Dienst erzeugt.

Erzeugte Blätter liegen deshalb unter `vorgang/<doc_uid>/…`. Gelesen werden sie
über eine signierte URL, die die Oberfläche anfordert; die Leseregel auf dem
Eimer (`app_level('hr')`) gilt dabei unverändert.
"""
from __future__ import annotations

import httpx

from app.config import settings

EIMER = "dokumente"


class SpeicherFehler(RuntimeError):
    """Die Storage-API hat abgelehnt."""


def _kopfzeilen(typ: str | None = None) -> dict[str, str]:
    kopf = {
        "apikey": settings.SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {settings.SERVICE_ROLE_KEY}",
    }
    if typ:
        kopf["Content-Type"] = typ
    return kopf


async def ablegen(pfad: str, daten: bytes, typ: str) -> str:
    """Legt eine Datei ab und überschreibt eine vorhandene.

    `x-upsert` ist Absicht: wird ein Blatt neu erzeugt, soll die alte Fassung
    ersetzt werden und nicht als Waise liegen bleiben.
    """
    async with httpx.AsyncClient(timeout=60) as klient:
        antwort = await klient.post(
            f"{settings.STORAGE_URL}/object/{EIMER}/{pfad}",
            content=daten,
            headers={**_kopfzeilen(typ), "x-upsert": "true"},
        )
    if antwort.status_code >= 400:
        raise SpeicherFehler(
            f"Ablegen fehlgeschlagen ({antwort.status_code}): {antwort.text[:200]}"
        )
    return pfad


async def holen(pfad: str) -> bytes:
    """Eine abgelegte Datei zurücklesen — für die Scan-Prüfung."""
    async with httpx.AsyncClient(timeout=60) as klient:
        antwort = await klient.get(
            f"{settings.STORAGE_URL}/object/{EIMER}/{pfad}", headers=_kopfzeilen()
        )
    if antwort.status_code >= 400:
        raise SpeicherFehler(
            f"Lesen fehlgeschlagen ({antwort.status_code}): {antwort.text[:200]}"
        )
    return antwort.content


async def entfernen(pfade: list[str]) -> None:
    """Räumt Dateien weg. Ein Fehler dabei ist nicht schlimm genug, um einen
    Vorgang scheitern zu lassen — er steht im Protokoll."""
    if not pfade:
        return
    async with httpx.AsyncClient(timeout=30) as klient:
        await klient.request(
            "DELETE",
            f"{settings.STORAGE_URL}/object/{EIMER}",
            json={"prefixes": pfade},
            headers=_kopfzeilen("application/json"),
        )
