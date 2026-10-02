"""Einarbeitung: der persönliche Bogen als PDF.

Katalog und Abteilungsmatrix sind gewöhnliches Lesen und Schreiben und gehen
über PostgREST. Hier bleibt nur das Formblatt.

    GET /api/einarbeitung/bogen.pdf?employee_id=  oder  ?name=&stelle=&beginn=
"""
from __future__ import annotations

import re
from dataclasses import asdict
from datetime import date

import sqlalchemy as sa
from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Response,
    UploadFile,
    status,
)

from app.auth import require_app
from app.config import settings
from app.db import (
    SessionLocal,
    einarbeitung_katalog,
    einarbeitung_pflicht,
    onboarding_abteilung,
    personio_employees,
)
from app.dokumente import speicher, vorgang
from app.dokumente.logo import lade_logo
from app.dokumente.pdf import PdfFehlgeschlagen
from app.einarbeitung import serie as serie_mod
from app.einarbeitung import upload as upload_mod
from app.einarbeitung.bogen import Inhalt, baue_pdf
from app.einarbeitung.upload import Zugeordnet

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


@router.post("/serie", dependencies=[Depends(require_app("hr", "editor"))])
async def serie(bereich_id: str = Query(...)) -> Response:
    """Für alle Personen eines Bereichs je einen Einarbeitungsvorgang mit QR
    anlegen (Vorgesetzter/Stelle/Eintritt aus Personio, Ansprechpartner =
    Bereichsleiter) und alle Blätter als **ein Druck-PDF** zurückgeben. Die
    Anzahl der angelegten Vorgänge steht im Header `X-Serie-Anzahl`."""
    try:
        erg = await serie_mod.erzeuge_bereich(bereich_id)
    except PdfFehlgeschlagen as fehler:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(fehler)) from fehler
    if not erg.erzeugt:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "Diesen Bereich gibt es nicht, oder er hat keine zugeordneten Personen.",
        )
    return Response(
        content=erg.pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": 'inline; filename="Einarbeitungsboegen.pdf"',
            "X-Serie-Anzahl": str(len(erg.erzeugt)),
            "X-Content-Type-Options": "nosniff",
        },
    )


def _scan_daten(datei: UploadFile) -> tuple[bytes, str, str]:
    """Bytes, Endung und MIME eines Scans — oder HTTPException."""
    daten = datei.file.read(settings.MAX_UPLOAD_BYTES + 1)
    if len(daten) > settings.MAX_UPLOAD_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Die Datei ist zu groß.")
    if not daten:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Die Datei ist leer.")
    endung = vorgang.endung_aus(datei.filename or "", datei.content_type)
    typ = vorgang.mime_aus(datei.filename or "", datei.content_type)
    if typ is None or endung not in {"pdf", "png", "jpg"}:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                            "Ein Scan muss ein PDF, PNG oder JPEG sein.")
    return daten, endung, typ


@router.post("/upload", dependencies=[Depends(require_app("hr", "editor"))])
async def upload(dateien: list[UploadFile] = File(...)) -> dict:
    """Viele unterschriebene Bögen auf einmal — je Blatt QR lesen, Vorgang
    finden, Scan ablegen und abschließen. Ohne Treffer: „nicht zugeordnet"."""
    aus: list[Zugeordnet] = []
    for datei in dateien:
        try:
            daten, endung, typ = _scan_daten(datei)
        except HTTPException as fehler:
            aus.append(Zugeordnet(datei.filename or "", "fehler", meldung=fehler.detail))
            continue
        try:
            aus.append(await upload_mod.ein_blatt(datei.filename or "", daten, endung, typ))
        except (PdfFehlgeschlagen, speicher.SpeicherFehler) as fehler:
            aus.append(Zugeordnet(datei.filename or "", "fehler", meldung=str(fehler)))
    return {"ergebnisse": [asdict(z) for z in aus]}


@router.post("/upload/manuell", dependencies=[Depends(require_app("hr", "editor"))])
async def upload_manuell(
    employee_id: int = Form(...), datei: UploadFile = File(...)
) -> dict:
    """Einen Altbestand von Hand einer Person zuordnen und als abgeschlossen
    übernehmen (der Scan wird als Nachweis abgelegt)."""
    daten, endung, typ = _scan_daten(datei)
    try:
        z = await upload_mod.manuell_abschliessen(employee_id, daten, endung, typ)
    except speicher.SpeicherFehler as fehler:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(fehler)) from fehler
    if z.status == "fehler":
        raise HTTPException(status.HTTP_404_NOT_FOUND, z.meldung or "Zuordnung fehlgeschlagen.")
    return asdict(z)
