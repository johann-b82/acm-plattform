"""Eine Sperre gegen zu viele Abrufe je Adresse.

Gebraucht wird sie genau dort, wo eine Route ohne Anmeldung antwortet: die
Bildschirmanzeigen. Innerhalb der Anwendung reicht die Rechteprüfung.

Das Fenster liegt im Speicher dieses Prozesses. Das ist richtig, solange
compute mit einem Arbeiter läuft (siehe `Dockerfile`: `uvicorn` ohne
`--workers`). Kommen mehrere dazu, hat jeder seine eigenen Eimer und die
Grenze vervielfacht sich — dann gehört der Zähler in die Datenbank.

Welche Adresse zählt: Caddy hängt die Gegenstelle **hinten** an
`X-Forwarded-For` an. Ein Aufrufer kann vorne eigene Einträge erfinden, aber
Caddys Eintrag nicht entfernen — also gilt nur der letzte, und nur dann, wenn
die direkte Gegenstelle selbst aus einem vertrauten Netz kommt. Ohne diesen
Riegel wäre der Kopf beliebig fälschbar; ohne den Kopf teilten sich alle
Tafeln hinter Caddy einen einzigen Eimer.
"""
from __future__ import annotations

import asyncio
import ipaddress
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, status

# Die Netze, in denen Compose und ein Reverse-Proxy üblicherweise liegen.
VERTRAUTE_NETZE = tuple(
    ipaddress.ip_network(n)
    for n in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8", "::1/128")
)


def _vertraut(host: str) -> bool:
    try:
        adresse = ipaddress.ip_address(host)
    except ValueError:
        return False
    return any(adresse in netz for netz in VERTRAUTE_NETZE)


def absender(anfrage: Request) -> str:
    gegenstelle = anfrage.client.host if anfrage.client else ""
    if gegenstelle and _vertraut(gegenstelle):
        kette = anfrage.headers.get("x-forwarded-for", "")
        letzter = kette.split(",")[-1].strip() if kette else ""
        if letzter:
            return letzter
    return gegenstelle or "unbekannt"


class Sperre:
    """Ein benanntes gleitendes Fenster, verwendbar als FastAPI-Abhängigkeit."""

    def __init__(self, name: str, *, grenze: int, fenster_s: float = 60.0) -> None:
        self.name = name
        self.grenze = grenze
        self.fenster_s = fenster_s
        self._eimer: dict[str, deque[float]] = defaultdict(
            lambda: deque(maxlen=grenze + 1)
        )
        self._schloss = asyncio.Lock()

    async def __call__(self, anfrage: Request) -> None:
        jetzt = time.monotonic()
        wer = absender(anfrage)
        async with self._schloss:
            fenster = self._eimer[wer]
            while fenster and (jetzt - fenster[0]) > self.fenster_s:
                fenster.popleft()
            if len(fenster) >= self.grenze:
                raise HTTPException(
                    status.HTTP_429_TOO_MANY_REQUESTS,
                    f"Zu viele Abrufe ({self.name}) von dieser Adresse.",
                    headers={"Retry-After": str(int(self.fenster_s))},
                )
            fenster.append(jetzt)

    def leeren(self) -> None:
        """Nur für Tests."""
        self._eimer.clear()
