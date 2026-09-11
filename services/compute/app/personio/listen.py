"""Die Auswahllisten für die Einstellungsmaske.

Drei Listen, die jemand sonst abtippen müsste: die Abwesenheitsarten (welche
als Krankheit zählen), die Abteilungen (welche zur Produktion gehören) und die
Personio-Felder (welche als gepflegte Kompetenz zählen). Im Altprojekt steht
dort ein Textfeld und daneben der Hinweis, die IDs aus Personio abzuschreiben.

**Zwei Quellen, bewusst getrennt.** Abteilungen und Feldnamen stehen bereits
im abgeglichenen Bestand — dafür braucht es kein Netz. Die Abwesenheits*arten*
werden nicht abgeglichen, sie stehen in keiner Tabelle; für sie fragt eine
Route Personio. Fällt das aus, bleiben die anderen beiden Listen trotzdem da,
und für die Arten gibt es einen Notnagel: was in den abgeglichenen
Abwesenheiten vorkommt, ist nachweislich in Gebrauch.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

import sqlalchemy as sa

from app.config import settings
from app.db import SessionLocal, personio_absences, personio_employees
from app.personio.client import PersonioClient, PersonioFehler

log = logging.getLogger(__name__)

# Felder, die keine Kompetenz sein können: Stammdaten, Geld, Verweise.
# Ohne diesen Filter stünden in der Auswahlliste 60 Einträge, von denen
# 50 offensichtlich nicht gemeint sind.
KEINE_KOMPETENZ = {
    "id", "first_name", "last_name", "email", "gender", "status", "position",
    "supervisor", "employment_type", "weekly_working_hours", "hire_date",
    "contract_end_date", "termination_date", "termination_type",
    "termination_reason", "probation_period_end", "created_at", "last_modified_at",
    "subcompany", "office", "department", "cost_centers", "holiday_calendar",
    "absence_entitlement", "work_schedule", "fix_salary", "fix_salary_interval",
    "hourly_salary", "vacation_day_balance", "last_working_day", "profile_picture",
    "team", "dynamic_flags", "preferred_name",
}


@dataclass
class Art:
    id: int
    name: str


@dataclass
class Listen:
    abwesenheitsarten: list[Art] = field(default_factory=list)
    abteilungen: list[str] = field(default_factory=list)
    felder: list[str] = field(default_factory=list)
    #: Was nicht ging. Kein Fehler — die Maske bleibt bedienbar, nur ohne
    #: Vorschlag. Ein 500 an dieser Stelle spränge einem Admin ins Gesicht,
    #: der bloß eine Abteilung eintragen will.
    hinweis: str | None = None
    #: True, wenn die Arten aus dem Bestand stammen statt von Personio.
    arten_aus_bestand: bool = False


def _name(knoten: Any) -> str | None:
    """Personio verschachtelt Referenzen: `{attributes: {name: {value: …}}}`."""
    if isinstance(knoten, str):
        return knoten.strip() or None
    if isinstance(knoten, dict):
        if "value" in knoten:
            return _name(knoten["value"])
        attrs = knoten.get("attributes")
        if isinstance(attrs, dict):
            return _name(attrs.get("name"))
    return None


def art_aus(roh: dict) -> Art | None:
    attrs = roh.get("attributes", roh)
    kennung = attrs.get("id", roh.get("id"))
    name = _name(attrs.get("name"))
    if isinstance(kennung, dict):
        kennung = kennung.get("value")
    if isinstance(kennung, int) and name:
        return Art(id=kennung, name=name)
    return None


def _typ_name(roh: Any) -> str | None:
    """Den Namen der Art aus einer abgeglichenen Abwesenheit ziehen."""
    if not isinstance(roh, dict):
        return None
    attrs = roh.get("attributes", roh)
    for schluessel in ("absence_type", "time_off_type", "type"):
        name = _name(attrs.get(schluessel)) if isinstance(attrs, dict) else None
        if name:
            return name
    return None


async def _aus_dem_bestand() -> tuple[list[str], list[str], list[Art]]:
    """Abteilungen, Feldnamen und die tatsächlich benutzten Arten — ohne Netz."""
    async with SessionLocal() as sitzung:
        abteilungen = [
            z[0]
            for z in (
                await sitzung.execute(
                    sa.select(personio_employees.c.department)
                    .where(personio_employees.c.department.isnot(None))
                    .distinct()
                    .order_by(personio_employees.c.department)
                )
            ).all()
            if z[0]
        ]
        rohdaten = (
            await sitzung.execute(
                sa.select(personio_employees.c.raw_json).where(
                    personio_employees.c.raw_json.isnot(None)
                )
            )
        ).scalars().all()
        arten_zeilen = (
            await sitzung.execute(
                sa.select(personio_absences.c.absence_type_id, personio_absences.c.raw_json)
                .where(personio_absences.c.absence_type_id.isnot(None))
                .distinct(personio_absences.c.absence_type_id)
            )
        ).all()

    felder: set[str] = set()
    for roh in rohdaten:
        attrs = (roh or {}).get("attributes")
        if isinstance(attrs, dict):
            felder.update(k for k in attrs if k not in KEINE_KOMPETENZ)

    arten: dict[int, Art] = {}
    for typ_id, roh in arten_zeilen:
        name = _typ_name(roh)
        arten[typ_id] = Art(id=typ_id, name=name or f"Art {typ_id}")

    return abteilungen, sorted(felder), sorted(arten.values(), key=lambda a: a.name.lower())


async def sammeln() -> Listen:
    abteilungen, felder, aus_bestand = await _aus_dem_bestand()
    listen = Listen(abteilungen=abteilungen, felder=felder)

    if not settings.PERSONIO_CLIENT_ID or not settings.PERSONIO_CLIENT_SECRET:
        listen.abwesenheitsarten = aus_bestand
        listen.arten_aus_bestand = True
        listen.hinweis = (
            "Personio-Zugangsdaten sind nicht hinterlegt. Die Arten stammen aus "
            "den bereits abgeglichenen Abwesenheiten."
        )
        return listen

    klient = PersonioClient(settings.PERSONIO_CLIENT_ID, settings.PERSONIO_CLIENT_SECRET)
    try:
        roh = await klient.abwesenheitsarten()
    except PersonioFehler as fehler:
        log.warning("Auswahllisten: Personio antwortet nicht (%s)", type(fehler).__name__)
        listen.abwesenheitsarten = aus_bestand
        listen.arten_aus_bestand = True
        listen.hinweis = (
            f"Personio antwortet gerade nicht ({fehler}). Die Arten stammen aus "
            "den bereits abgeglichenen Abwesenheiten."
        )
        return listen
    finally:
        await klient.schliessen()

    arten = [a for a in (art_aus(e) for e in roh) if a is not None]
    listen.abwesenheitsarten = sorted(arten, key=lambda a: a.name.lower())
    if not listen.abwesenheitsarten:
        listen.abwesenheitsarten = aus_bestand
        listen.arten_aus_bestand = True
        listen.hinweis = "Personio hat keine Abwesenheitsarten geliefert."
    return listen
