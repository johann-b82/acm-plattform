"""Einen Durchgang messen: fragen, umrechnen, festhalten.

Ein Gerät, das nicht antwortet, darf die anderen nicht aufhalten — deshalb
laufen alle Abfragen nebeneinander, und ein Fehler bleibt bei seinem Gerät.

Jeder Versuch wird festgehalten, auch der gescheiterte. Ohne das sieht ein
stiller Ausfall aus wie ein Gerät, das gerade nichts zu melden hat.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app import netz
from app.config import settings
from app.db import SessionLocal, sensor_messungen, sensor_versuche, sensoren
from app.sensoren import geheim, snmp


@dataclass
class Ergebnis:
    gemessen: int
    gescheitert: int
    hinweise: list[str]


def pruefe_ziel(rechner: str) -> None:
    """Lässt nur durch, was der Betreiber in `SNMP_ERLAUBT` freigegeben hat."""
    netz.pruefe_ziel(
        rechner,
        netz.erlaubte(settings.SNMP_ERLAUBT),
        port=161,
        name="SNMP_ERLAUBT",
    )


def _skaliert(wert: float | None, faktor: Decimal | None) -> Decimal | None:
    """Rohwert mal Faktor. Manche Geräte liefern Zehntelgrad als ganze Zahl."""
    if wert is None:
        return None
    return (Decimal(str(wert)) * (faktor if faktor is not None else Decimal(1))).quantize(
        Decimal("0.001")
    )


async def _einen(zeile) -> tuple[dict | None, str | None]:
    """Ein Gerät abfragen. Gibt `(messung, fehlertext)` zurück."""
    try:
        pruefe_ziel(zeile.rechner)
        community = geheim.entschluesseln(zeile.community)
    except (netz.ZielNichtErlaubt, geheim.KeinSchluessel, geheim.NichtLesbar) as fehler:
        return None, str(fehler)[:200]

    temperatur = feuchte = None
    fehler_texte: list[str] = []

    if zeile.temperatur_oid:
        roh, fehler = await snmp.hole(zeile.rechner, zeile.port, community, zeile.temperatur_oid)
        temperatur = _skaliert(roh, zeile.temperatur_faktor)
        if fehler:
            fehler_texte.append(f"Temperatur: {fehler.text}")
    if zeile.feuchte_oid:
        roh, fehler = await snmp.hole(zeile.rechner, zeile.port, community, zeile.feuchte_oid)
        feuchte = _skaliert(roh, zeile.feuchte_faktor)
        if fehler:
            fehler_texte.append(f"Feuchte: {fehler.text}")

    if temperatur is None and feuchte is None:
        return None, "; ".join(fehler_texte)[:200] or "keine Antwort"

    return (
        {
            "sensor_id": zeile.id,
            "gemessen_am": datetime.now(timezone.utc),
            "temperatur": temperatur,
            "feuchte": feuchte,
        },
        "; ".join(fehler_texte)[:200] or None,
    )


async def durchgang(nur: str | None = None) -> Ergebnis:
    """Alle aktiven Geräte messen — oder genau eines, wenn `nur` gesetzt ist."""
    async with SessionLocal() as sitzung:
        abfrage = sa.select(sensoren).where(sensoren.c.aktiv)
        if nur is not None:
            abfrage = sa.select(sensoren).where(sensoren.c.id == nur)
        zeilen = (await sitzung.execute(abfrage)).all()

    if not zeilen:
        return Ergebnis(gemessen=0, gescheitert=0, hinweise=[])

    # `return_exceptions=True`: ein Gerät, das die Bibliothek zum Absturz
    # bringt, darf die übrigen nicht mitnehmen.
    ausgang = await asyncio.gather(*(_einen(z) for z in zeilen), return_exceptions=True)

    messungen: list[dict] = []
    versuche: list[dict] = []
    hinweise: list[str] = []
    jetzt = datetime.now(timezone.utc)

    for zeile, ergebnis in zip(zeilen, ausgang):
        if isinstance(ergebnis, BaseException):
            versuche.append(
                {"sensor_id": zeile.id, "versucht_am": jetzt, "erfolg": False,
                 "fehler": str(ergebnis)[:200]}
            )
            hinweise.append(f"{zeile.name}: {ergebnis}")
            continue
        messung, fehler = ergebnis
        if messung is not None:
            messungen.append(messung)
        versuche.append(
            {"sensor_id": zeile.id, "versucht_am": jetzt,
             "erfolg": messung is not None, "fehler": fehler}
        )
        if messung is None and fehler:
            hinweise.append(f"{zeile.name}: {fehler}")

    async with SessionLocal() as sitzung:
        async with sitzung.begin():
            if messungen:
                # Ein Lauf von Hand und der geplante Lauf können sich auf die
                # Sekunde treffen. Dann gewinnt der erste.
                await sitzung.execute(
                    pg_insert(sensor_messungen)
                    .values(messungen)
                    .on_conflict_do_nothing(index_elements=["sensor_id", "gemessen_am"])
                )
            await sitzung.execute(sa.insert(sensor_versuche).values(versuche))

    return Ergebnis(
        gemessen=len(messungen),
        gescheitert=len(versuche) - len(messungen),
        hinweise=hinweise,
    )
