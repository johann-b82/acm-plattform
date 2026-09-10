"""Wartung: der Nachweisbogen.

Maschinen und Aufgaben sind gewöhnliches Lesen und Schreiben und gehen direkt
über PostgREST. Hier bleibt nur, was Python braucht: aus dem Raster ein
Excel-Blatt bauen und es von LibreOffice nach PDF wandeln lassen.

    GET /api/wartung/maschinen/{id}/bogen.pdf?jahr=&halbjahr=
"""
from __future__ import annotations

from datetime import date

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response, status

from app.auth import require_app
from app.db import SessionLocal, maschinen, wartungsaufgaben
from app.dokumente.pdf import PdfFehlgeschlagen
from app.wartung.bogen import baue_pdf

router = APIRouter(
    prefix="/api/wartung",
    tags=["wartung"],
    dependencies=[Depends(require_app("production"))],
)


@router.get("/maschinen/{maschine_id}/bogen.pdf")
async def bogen(
    maschine_id: str = Path(...),
    jahr: int = Query(default=0, ge=0, le=2999),
    halbjahr: int = Query(default=0, ge=0, le=2),
) -> Response:
    """Der Bogen für ein Halbjahr. Ohne Angabe: das laufende."""
    heute = date.today()
    jahr = jahr or heute.year
    halbjahr = halbjahr or (2 if heute.month > 6 else 1)

    async with SessionLocal() as sitzung:
        zeile = (
            await sitzung.execute(
                sa.select(maschinen).where(maschinen.c.id == maschine_id)
            )
        ).mappings().one_or_none()
        if zeile is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Diese Maschine gibt es nicht.")
        aufgaben = (
            await sitzung.execute(
                sa.select(wartungsaufgaben)
                .where(wartungsaufgaben.c.maschine_id == maschine_id)
                .order_by(wartungsaufgaben.c.erstellt_am)
            )
        ).mappings().all()

    try:
        pdf = await baue_pdf(dict(zeile), [dict(a) for a in aufgaben], jahr, halbjahr)
    except PdfFehlgeschlagen as fehler:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(fehler)) from fehler

    name = f"Wartungsnachweis {zeile['name']} {jahr} H{halbjahr}.pdf"
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{name}"',
            "X-Content-Type-Options": "nosniff",
        },
    )
