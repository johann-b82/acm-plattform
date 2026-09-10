"""ATR: Referenzmappe einlesen.

Der Teil, der in Python bleiben muss. Die Referenzmappe ist ein ausgefülltes
ATR-Formular in Excel; Kopfdaten stehen in festen Zellen, die Teile ab Zeile 14
zwischen Abschnittsüberschriften. Das lässt sich weder in SQL noch über
PostgREST lesen.

Alles danach ist gewöhnliches Lesen und Schreiben und geht direkt über
PostgREST — auch das Pflegen einzelner Teile.

    POST /api/atr/referenz       Mappe einlesen und in den Katalog übernehmen
    POST /api/atr/lieferschein   Lieferschein einlesen, abgleichen, als Entwurf ablegen
"""
from __future__ import annotations

from datetime import date, datetime, timezone

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.auth import require_app
from app.config import settings
from app.db import (
    SessionLocal,
    atr_lieferungen,
    atr_positionen,
    atr_teile,
    atr_vorlagen,
)
from app.parsing.atr_lieferschein import (
    Lieferschein,
    Position,
    TextNichtLesbar,
    lies_pdf,
)
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


class LieferscheinErgebnis(BaseModel):
    lieferung_id: str
    dateiname: str
    lieferschein_nr: str | None
    programm: str | None
    programm_grund: str
    positionen: int
    zugeordnet: int
    hinweise: list[str]


def _datum(deutsch: str | None) -> date | None:
    if not deutsch:
        return None
    try:
        tag, monat, jahr = deutsch.split(".")
        return date(int(jahr), int(monat), int(tag))
    except (ValueError, AttributeError):
        return None


def _programm_und_grund(schein: Lieferschein) -> tuple[str | None, str, str | None]:
    """Programm, Begründung und Satztitel aus der ersten Position.

    Die Begründung steht mit in der Zeile, damit später nachvollziehbar ist,
    warum ein ATR unter A350 oder A380 läuft — im Altprojekt ist das ein
    stiller Zweig, und wer die Ausgabe prüft, sieht nur das Ergebnis.
    """
    kopf: Position | None = schein.positionen[0] if schein.positionen else None
    programm = kopf.programm if kopf else None
    bereich = kopf.bereich if kopf else None
    bett = kopf.bettvariante if kopf else None
    titel = f"SET {bett} BED {bereich}" if bett and bereich else None

    if programm == "A380":
        return programm, "A380 aus den Bestelldaten erkannt.", titel or "SET MSN UAE"
    if programm == "A350":
        return programm, "A350 aus den Bestelldaten erkannt.", titel
    return (
        None,
        "Kein A350- oder A380-Merkmal im Lieferschein — Programm bitte prüfen.",
        titel,
    )


@router.post("/lieferschein", response_model=LieferscheinErgebnis)
async def lieferschein_einlesen(datei: UploadFile) -> LieferscheinErgebnis:
    """Liest einen Lieferschein, gleicht gegen den Katalog ab und legt einen
    Entwurf an.

    Was der Katalog liefert, wird in die Position **kopiert**, nicht verlinkt.
    Der Katalog ändert sich; ein freigegebener ATR nicht.
    """
    daten = await _lies_begrenzt(datei)
    try:
        schein = await lies_pdf(daten)
    except TextNichtLesbar as fehler:
        raise HTTPException(422, str(fehler)) from fehler

    programm, grund, titel = _programm_und_grund(schein)
    kopf: Position | None = schein.positionen[0] if schein.positionen else None
    jetzt = datetime.now(timezone.utc)

    async with SessionLocal() as sitzung:
        async with sitzung.begin():
            nummern = [
                p.teilenummer for p in schein.positionen if p.teilenummer
            ]
            katalog: dict[str, dict] = {}
            if nummern:
                treffer = await sitzung.execute(
                    sa.select(
                        atr_teile.c.id,
                        atr_teile.c.teilenummer_norm,
                        atr_teile.c.bezeichnung,
                        atr_teile.c.zeichnung,
                        atr_teile.c.kategorie,
                        atr_teile.c.gewicht_kg,
                    ).where(
                        atr_teile.c.teilenummer_norm.in_(
                            sa.select(
                                sa.func.public.atr_teilenummer_norm(
                                    sa.func.unnest(sa.literal(nummern, sa.ARRAY(sa.Text)))
                                )
                            )
                        )
                    )
                )
                katalog = {
                    zeile.teilenummer_norm: dict(zeile._mapping)
                    for zeile in treffer
                    if zeile.teilenummer_norm
                }

            lieferung = (
                await sitzung.execute(
                    atr_lieferungen.insert()
                    .values(
                        quelle_dateiname=datei.filename or "unbekannt",
                        lieferschein_nr=schein.lieferschein_nr,
                        datum=_datum(schein.datum),
                        ba_auftrag=kopf.ba_auftrag if kopf else None,
                        bestellnummer=kopf.bestellnummer if kopf else None,
                        programm=programm,
                        programm_grund=grund,
                        bereich=kopf.bereich if kopf else None,
                        msn=kopf.msn if kopf else None,
                        bettvariante=kopf.bettvariante if kopf else None,
                        satz_titel=titel,
                        status="entwurf",
                        hinweise=schein.hinweise,
                        erstellt_am=jetzt,
                        geaendert_am=jetzt,
                    )
                    .returning(atr_lieferungen.c.id)
                )
            ).scalar_one()

            zugeordnet = 0
            zeilen = []
            for reihe, p in enumerate(schein.positionen, start=1):
                norm = "".join(c for c in (p.teilenummer or "") if c.isdigit())
                teil = katalog.get(norm)
                if teil:
                    zugeordnet += 1
                zeilen.append(
                    {
                        "lieferung_id": lieferung,
                        "reihenfolge": reihe,
                        "pos": p.pos,
                        "lieferantennummer": p.lieferantennummer,
                        "teilenummer": p.teilenummer,
                        "teil_id": teil["id"] if teil else None,
                        # Aus dem Katalog kopiert, wo es ihn gibt; sonst das,
                        # was auf dem Lieferschein stand.
                        "bezeichnung": (teil or {}).get("bezeichnung") or p.bezeichnung,
                        "zeichnung": (teil or {}).get("zeichnung"),
                        "kategorie": (teil or {}).get("kategorie"),
                        "menge": p.menge,
                        "gewicht_kg": (teil or {}).get("gewicht_kg"),
                        "bestellposition": p.bestellposition,
                        "seriennummern": p.seriennummern,
                        "erstellt_am": jetzt,
                        "geaendert_am": jetzt,
                    }
                )
            if zeilen:
                await sitzung.execute(atr_positionen.insert(), zeilen)

    return LieferscheinErgebnis(
        lieferung_id=str(lieferung),
        dateiname=datei.filename or "unbekannt",
        lieferschein_nr=schein.lieferschein_nr,
        programm=programm,
        programm_grund=grund,
        positionen=len(schein.positionen),
        zugeordnet=zugeordnet,
        hinweise=schein.hinweise,
    )
