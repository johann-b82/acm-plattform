"""Einarbeitung: der persönliche Bogen als PDF.

Katalog und Abteilungsmatrix sind gewöhnliches Lesen und Schreiben und gehen
über PostgREST. Hier bleibt nur das Formblatt.

    GET /api/einarbeitung/bogen.pdf?employee_id=  oder  ?name=&stelle=&beginn=
"""
from __future__ import annotations

import re
from datetime import date

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from app.auth import require_app
from app.db import (
    SessionLocal,
    einarbeitung_katalog,
    einarbeitung_pflicht,
    onboarding_abteilung,
    personio_employees,
)
from app.dokumente.logo import lade_logo
from app.dokumente.pdf import PdfFehlgeschlagen
from app.einarbeitung.bogen import Inhalt, baue_pdf

router = APIRouter(
    prefix="/api/einarbeitung",
    tags=["einarbeitung"],
    dependencies=[Depends(require_app("hr"))],
)


def _position_norm(text: str | None) -> str:
    """Wie `public.position_norm`: klein, getrimmt, ohne Mehrfachleerzeichen."""
    return re.sub(r"\s+", " ", text or "").strip().lower()


async def _inhalte(abteilung: str | None, position: str | None) -> list[Inhalt]:
    """Die Inhalte, die für Abteilung und Position dieser Person nötig sind.

    Vier Geltungen wie in der Matrix: alle · Abteilung · Position · beides. Fehlt
    der Person die Abteilung oder die Position, entfallen die daran hängenden
    Geltungen — „alle" bleibt immer.
    """
    pos_norm = _position_norm(position)
    geltung = einarbeitung_pflicht.c.geltung
    bedingungen = [geltung == "alle"]
    if abteilung:
        bedingungen.append(
            sa.and_(geltung == "abteilung", einarbeitung_pflicht.c.abteilung == abteilung)
        )
    if pos_norm:
        bedingungen.append(
            sa.and_(geltung == "position", einarbeitung_pflicht.c.position_norm == pos_norm)
        )
    if abteilung and pos_norm:
        bedingungen.append(
            sa.and_(
                geltung == "abteilung_position",
                einarbeitung_pflicht.c.abteilung == abteilung,
                einarbeitung_pflicht.c.position_norm == pos_norm,
            )
        )

    async with SessionLocal() as sitzung:
        zeilen = (
            await sitzung.execute(
                sa.select(
                    einarbeitung_katalog.c.inhalt,
                    einarbeitung_katalog.c.ansprechpartner,
                    einarbeitung_katalog.c.bereich,
                )
                .select_from(
                    einarbeitung_pflicht.join(
                        einarbeitung_katalog,
                        einarbeitung_katalog.c.id == einarbeitung_pflicht.c.einarbeitung_id,
                    )
                )
                .where(sa.or_(*bedingungen))
                .order_by(
                    einarbeitung_katalog.c.reihenfolge, einarbeitung_katalog.c.inhalt
                )
            )
        ).mappings().all()

    gesehen: set[str] = set()
    inhalte: list[Inhalt] = []
    for zeile in zeilen:
        if zeile["inhalt"] in gesehen:
            continue  # derselbe Inhalt aus zwei Geltungen steht einmal
        gesehen.add(zeile["inhalt"])
        inhalte.append(
            Inhalt(
                # Leerer Bereich heißt: die Abteilung der Person einsetzen.
                abteilung=zeile["bereich"] or abteilung or "",
                ansprechpartner=zeile["ansprechpartner"] or "",
                inhalt=zeile["inhalt"],
            )
        )
    return inhalte


@router.get("/bogen.pdf")
async def bogen(
    employee_id: int | None = Query(default=None),
    name: str | None = Query(default=None, max_length=200),
    stelle: str | None = Query(default=None, max_length=200),
    abteilung: str | None = Query(default=None, max_length=120),
    beginn: date | None = Query(default=None),
) -> Response:
    """Der Bogen für eine Person aus Personio — oder für frei eingegebene Angaben."""
    if employee_id is not None:
        async with SessionLocal() as sitzung:
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
        name = f"{zeile['first_name'] or ''} {zeile['last_name'] or ''}".strip()
        abteilung = zeile["uebersteuert"] or zeile["department"]
        beginn = beginn or zeile["hire_date"]
        roh = zeile["raw_json"] or {}
        stelle = stelle or (
            ((roh.get("attributes") or {}).get("position") or {}).get("value")
            if isinstance(roh, dict)
            else None
        )

    if not name:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Ohne Person oder Namen lässt sich kein Bogen bauen.",
        )

    inhalte = await _inhalte(abteilung, stelle)
    logo = await lade_logo()

    try:
        pdf = await baue_pdf(name, stelle, beginn, inhalte, logo)
    except PdfFehlgeschlagen as fehler:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(fehler)) from fehler

    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="Einarbeitungsplan {name}.pdf"',
            "X-Content-Type-Options": "nosniff",
        },
    )
