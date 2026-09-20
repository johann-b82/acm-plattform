"""Die laufende ATR-Nummer.

Wörtlich nach `compute_next_atr_number` im Altprojekt
(`backend/app/services/atr_deliver.py`): die höchste bereits vergebene
**numerische** Nummer plus eins, getrennt nach Programmfamilie — A350 und A380
führen eigene Nummernkreise. Ohne eine einzige numerische Nummer gibt es keinen
Vorschlag; die erste setzt jemand von Hand.

Nicht numerische Nummern (Altbestand wie `S-2024/1`) werden übergangen, statt
den Kreis zu verlassen.
"""
from __future__ import annotations

import sqlalchemy as sa

from app.atr.ziele import ist_a380
from app.db import SessionLocal, atr_lieferungen


async def naechste(programm: str | None) -> str | None:
    """Der Vorschlag für diese Programmfamilie, oder `None`."""
    ziffern = "380" if ist_a380(programm) else "350"
    async with SessionLocal() as sitzung:
        hoechste = (
            await sitzung.execute(
                sa.select(
                    sa.func.max(sa.cast(atr_lieferungen.c.atr_nummer, sa.BigInteger))
                ).where(
                    atr_lieferungen.c.atr_nummer.op("~")("^[0-9]+$"),
                    # Die Quelle schreibt die Familie uneinheitlich („A 380",
                    # „A380-800"); wie überall zählt die Ziffernfolge.
                    sa.func.coalesce(atr_lieferungen.c.programm, "A350").like(
                        f"%{ziffern}%"
                    ),
                )
            )
        ).scalar()
    return None if hoechste is None else str(hoechste + 1)


async def reservieren(lieferung_id: str, programm: str | None) -> str | None:
    """Vergibt die nächste Nummer transaktionssicher und schreibt sie sofort.

    Anders als `naechste()` (nur ein Vorschlag für die Maske) ist das die
    verbindliche Vergabe: ein transaktionsweiter Riegel je Programmfamilie
    serialisiert gleichzeitige Läufe, sodass keine zwei dieselbe Nummer lesen
    und keine rückwärts vergeben wird. Eine schon gesetzte Nummer bleibt; ohne
    numerischen Vorgänger gibt es keine — die erste setzt jemand von Hand.

    Die Nummer steht danach festgeschrieben in der Zeile, noch bevor die
    schweren Schritte (Gerüst, Excel, PDF, Ablage) laufen — der nächste Lauf
    sieht sie also schon.
    """
    ziffern = "380" if ist_a380(programm) else "350"
    async with SessionLocal() as sitzung:
        async with sitzung.begin():
            return (
                await sitzung.execute(
                    sa.text("select public.atr_nummer_reservieren(:id, :ziffern)"),
                    {"id": lieferung_id, "ziffern": ziffern},
                )
            ).scalar()
