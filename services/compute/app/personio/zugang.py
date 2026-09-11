"""Woher die Personio-Zugangsdaten kommen.

Zuerst aus der Tabelle `geheimnisse`, sonst aus der Umgebung. Beides ist
nötig: der Server steht in Aachen, und wer die Zugangsdaten wechselt, sitzt
nicht zwangsläufig davor — deshalb die Maske. Wo sie schon in der `.env`
stehen, sollen sie aber weiter gelten, ohne dass jemand sie abtippt.

Verschlüsselt werden sie mit `app.geheim`; der Schlüssel dafür liegt in der
Umgebung von `compute`. Ein Abzug der Datenbank allein gibt nichts her, und
über PostgREST kommt die Tabelle gar nicht heraus — sie hat für `anon` und
`authenticated` keine Rechte.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app import geheim
from app.config import settings
from app.db import SessionLocal, geheimnisse
from app.personio.client import PersonioClient

KENNUNG = "personio_client_id"
GEHEIMNIS = "personio_client_secret"


@dataclass(frozen=True)
class Zugang:
    client_id: str
    client_secret: str
    aus_datenbank: bool


@dataclass(frozen=True)
class Stand:
    """Was die Maske zeigen darf — nie die Zugangsdaten selbst."""

    gesetzt: bool
    quelle: str | None  # "datenbank" | "umgebung" | None
    geaendert_am: datetime | None = None
    geaendert_von: str | None = None
    schluessel_bereit: bool = True


async def _aus_datenbank() -> dict[str, bytes]:
    async with SessionLocal() as sitzung:
        zeilen = (
            await sitzung.execute(
                sa.select(geheimnisse.c.schluessel, geheimnisse.c.geheimtext).where(
                    geheimnisse.c.schluessel.in_([KENNUNG, GEHEIMNIS])
                )
            )
        ).all()
    return {z.schluessel: z.geheimtext for z in zeilen}


async def lesen() -> Zugang | None:
    """Die geltenden Zugangsdaten, oder nichts, wenn keine hinterlegt sind.

    Ein halb gefülltes Paar in der Datenbank zählt nicht — dann gilt die
    Umgebung, sonst liefe der Abgleich mit einem leeren Geheimnis los."""
    abgelegt = await _aus_datenbank()
    if KENNUNG in abgelegt and GEHEIMNIS in abgelegt:
        try:
            return Zugang(
                client_id=geheim.entschluesseln(abgelegt[KENNUNG]),
                client_secret=geheim.entschluesseln(abgelegt[GEHEIMNIS]),
                aus_datenbank=True,
            )
        except (geheim.KeinSchluessel, geheim.NichtLesbar):
            # Schlüssel weg oder gewechselt: lieber die Umgebung als gar nichts.
            pass
    if settings.PERSONIO_CLIENT_ID and settings.PERSONIO_CLIENT_SECRET:
        return Zugang(
            client_id=settings.PERSONIO_CLIENT_ID,
            client_secret=settings.PERSONIO_CLIENT_SECRET,
            aus_datenbank=False,
        )
    return None


async def klient() -> PersonioClient | None:
    """Ein fertiger Client, oder nichts, wenn keine Zugangsdaten dastehen."""
    zugang = await lesen()
    if zugang is None:
        return None
    return PersonioClient(zugang.client_id, zugang.client_secret)


async def stand() -> Stand:
    async with SessionLocal() as sitzung:
        zeilen = (
            await sitzung.execute(
                sa.select(
                    geheimnisse.c.schluessel,
                    geheimnisse.c.geaendert_am,
                    geheimnisse.c.geaendert_von,
                ).where(geheimnisse.c.schluessel.in_([KENNUNG, GEHEIMNIS]))
            )
        ).all()
        if {z.schluessel for z in zeilen} == {KENNUNG, GEHEIMNIS}:
            juengste = max(zeilen, key=lambda z: z.geaendert_am)
            wer = None
            if juengste.geaendert_von:
                wer = (
                    await sitzung.execute(
                        sa.text("select email from auth.users where id = :id"),
                        {"id": juengste.geaendert_von},
                    )
                ).scalar_one_or_none()
            return Stand(
                gesetzt=True,
                quelle="datenbank",
                geaendert_am=juengste.geaendert_am,
                geaendert_von=wer,
                schluessel_bereit=geheim.einsatzbereit(),
            )

    aus_umgebung = bool(settings.PERSONIO_CLIENT_ID and settings.PERSONIO_CLIENT_SECRET)
    return Stand(
        gesetzt=aus_umgebung,
        quelle="umgebung" if aus_umgebung else None,
        schluessel_bereit=geheim.einsatzbereit(),
    )


async def setzen(client_id: str, client_secret: str, benutzer_id: str | None) -> None:
    """Beide Hälften in einem Rutsch — halb gesetzt wäre schlimmer als gar nicht."""
    jetzt = datetime.now(timezone.utc)
    zeilen = [
        {
            "schluessel": schluessel,
            "geheimtext": geheim.verschluesseln(wert),
            "geaendert_am": jetzt,
            "geaendert_von": benutzer_id,
        }
        for schluessel, wert in ((KENNUNG, client_id), (GEHEIMNIS, client_secret))
    ]
    async with SessionLocal() as sitzung:
        async with sitzung.begin():
            for zeile in zeilen:
                await sitzung.execute(
                    pg_insert(geheimnisse)
                    .values(**zeile)
                    .on_conflict_do_update(
                        index_elements=[geheimnisse.c.schluessel],
                        set_={
                            "geheimtext": zeile["geheimtext"],
                            "geaendert_am": jetzt,
                            "geaendert_von": benutzer_id,
                        },
                    )
                )


async def loeschen() -> bool:
    """Wieder auf die Umgebung zurückfallen. Gibt zurück, ob etwas dastand."""
    async with SessionLocal() as sitzung:
        async with sitzung.begin():
            ergebnis = await sitzung.execute(
                sa.delete(geheimnisse).where(
                    geheimnisse.c.schluessel.in_([KENNUNG, GEHEIMNIS])
                )
            )
    return ergebnis.rowcount > 0
