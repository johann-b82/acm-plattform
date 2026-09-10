"""Erzeugte ATR-Dateien im Eimer `atr` ablegen und wieder holen.

compute spricht die Storage-API mit dem Service-Schlüssel an, nicht über die
Regeln auf `storage.objects`. Grund: die Regeln verlangen, dass der erste
Pfadabschnitt die Kennung der hochladenden Person ist — das passt für einen
Upload aus dem Browser, aber nicht für eine Datei, die der Dienst erzeugt.
Erzeugte Dateien liegen deshalb unter `erzeugt/<lieferung>/…`.

Gelesen werden sie über eine signierte URL, die die Oberfläche anfordert; die
Leseregel auf dem Eimer (`app_level('atr')`) gilt dabei unverändert.
"""
from __future__ import annotations

import httpx

from app.config import settings

EIMER = "atr"


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

    `x-upsert` ist Absicht: wird eine Lieferung neu erzeugt, soll die alte
    Fassung ersetzt werden und nicht als Waise liegen bleiben.
    """
    ziel = f"{settings.STORAGE_URL}/object/{EIMER}/{pfad}"
    async with httpx.AsyncClient(timeout=60) as klient:
        antwort = await klient.post(
            ziel,
            content=daten,
            headers={**_kopfzeilen(typ), "x-upsert": "true"},
        )
    if antwort.status_code >= 400:
        raise SpeicherFehler(
            f"Ablegen fehlgeschlagen ({antwort.status_code}): {antwort.text[:200]}"
        )
    return pfad


async def entfernen(pfade: list[str]) -> None:
    """Räumt Dateien weg. Fehler sind hier nicht schlimm genug, um einen
    Vorgang scheitern zu lassen — sie stehen im Log."""
    if not pfade:
        return
    async with httpx.AsyncClient(timeout=30) as klient:
        await klient.request(
            "DELETE",
            f"{settings.STORAGE_URL}/object/{EIMER}",
            json={"prefixes": pfade},
            headers=_kopfzeilen("application/json"),
        )
