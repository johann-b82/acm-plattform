"""Kompetenzen: die Interviewdatei übernehmen.

Der Teil, der in Python bleiben muss — Excel lesen, Namen gegen Personio
zuordnen. Das Pflegen danach läuft über PostgREST.

    POST /api/kompetenzen/interview/vorschau     einlesen und zeigen
    POST /api/kompetenzen/interview/uebernehmen  einlesen und schreiben
"""
from __future__ import annotations

from dataclasses import asdict

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from app.auth import require_app
from app.config import settings
from app.kompetenzen import interview
from app.parsing.interview import InterviewUnbrauchbar, lies_interviewdatei

router = APIRouter(
    prefix="/api/kompetenzen",
    tags=["kompetenzen"],
    dependencies=[Depends(require_app("hr", "editor"))],
)


class BlattVorschau(BaseModel):
    bereich: str
    bereich_neu: bool
    familien: int
    familien_neu: list[str]
    familien_entfallen: list[str]
    personen: int
    zugeordnet: int
    nicht_zugeordnet: list[str]


class Ergebnis(BaseModel):
    dateiname: str
    blaetter: list[BlattVorschau]
    hinweise: list[str]


async def _lies(datei: UploadFile):
    name = datei.filename or ""
    if not name.lower().endswith(".xlsx"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Bitte eine .xlsx-Datei.")
    daten = await datei.read(settings.MAX_UPLOAD_BYTES + 1)
    if len(daten) > settings.MAX_UPLOAD_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Die Datei ist zu groß.")
    try:
        return await run_in_threadpool(lies_interviewdatei, daten, name)
    except InterviewUnbrauchbar as fehler:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(fehler)) from fehler


@router.post("/interview/vorschau", response_model=Ergebnis)
async def vorschau(datei: UploadFile) -> Ergebnis:
    """Zeigen, was der Import täte — ohne etwas zu schreiben."""
    gelesen = await _lies(datei)
    return Ergebnis(**asdict(await interview.vorschau(gelesen)))


@router.post("/interview/uebernehmen", response_model=Ergebnis)
async def uebernehmen(datei: UploadFile) -> Ergebnis:
    """Übernehmen — ergänzend, alles in einer Transaktion."""
    gelesen = await _lies(datei)
    return Ergebnis(**asdict(await interview.uebernehmen(gelesen)))
