"""Zeugnisse: Text bilden und das Dokument setzen.

Stammdaten, Noten und Textbausteine sind gewöhnliches Lesen und Schreiben und
gehen über PostgREST. Hier bleibt, was Python braucht: die Abschnitte bilden
(Baukasten oder KI) und das Dokument auf der ACM-Briefvorlage setzen.

    POST /api/zeugnisse/{id}/baukasten   Abschnitte aus Textbausteinen bilden
    POST /api/zeugnisse/{id}/ki          dieselben Abschnitte von der KI
    GET  /api/zeugnisse/{id}/dokument.docx
    GET  /api/zeugnisse/{id}/dokument.pdf
    GET  /api/zeugnisse/{id}/unterschriften  wer darunter stehen wird

Die letzte Route ist ein Blick voraus: die linke Unterschrift hängt an der
Person und wird erst beim Setzen aufgelöst. Wer sie erst im fertigen PDF sieht,
merkt einen fehlenden Vorgesetzten zu spät.
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal
from types import SimpleNamespace

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response, status
from pydantic import BaseModel

from app.auth import require_app
from app.db import (
    SessionLocal,
    zeugnis_aussteller,
    zeugnis_bausteine,
    zeugnis_bewertungen,
    zeugnisse,
)
from app.dokumente.logo import lade_logo
from app.dokumente.pdf import PdfFehlgeschlagen
from app.zeugnis.baukasten import baue_abschnitte, ersetze_pronomen
from app.zeugnis.dokument import baue_docx, baue_pdf
from app.zeugnis.ki import ZeugnisKIError, generiere_abschnitte
from app.zeugnis.unterschriften import Unterschrift, beide

router = APIRouter(
    prefix="/api/zeugnisse",
    tags=["zeugnisse"],
    # Personenbezogene Leistungsdaten — keine reine Lesestufe.
    dependencies=[Depends(require_app("hr", "editor"))],
)


class Abschnitte(BaseModel):
    abschnitte: dict[str, str]
    schlussnote: float | None


class UnterschriftRead(BaseModel):
    name: str | None
    titel: str | None
    #: "personio" = aus der Organisationsstruktur, "profil" = Freitext aus den
    #: Einstellungen, "keine" = nirgends hinterlegt.
    quelle: str


class UnterschriftenRead(BaseModel):
    fachlich: UnterschriftRead
    personalseitig: UnterschriftRead


def _anrede(zeile) -> str:
    """„Herr/Frau Nachname" — der Platzhalter [NAME] wird lokal ersetzt."""
    nachname = (zeile["name"] or "").split()[-1] if zeile["name"] else ""
    anrede = {"m": "Herr", "w": "Frau"}.get((zeile["geschlecht"] or "").lower())
    return f"{anrede} {nachname}".strip() if anrede else (zeile["name"] or "")


async def _laden(zeugnis_id: str):
    async with SessionLocal() as sitzung:
        zeile = (
            await sitzung.execute(sa.select(zeugnisse).where(zeugnisse.c.id == zeugnis_id))
        ).mappings().one_or_none()
        if zeile is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Dieses Zeugnis gibt es nicht.")
        noten = {
            z["dimension"]: z["note"]
            for z in (
                await sitzung.execute(
                    sa.select(zeugnis_bewertungen).where(
                        zeugnis_bewertungen.c.zeugnis_id == zeugnis_id
                    )
                )
            ).mappings()
        }
        bausteine: dict[str, dict[int, str]] = {}
        for b in (await sitzung.execute(sa.select(zeugnis_bausteine))).mappings():
            bausteine.setdefault(b["dimension"], {})[b["note"]] = b["text"]
    return zeile, noten, bausteine


def _schnitt(noten: dict[str, int]) -> float | None:
    """Die Durchschnittsnote, kaufmännisch auf eine Stelle gerundet."""
    if not noten:
        return None
    mittel = Decimal(sum(noten.values())) / Decimal(len(noten))
    return float(mittel.quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))


async def _sichern(zeugnis_id: str, abschnitte: dict[str, str], schnitt: float | None):
    async with SessionLocal() as sitzung:
        async with sitzung.begin():
            await sitzung.execute(
                sa.update(zeugnisse)
                .where(zeugnisse.c.id == zeugnis_id)
                .values(abschnitte=abschnitte, schlussnote=schnitt)
            )


@router.post("/{zeugnis_id}/baukasten", response_model=Abschnitte)
async def baukasten(zeugnis_id: str = Path(...)) -> Abschnitte:
    """Die Abschnitte aus den Textbausteinen bilden — ohne Netz, ohne KI."""
    zeile, noten, bausteine = await _laden(zeugnis_id)
    schnitt = _schnitt(noten)
    abschnitte = baue_abschnitte(
        geschlecht=zeile["geschlecht"],
        geburtsdatum=zeile["geburtsdatum"],
        taetigkeit=zeile["taetigkeit"],
        abteilung=zeile["abteilung"],
        eintritt=zeile["eintritt"],
        austritt=zeile["austritt"],
        art=zeile["art"],
        anlass=zeile["anlass"],
        fuehrungskraft=zeile["fuehrungskraft"],
        noten=noten,
        schnitt=schnitt,
        stichpunkte=zeile["taetigkeit_stichpunkte"],
        kompetenzen=zeile["besondere_kompetenzen"],
        erfolge=zeile["besondere_erfolge"],
        bausteine=bausteine or None,
    )
    anrede = _anrede(zeile)
    fertig = {
        k: ersetze_pronomen(v, zeile["geschlecht"]).replace("[NAME]", anrede)
        for k, v in abschnitte.items()
    }
    await _sichern(zeugnis_id, fertig, schnitt)
    return Abschnitte(abschnitte=fertig, schlussnote=schnitt)


@router.post("/{zeugnis_id}/ki", response_model=Abschnitte)
async def ki(
    zeugnis_id: str = Path(...),
    abschnitt: str | None = Query(default=None),
) -> Abschnitte:
    """Dieselben Abschnitte, von der KI formuliert.

    **Was hinausgeht, ist bewusst wenig:** Anrede, Rolle, Abteilung, Dauer,
    Noten und die Freitexte. Name, Geburtsdatum und Personalnummer verlassen
    den Server nicht — die KI setzt `[NAME]`, hier wird ersetzt.
    """
    zeile, noten, _ = await _laden(zeugnis_id)
    schnitt = _schnitt(noten)
    try:
        abschnitte = await generiere_abschnitte(
            geschlecht=zeile["geschlecht"],
            taetigkeit=zeile["taetigkeit"],
            abteilung=zeile["abteilung"],
            eintritt=zeile["eintritt"],
            austritt=zeile["austritt"],
            art=zeile["art"],
            anlass=zeile["anlass"],
            fuehrungskraft=zeile["fuehrungskraft"],
            noten=noten,
            schnitt=schnitt,
            stichpunkte=zeile["taetigkeit_stichpunkte"],
            kompetenzen=zeile["besondere_kompetenzen"],
            erfolge=zeile["besondere_erfolge"],
            nur_abschnitt=abschnitt,
        )
    except ZeugnisKIError as fehler:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(fehler)) from fehler

    anrede = _anrede(zeile)
    vorhanden = dict(zeile["abschnitte"] or {})
    for schluessel, text in abschnitte.items():
        vorhanden[schluessel] = ersetze_pronomen(text, zeile["geschlecht"]).replace(
            "[NAME]", anrede
        )
    await _sichern(zeugnis_id, vorhanden, schnitt)
    return Abschnitte(abschnitte=vorhanden, schlussnote=schnitt)


async def _unterschriften(employee_id: int | None) -> tuple[Unterschrift, Unterschrift, dict | None]:
    async with SessionLocal() as sitzung:
        aussteller = (
            await sitzung.execute(sa.select(zeugnis_aussteller))
        ).mappings().one_or_none()
        links, rechts = await beide(sitzung, employee_id, aussteller)
    return links, rechts, dict(aussteller) if aussteller else None


async def _dokument(zeugnis_id: str) -> tuple[bytes, str]:
    zeile, _, _ = await _laden(zeugnis_id)
    links, rechts, aussteller = await _unterschriften(zeile["employee_id"])

    logo = await lade_logo()
    docx = baue_docx(
        SimpleNamespace(**dict(zeile)),
        SimpleNamespace(**aussteller) if aussteller else None,
        logo.daten if logo else None,
        supervisor_name=links.name,
        supervisor_titel=links.titel,
        hr_name=rechts.name,
        hr_titel=rechts.titel,
        dateiname=f"Zeugnis {zeile['name']}",
    )
    return docx, zeile["name"]


@router.get("/{zeugnis_id}/unterschriften", response_model=UnterschriftenRead)
async def unterschriften(zeugnis_id: str = Path(...)) -> UnterschriftenRead:
    """Wer unter diesem Zeugnis stehen wird — vor dem Erzeugen.

    Die linke Unterschrift hängt an der Person und wird sonst erst beim Setzen
    aufgelöst; ein fehlender Vorgesetzter fiele dann erst im fertigen PDF auf.
    """
    zeile, _, _ = await _laden(zeugnis_id)
    links, rechts, _ = await _unterschriften(zeile["employee_id"])
    return UnterschriftenRead(
        fachlich=UnterschriftRead(name=links.name, titel=links.titel, quelle=links.quelle),
        personalseitig=UnterschriftRead(
            name=rechts.name, titel=rechts.titel, quelle=rechts.quelle
        ),
    )


@router.get("/{zeugnis_id}/dokument.docx")
async def docx(zeugnis_id: str = Path(...)) -> Response:
    inhalt, name = await _dokument(zeugnis_id)
    return Response(
        content=inhalt,
        media_type=(
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        ),
        headers={
            "Content-Disposition": f'attachment; filename="Zeugnis {name}.docx"',
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/{zeugnis_id}/dokument.pdf")
async def pdf(zeugnis_id: str = Path(...)) -> Response:
    inhalt, name = await _dokument(zeugnis_id)
    try:
        fertig = await baue_pdf(inhalt)
    except PdfFehlgeschlagen as fehler:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(fehler)) from fehler
    return Response(
        content=fertig,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="Zeugnis {name}.pdf"',
            "X-Content-Type-Options": "nosniff",
        },
    )
