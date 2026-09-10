"""Kompetenzen: die Qualifikationsmatrix aus Excel übernehmen.

Der Teil, der in Python bleiben muss. Die Matrix ist transponiert (Zeilen sind
Qualifikationen, Spalten sind Personen mit je zwei Spalten), die Kopfzeile
wandert je nach Datei, und die Spaltenköpfe müssen gegen Personio zugeordnet
werden. Das Pflegen danach läuft über PostgREST.

    POST /api/kompetenzen/{bereich}/vorschau     einlesen und zeigen
    POST /api/kompetenzen/{bereich}/uebernehmen  einlesen und schreiben
"""
from __future__ import annotations

from dataclasses import asdict

from fastapi import APIRouter, Depends, HTTPException, Path, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from app.auth import require_app
from app.config import settings
from app.kompetenzen import uebernahme
from app.parsing.kompetenzmatrix import MatrixUnbrauchbar, lies_matrixdatei

router = APIRouter(
    prefix="/api/kompetenzen",
    tags=["kompetenzen"],
    dependencies=[Depends(require_app("hr", "editor"))],
)

BEREICHE = ("produktion", "verwaltung", "safety", "quality")
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


class MatrixVorschau(BaseModel):
    blatt: str
    titel: str | None
    qualifikationen: int
    personen: int
    bewertungen: int
    zugeordnet: int
    nicht_zugeordnet: list[str]
    platzhalter: int


class Ergebnis(BaseModel):
    dateiname: str
    bereich: str
    matrizen: list[MatrixVorschau]
    hinweise: list[str]


async def _lies(datei: UploadFile, bereich: str):
    if bereich not in BEREICHE:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Diesen Bereich gibt es nicht.")
    name = datei.filename or ""
    if not name.lower().endswith(".xlsx"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Bitte eine .xlsx-Datei.")
    daten = await datei.read(settings.MAX_UPLOAD_BYTES + 1)
    if len(daten) > settings.MAX_UPLOAD_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Die Datei ist zu groß.")
    try:
        return await run_in_threadpool(lies_matrixdatei, daten, name)
    except MatrixUnbrauchbar as fehler:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(fehler)) from fehler


@router.post("/{bereich}/vorschau", response_model=Ergebnis)
async def vorschau(datei: UploadFile, bereich: str = Path(...)) -> Ergebnis:
    """Zeigen, was der Import täte — ohne etwas zu schreiben."""
    gelesen = await _lies(datei, bereich)
    return Ergebnis(**asdict(await uebernahme.vorschau(gelesen, bereich)))


@router.post("/{bereich}/uebernehmen", response_model=Ergebnis)
async def uebernehmen(datei: UploadFile, bereich: str = Path(...)) -> Ergebnis:
    """Übernehmen — je Blatt ersetzend, alles in einer Transaktion."""
    gelesen = await _lies(datei, bereich)
    return Ergebnis(**asdict(await uebernahme.uebernehmen(gelesen, bereich)))
