"""SNMP v2c über `pysnmp` — abfragen, durchgehen, prüfen.

Zwei Dinge, die im Altprojekt teuer erkauft waren und hier gleich stehen:

* **Die Engine wird geteilt.** `SnmpEngine` je Abfrage neu zu bauen kostet
  Zeit und Dateideskriptoren. Sie hängt hier am Modul, nicht am
  Anwendungszustand — `compute` ist zustandslos gegenüber der Datenbank, ein
  Prozessobjekt ist damit kein Widerspruch.
* **Die Community wird nie geloggt.** In jeder Meldung steht der Rechner, nie
  das Geheimnis.

Nichts hier wirft: eine Abfrage, die scheitert, gibt `None` zurück und sagt in
der Meldung, warum. Der Aufrufer schreibt das in `sensor_versuche`.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

from pysnmp.hlapi.v3arch.asyncio import (
    CommunityData,
    ContextData,
    ObjectIdentity,
    ObjectType,
    SnmpEngine,
    UdpTransportTarget,
    get_cmd,
    walk_cmd,
)

log = logging.getLogger(__name__)

ZEITGRENZE = 3.0   # Sekunden je Versuch
WIEDERHOLUNGEN = 2  # drei Versuche insgesamt — UDP verliert gelegentlich
HÖCHSTENS = 200     # Obergrenze für einen Durchgang


@lru_cache(maxsize=1)
def _engine() -> SnmpEngine:
    return SnmpEngine()


@dataclass(frozen=True)
class Fehler:
    """Warum eine Abfrage nichts geliefert hat — kurz genug für die Zeile."""

    text: str


async def hole(
    rechner: str, port: int, community: str, oid: str
) -> tuple[float | None, Fehler | None]:
    """Einen Wert holen. Gibt `(wert, None)` oder `(None, Fehler)` zurück."""
    try:
        transport = await UdpTransportTarget.create(
            (rechner, port), timeout=ZEITGRENZE, retries=WIEDERHOLUNGEN
        )
        anzeige, status, _, bindungen = await get_cmd(
            _engine(),
            CommunityData(community, mpModel=1),  # mpModel=1 → SNMPv2c
            transport,
            ContextData(),
            ObjectType(ObjectIdentity(oid)),
        )
    except Exception as ausnahme:  # noqa: BLE001 — Transportfehler jeder Art
        log.warning("SNMP-Abfrage an %s gescheitert: %s", rechner, ausnahme)
        return None, Fehler(str(ausnahme)[:200])

    if anzeige:
        return None, Fehler(str(anzeige)[:200])
    if status:
        return None, Fehler(status.prettyPrint()[:200])

    for _, wert in bindungen:
        try:
            return float(wert), None
        except (TypeError, ValueError):
            return None, Fehler(f"{oid} liefert keine Zahl: {wert.prettyPrint()[:80]}")
    return None, Fehler(f"{oid} hat nichts geliefert.")


async def durchgehen(
    rechner: str, port: int, community: str, wurzel: str
) -> list[dict[str, Any]]:
    """Den Teilbaum unter `wurzel` auflisten — zum Suchen der richtigen Kennung."""
    treffer: list[dict[str, Any]] = []
    try:
        lauf = walk_cmd(
            _engine(),
            CommunityData(community, mpModel=1),
            await UdpTransportTarget.create(
                (rechner, port), timeout=ZEITGRENZE, retries=WIEDERHOLUNGEN
            ),
            ContextData(),
            ObjectType(ObjectIdentity(wurzel)),
            lexicographicMode=False,
        )
        async for anzeige, status, _, bindungen in lauf:
            if anzeige or status:
                break
            for name, wert in bindungen:
                treffer.append(
                    {
                        "oid": str(name),
                        "wert": wert.prettyPrint(),
                        "typ": type(wert).__name__,
                    }
                )
                if len(treffer) >= HÖCHSTENS:
                    return treffer
    except Exception as ausnahme:  # noqa: BLE001
        log.warning("SNMP-Durchgang an %s gescheitert: %s", rechner, ausnahme)
    return treffer
