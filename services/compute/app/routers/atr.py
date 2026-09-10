"""ATR: Referenzmappe einlesen.

Der Teil, der in Python bleiben muss. Die Referenzmappe ist ein ausgefülltes
ATR-Formular in Excel; Kopfdaten stehen in festen Zellen, die Teile ab Zeile 14
zwischen Abschnittsüberschriften. Das lässt sich weder in SQL noch über
PostgREST lesen.

Alles danach ist gewöhnliches Lesen und Schreiben und geht direkt über
PostgREST — auch das Pflegen einzelner Teile.

    POST /api/atr/referenz    Mappe einlesen und in den Katalog übernehmen
"""
from __future__ import annotations

from datetime import datetime, timezone

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.auth import require_app
from app.config import settings
from app.db import SessionLocal, atr_teile, atr_vorlagen
from app.parsing.atr_referenz import MappeUnbrauchbar, lies_referenzmappe

router = APIRouter(
    prefix="/api/atr",
    tags=["atr"],
    dependencies=[Depends(require_app("atr", "editor"))],
)


class ImportErgebnis(BaseModel):
    dateiname: str
    programm: str | None
    teile_gelesen: int
    teile_neu: int
    teile_aktualisiert: int
    vorlage_uebernommen: bool
    hinweise: list[str]


async def _lies_begrenzt(datei: UploadFile) -> bytes:
    """Liest den Upload und bricht ab, sobald das Limit überschritten ist."""
    stuecke: list[bytes] = []
    gesamt = 0
    while stueck := await datei.read(64 * 1024):
        gesamt += len(stueck)
        if gesamt > settings.MAX_UPLOAD_BYTES:
            raise HTTPException(
                413,
                f"Datei überschreitet {settings.MAX_UPLOAD_BYTES // (1024 * 1024)} MB",
            )
        stuecke.append(stueck)
    return b"".join(stuecke)


@router.post("/referenz", response_model=ImportErgebnis)
async def referenz_einlesen(datei: UploadFile) -> ImportErgebnis:
    """Liest eine ATR-Referenzmappe und übernimmt Teile und Kopfdaten.

    Der Schlüssel ist die normierte Teilenummer. Ein Teil, das es schon gibt,
    wird aktualisiert statt verdoppelt — eine neuere Mappe soll die ältere
    korrigieren dürfen, ohne dass jemand vorher aufräumt.
    """
    daten = await _lies_begrenzt(datei)
    # openpyxl ist blockierend; ohne Thread stünde währenddessen der ganze
    # Prozess. Dieselbe Überlegung wie bei den ERP-Uploads.
    try:
        mappe = await run_in_threadpool(lies_referenzmappe, daten)
    except MappeUnbrauchbar as fehler:
        raise HTTPException(422, str(fehler)) from fehler

    jetzt = datetime.now(timezone.utc)
    programm = mappe.kopf.get("programm")
    hinweise = list(mappe.hinweise)

    zeilen = [
        {
            "teilenummer": t.teilenummer,
            "lieferantennummer": t.lieferantennummer,
            "bezeichnung": t.bezeichnung,
            "zeichnung": t.zeichnung,
            "gewicht_kg": t.gewicht_kg,
            "menge": t.menge,
            "kategorie": t.kategorie,
            "herkunft": datei.filename or "unbekannt",
            "erstellt_am": jetzt,
            "geaendert_am": jetzt,
        }
        for t in mappe.teile
    ]

    neu = 0
    aktualisiert = 0
    vorlage = False

    async with SessionLocal() as sitzung:
        async with sitzung.begin():
            if zeilen:
                vorher = set(
                    (
                        await sitzung.execute(
                            sa.select(atr_teile.c.teilenummer_norm)
                        )
                    ).scalars()
                )
                anweisung = pg_insert(atr_teile).values(zeilen)
                # `teilenummer_norm` ist erzeugt und steht deshalb nicht in den
                # Werten; der Index darauf ist trotzdem das Ziel des Konflikts.
                anweisung = anweisung.on_conflict_do_update(
                    index_elements=[atr_teile.c.teilenummer_norm],
                    index_where=atr_teile.c.teilenummer_norm.isnot(None),
                    set_={
                        spalte: anweisung.excluded[spalte]
                        for spalte in (
                            "teilenummer",
                            "lieferantennummer",
                            "bezeichnung",
                            "zeichnung",
                            "gewicht_kg",
                            "menge",
                            "kategorie",
                            "herkunft",
                            "geaendert_am",
                        )
                    },
                )
                await sitzung.execute(anweisung)

                nachher = set(
                    (
                        await sitzung.execute(
                            sa.select(atr_teile.c.teilenummer_norm)
                        )
                    ).scalars()
                )
                neu = len(nachher - vorher)
                aktualisiert = len(zeilen) - neu

            if programm:
                kopf = {
                    feld: wert
                    for feld, wert in mappe.kopf.items()
                    if feld != "programm"
                }
                vorlagen_zeile = {
                    "programm": programm,
                    **kopf,
                    "geaendert_am": jetzt,
                }
                anweisung = pg_insert(atr_vorlagen).values(vorlagen_zeile)
                # Die Gerüstdatei bleibt, wo sie ist: sie wird getrennt
                # hochgeladen und hat mit den Kopfdaten der Mappe nichts zu tun.
                await sitzung.execute(
                    anweisung.on_conflict_do_update(
                        index_elements=[atr_vorlagen.c.programm],
                        set_={
                            spalte: anweisung.excluded[spalte]
                            for spalte in (*kopf, "geaendert_am")
                        },
                    )
                )
                vorlage = True
            else:
                hinweise.append(
                    "Kein Programm in Zelle D2 — die Vorlage wurde nicht angelegt."
                )

    return ImportErgebnis(
        dateiname=datei.filename or "unbekannt",
        programm=programm,
        teile_gelesen=len(zeilen),
        teile_neu=neu,
        teile_aktualisiert=aktualisiert,
        vorlage_uebernommen=vorlage,
        hinweise=hinweise,
    )
