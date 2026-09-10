"""Schulungen: die Übersicht aus Excel übernehmen.

Der Teil, der in Python bleiben muss: eine transponierte Matrix mit drei Zeilen
je Schulung, Daten in drei Schreibweisen und ein Abgleich der Personalnummer
gegen ein Personio-Freifeld. Katalog, Anforderungsmatrix und Teilnahmen werden
danach über PostgREST gepflegt.

    POST /api/schulungen/vorschau      einlesen und zeigen
    POST /api/schulungen/uebernehmen   einlesen und schreiben
"""
from __future__ import annotations

from dataclasses import asdict

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from app.auth import require_app
from app.config import settings
from app.parsing.schulungsuebersicht import lies_uebersicht
from app.schulungen import uebernahme

router = APIRouter(
    prefix="/api/schulungen",
    tags=["schulungen"],
    dependencies=[Depends(require_app("hr", "editor"))],
)


class OhneZuordnung(BaseModel):
    personalnummer: str
    mitarbeiter_name: str | None
    teilnahmen: int


class Ergebnis(BaseModel):
    dateiname: str
    schulungen: int
    schulungen_neu: int
    teilnahmen: int
    teilnahmen_zugeordnet: int
    bereiche: dict[str, int]
    nicht_zugeordnet: list[OhneZuordnung]
    hinweise: list[str]


async def _lies(datei: UploadFile):
    name = datei.filename or ""
    if not name.lower().endswith(".xlsx"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Bitte eine .xlsx-Datei.")
    daten = await datei.read(settings.MAX_UPLOAD_BYTES + 1)
    if len(daten) > settings.MAX_UPLOAD_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Die Datei ist zu groß.")
    uebersicht = await run_in_threadpool(lies_uebersicht, daten)
    if not uebersicht.schulungen:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "In der Datei steht keine Schulungsübersicht. "
            + " ".join(uebersicht.hinweise[:3]),
        )
    return uebersicht, name


@router.post("/vorschau", response_model=Ergebnis)
async def vorschau(datei: UploadFile) -> Ergebnis:
    uebersicht, name = await _lies(datei)
    return Ergebnis(**asdict(await uebernahme.vorschau(uebersicht, name)))


@router.post("/uebernehmen", response_model=Ergebnis)
async def uebernehmen(datei: UploadFile) -> Ergebnis:
    uebersicht, name = await _lies(datei)
    return Ergebnis(**asdict(await uebernahme.uebernehmen(uebersicht, name)))
