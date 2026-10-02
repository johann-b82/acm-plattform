"""Serie erzeugen: für alle Personen eines Bereichs einen Einarbeitungsbogen.

Baut je Person den Bogeninhalt — die allgemeinen Onboarding-Punkte
(`einarbeitung_allgemein`) plus die Aufgabenfamilien des Bereichs
(`kompetenz_familien`) — und erzeugt daraus einen Vorgang mit Kennung (QR),
Vorgesetzter/Stelle/Eintritt aus Personio.

**Der Ansprechpartner ist der Bereichsleiter** (`kompetenz_bereiche.leiter`).
Zwei Regeln halten ihn plausibel:

* Ist die Person **selbst** der Bereichsleiter, steht der oberste Leiter (Toni)
  als Ansprechpartner — niemand weist sich selbst ein.
* Ist der Bereichsleiter **später eingetreten** als die Person, war er zur
  Einarbeitung noch nicht da; dann ebenfalls der oberste Leiter.

Ein fester Einweiser an einem allgemeinen Punkt gilt unverändert; ist er leer,
wird der Bereichsleiter eingesetzt.

Die Planung (`plan_person`) ist von der Erzeugung getrennt, damit sie ohne
LibreOffice und Storage prüfbar bleibt.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone

import sqlalchemy as sa

from app.db import (
    SessionLocal,
    dokumentvorgaenge,
    einarbeitung_allgemein,
    kompetenz_bereiche,
    kompetenz_familien,
    personio_employees,
    person_bereich,
)
from app.dokumente import speicher, vorgang
from app.dokumente.logo import lade_logo
from app.einarbeitung.bogen import Inhalt, baue_pdf

#: Der oberste Produktionsleiter — Ansprechpartner, wenn der Bereichsleiter
#: selbst eingearbeitet wird oder später eintrat. (Später als Einstellung.)
OBERSTER_LEITER = "Antonio Trombatore"


def _norm(s: str | None) -> str:
    return " ".join((s or "").split()).lower()


def effektiver_leiter(
    leiter: str | None,
    leiter_eintritt: date | None,
    person_name: str,
    person_eintritt: date | None,
    oberster: str = OBERSTER_LEITER,
) -> str:
    """Der Ansprechpartner der Tätigkeiten — Bereichsleiter, sonst der oberste."""
    if not leiter:
        return oberster
    if _norm(person_name) == _norm(leiter):
        return oberster
    if leiter_eintritt and person_eintritt and leiter_eintritt > person_eintritt:
        return oberster
    return leiter


@dataclass
class Plan:
    employee_id: int
    name: str
    stelle: str | None
    beginn: date | None
    vorgesetzter: str
    inhalt: list[dict]  # {thema, ansprechpartner, beschreibung}


def _stelle(roh) -> str | None:
    if not isinstance(roh, dict):
        return None
    return ((roh.get("attributes") or {}).get("position") or {}).get("value")


async def _namen_eintritt(sitzung) -> dict[str, date]:
    """Name (normiert) → Eintrittsdatum der aktiven Personen, für die Leiter-Regel."""
    zeilen = (
        await sitzung.execute(
            sa.select(
                personio_employees.c.first_name,
                personio_employees.c.last_name,
                personio_employees.c.hire_date,
            ).where(personio_employees.c.status == "active")
        )
    ).all()
    aus: dict[str, date] = {}
    for vn, nn, hire in zeilen:
        if hire is not None:
            aus.setdefault(_norm(f"{vn or ''} {nn or ''}"), hire)
    return aus


async def _allgemein(sitzung) -> list[dict]:
    zeilen = (
        await sitzung.execute(
            sa.select(
                einarbeitung_allgemein.c.thema,
                einarbeitung_allgemein.c.ansprechpartner,
                einarbeitung_allgemein.c.beschreibung,
            )
            .where(einarbeitung_allgemein.c.aktiv.is_(True))
            .order_by(einarbeitung_allgemein.c.reihenfolge)
        )
    ).mappings().all()
    return [dict(z) for z in zeilen]


async def plan_person(sitzung, employee_id: int, bereich, namen_eintritt: dict) -> Plan | None:
    """Den Bogeninhalt einer Person planen. `bereich` ist die Bereichszeile."""
    person = (
        await sitzung.execute(
            sa.select(
                personio_employees.c.first_name,
                personio_employees.c.last_name,
                personio_employees.c.hire_date,
                personio_employees.c.raw_json,
            ).where(personio_employees.c.id == employee_id)
        )
    ).mappings().one_or_none()
    if person is None:
        return None

    name = f"{person['first_name'] or ''} {person['last_name'] or ''}".strip()
    leiter_eintritt = namen_eintritt.get(_norm(bereich["leiter"])) if bereich["leiter"] else None
    leiter_eff = effektiver_leiter(bereich["leiter"], leiter_eintritt, name, person["hire_date"])

    inhalt: list[dict] = []
    for z in await _allgemein(sitzung):
        inhalt.append({
            "thema": z["thema"],
            "ansprechpartner": z["ansprechpartner"] or leiter_eff,
            "beschreibung": z["beschreibung"] or "",
        })
    familien = (
        await sitzung.execute(
            sa.select(kompetenz_familien.c.name, kompetenz_familien.c.beschreibung)
            .where(kompetenz_familien.c.bereich_id == bereich["id"])
            .order_by(kompetenz_familien.c.reihenfolge)
        )
    ).all()
    for fam_name, beschr in familien:
        inhalt.append({
            "thema": fam_name,
            "ansprechpartner": leiter_eff,
            "beschreibung": beschr or "",
        })

    return Plan(
        employee_id=employee_id,
        name=name,
        stelle=_stelle(person["raw_json"]),
        beginn=person["hire_date"],
        vorgesetzter=leiter_eff,
        inhalt=inhalt,
    )


async def _bereich(sitzung, bereich_id):
    return (
        await sitzung.execute(
            sa.select(kompetenz_bereiche).where(kompetenz_bereiche.c.id == bereich_id)
        )
    ).mappings().one_or_none()


async def personen_im_bereich(sitzung, bereich_id) -> list[int]:
    return list(
        (
            await sitzung.execute(
                sa.select(person_bereich.c.employee_id).where(
                    person_bereich.c.bereich_id == bereich_id
                )
            )
        ).scalars()
    )


@dataclass
class Erzeugt:
    vorgang_id: str
    doc_uid: str
    name: str


async def erzeuge_bereich(bereich_id: str) -> list[Erzeugt]:
    """Je Person des Bereichs einen Vorgang mit QR-Bogen anlegen und ablegen.

    Braucht LibreOffice (PDF) und den Storage — läuft auf der Plattform, nicht im
    Testlauf.
    """
    logo = await lade_logo()
    ergebnis: list[Erzeugt] = []
    async with SessionLocal() as sitzung:
        bereich = await _bereich(sitzung, bereich_id)
        if bereich is None:
            return ergebnis
        namen_eintritt = await _namen_eintritt(sitzung)
        employee_ids = await personen_im_bereich(sitzung, bereich_id)

    for employee_id in employee_ids:
        async with SessionLocal() as sitzung:
            plan = await plan_person(sitzung, employee_id, bereich, namen_eintritt)
        if plan is None:
            continue
        doc_uid = vorgang.neue_kennung()
        layout: dict = {}
        inhalte = [
            Inhalt(abteilung=z["thema"], ansprechpartner=z["ansprechpartner"], inhalt=z["beschreibung"])
            for z in plan.inhalt
        ]
        pdf = await baue_pdf(
            plan.name, plan.stelle, plan.beginn, inhalte, logo,
            doc_uid=doc_uid, layout_raus=layout, vorgesetzter=plan.vorgesetzter,
        )
        pfad = await speicher.ablegen(vorgang.pfad_blatt(doc_uid), pdf, "application/pdf")
        async with SessionLocal() as sitzung:
            async with sitzung.begin():
                zeile = (
                    await sitzung.execute(
                        dokumentvorgaenge.insert().values(
                            art="einarbeitung",
                            doc_uid=doc_uid,
                            employee_id=plan.employee_id,
                            name=plan.name,
                            funktion=plan.stelle,
                            beginn=plan.beginn,
                            inhalt=plan.inhalt,
                            pdf_pfad=pfad,
                            feld_layout=layout,
                            status="erstellt",
                            erstellt_am=datetime.now(timezone.utc),
                        ).returning(dokumentvorgaenge.c.id, dokumentvorgaenge.c.doc_uid)
                    )
                ).one()
        ergebnis.append(Erzeugt(vorgang_id=str(zeile[0]), doc_uid=zeile[1], name=plan.name))
    return ergebnis
