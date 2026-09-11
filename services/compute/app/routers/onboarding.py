"""Onboarding: die Papiere für einen Eintritt.

Eintritte, Schulungsplan und Abteilungs-Übersteuerung sind gewöhnliches Lesen
und Schreiben und gehen über PostgREST. Hier bleiben die beiden Formblätter.

    GET /api/onboarding/uebersicht.pdf?employee_id=  Formblatt 71 allein
    GET /api/onboarding/paket.pdf?employee_id=       Einarbeitung + Übersicht

Das Paket vermerkt beim ersten Abruf, dass die Übergabe stattgefunden hat —
damit verschwindet die „neu"-Markierung aus der Eintrittsliste. Beim zweiten
Abruf passiert nichts mehr: der Vermerk sagt „ist übergeben worden", nicht
„ist zuletzt gedruckt worden".
"""
from __future__ import annotations

from datetime import date, datetime, timezone

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from app.auth import require_app
from app.db import (
    SessionLocal,
    einarbeitung_katalog,
    einarbeitung_pflicht,
    externe_personen,
    onboarding_abteilung,
    onboarding_paket,
    personio_employees,
)
from app.dokumente.logo import lade_logo
from app.dokumente.pdf import PdfFehlgeschlagen
from app.einarbeitung.bogen import Inhalt
from app.onboarding import paket as paket_bogen
from app.onboarding import uebersicht as uebersicht_bogen
from app.routers.einarbeitung import _inhalte

router = APIRouter(
    prefix="/api/onboarding",
    tags=["onboarding"],
    dependencies=[Depends(require_app("hr"))],
)


class Person:
    """Wer den Bogen bekommt — aus Personio oder extern gepflegt."""

    def __init__(self, name: str, stelle: str | None, abteilung: str | None,
                 beginn: date | None, employee_id: int | None, extern_id: str | None):
        self.name = name
        self.stelle = stelle
        self.abteilung = abteilung
        self.beginn = beginn
        self.employee_id = employee_id
        self.extern_id = extern_id


def _position(roh) -> str | None:
    if not isinstance(roh, dict):
        return None
    wert = ((roh.get("attributes") or {}).get("position") or {}).get("value")
    return str(wert).strip() or None if isinstance(wert, str) else None


async def _person(employee_id: int | None, extern_id: str | None) -> Person:
    if (employee_id is None) == (extern_id is None):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Genau eine Person angeben: employee_id oder extern_id.",
        )

    async with SessionLocal() as sitzung:
        if employee_id is not None:
            zeile = (
                await sitzung.execute(
                    sa.select(
                        personio_employees.c.first_name,
                        personio_employees.c.last_name,
                        personio_employees.c.department,
                        personio_employees.c.hire_date,
                        personio_employees.c.raw_json,
                        onboarding_abteilung.c.abteilung.label("uebersteuert"),
                    ).select_from(
                        personio_employees.outerjoin(
                            onboarding_abteilung,
                            onboarding_abteilung.c.employee_id == personio_employees.c.id,
                        )
                    ).where(personio_employees.c.id == employee_id)
                )
            ).mappings().one_or_none()
            if zeile is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Diese Person gibt es nicht.")
            return Person(
                name=f"{zeile['first_name'] or ''} {zeile['last_name'] or ''}".strip(),
                stelle=_position(zeile["raw_json"]),
                abteilung=zeile["uebersteuert"] or zeile["department"],
                beginn=zeile["hire_date"],
                employee_id=employee_id,
                extern_id=None,
            )

        zeile = (
            await sitzung.execute(
                sa.select(externe_personen).where(externe_personen.c.id == extern_id)
            )
        ).mappings().one_or_none()
    if zeile is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Diese Person gibt es nicht.")
    return Person(
        name=zeile["name"],
        stelle=zeile["position"],
        abteilung=zeile["abteilung"],
        beginn=zeile["eintritt"],
        employee_id=None,
        extern_id=extern_id,
    )


async def _soll_schulungen(person: Person) -> list[uebersicht_bogen.Zeile]:
    """Was die Anforderungsmatrix für diese Person verlangt.

    Für extern gepflegte Personen gibt es keine Personio-Kennung und damit
    keinen Plan aus `schulungsplan()`. Dann bleibt das Blatt leer — mit
    Tabellenkopf, zum Ausfüllen von Hand. Ein leeres Formular ist brauchbar,
    ein erfundenes nicht.
    """
    if person.employee_id is None:
        return []
    async with SessionLocal() as sitzung:
        zeilen = (
            await sitzung.execute(
                sa.text(
                    "select bereich, name, quelle from public.schulungsplan(:i)"
                    " where quelle <> 'kuerzel_fehlt'"
                    " order by bereich, name"
                ),
                {"i": person.employee_id},
            )
        ).mappings().all()
    # Dieselbe Schulung kann über beide Ebenen verlangt sein — einmal reicht.
    gesehen: set[str] = set()
    ergebnis: list[uebersicht_bogen.Zeile] = []
    for zeile in zeilen:
        bezeichnung = f"{zeile['bereich']}: {zeile['name']}" if zeile["bereich"] else zeile["name"]
        if bezeichnung in gesehen:
            continue
        gesehen.add(bezeichnung)
        ergebnis.append(uebersicht_bogen.Zeile(bezeichnung=bezeichnung))
    return ergebnis


async def _einarbeitung(person: Person, abteilungen: list[str] | None) -> list[Inhalt]:
    gewaehlt = [a.strip() for a in (abteilungen or []) if a and a.strip()]
    if not gewaehlt and person.abteilung:
        gewaehlt = [person.abteilung]
    return await _inhalte(gewaehlt)


def _antwort(pdf: bytes, dateiname: str) -> Response:
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{dateiname}.pdf"',
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/uebersicht.pdf")
async def uebersicht(
    employee_id: int | None = Query(default=None),
    extern_id: str | None = Query(default=None),
) -> Response:
    """Formblatt 71 allein — die Schulungsübersicht der Person."""
    person = await _person(employee_id, extern_id)
    try:
        pdf = await uebersicht_bogen.baue_pdf(
            person.name,
            person.stelle or "",
            await _soll_schulungen(person),
            logo=await lade_logo(),
        )
    except PdfFehlgeschlagen as fehler:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(fehler)) from fehler
    return _antwort(pdf, f"Schulungsübersicht {person.name}")


@router.get("/paket.pdf")
async def paket(
    employee_id: int | None = Query(default=None),
    extern_id: str | None = Query(default=None),
    abteilungen: list[str] | None = Query(default=None),
) -> Response:
    """Einarbeitungsplan und Schulungsübersicht als **ein** Dokument.

    `abteilungen` ergänzt den Einarbeitungsteil um weitere Abteilungen (etwa
    QS zusätzlich zur Produktion); ohne Angabe gilt die Abteilung der Person.
    """
    person = await _person(employee_id, extern_id)
    try:
        pdf = await paket_bogen.baue_pdf(
            person.name,
            person.stelle,
            person.beginn,
            await _einarbeitung(person, abteilungen),
            await _soll_schulungen(person),
            await lade_logo(),
        )
    except PdfFehlgeschlagen as fehler:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(fehler)) from fehler

    await _uebergabe_vermerken(person)
    return _antwort(pdf, f"Onboarding-Paket {person.name}")


async def _uebergabe_vermerken(person: Person) -> None:
    """Einmalig festhalten, dass das Paket ausgeliefert wurde.

    `on conflict do nothing` statt erst lesen, dann schreiben: zwei
    gleichzeitige Abrufe liefen sonst in einen doppelten Eintrag, und der
    eindeutige Index wiese den zweiten mit einem Fehler ab — für eine
    Nebensache, die niemanden interessiert.
    """
    async with SessionLocal() as sitzung:
        async with sitzung.begin():
            await sitzung.execute(
                sa.text(
                    "insert into public.onboarding_paket"
                    " (employee_id, extern_id, heruntergeladen_am)"
                    " values (:e, :x, :z)"
                    " on conflict do nothing"
                ),
                {
                    "e": person.employee_id,
                    "x": person.extern_id,
                    "z": datetime.now(timezone.utc),
                },
            )
