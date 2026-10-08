"""Datei-Uploads der ERP-Exporte.

Das ist der Teil, der in Python bleiben muss: die Exporte haben deutsche
Zahlen, Latin-1-Kodierung und Eigenheiten je Datei, die pandas abfängt.
Alles danach (Auswertung) passiert in SQL.

Zwei Dinge, die im Altprojekt fehlten und hier von Anfang an drin sind:
  - Die Größe wird beim Lesen geprüft, nicht danach. Eine zu große Datei wird
    abgebrochen, bevor sie im Speicher liegt.
  - Das Parsen läuft in einem Thread. pandas ist blockierend; im Altprojekt
    stand deshalb bei jedem großen Upload der ganze Prozess.

Jede Art ist in `REGISTRY` einmal beschrieben (Tabelle, Parser, Modus,
Schlüssel). Der manuelle Upload hier und der ODBC-Sync (`routers/odbc.py`)
teilen sich diese eine Beschreibung und `importieren()` — so bleiben beide
Wege deckungsgleich. Woher eine Zeile kam, hält `upload_batches.quelle` fest
(`upload` oder `odbc`).

Der Umschalter `plattform_einstellungen.datenquelle` entscheidet, welcher Weg
offen ist: steht er auf `odbc`, sperrt `importe_erlaubt` die manuellen Uploads
(409), und nur der ODBC-Sync füllt die Tabellen.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import Claims, require_app
from app.config import settings
from app.db import (
    SessionLocal,
    auftrag_positionen,
    auftraege,
    delivery_records,
    delivery_reliability,
    goods_receipt_records,
    inspection_records,
    interessenten,
    material_movements,
    material_prices,
    offers,
    plattform_einstellungen,
    quality_records,
    sales_contacts,
    stock_article_prices,
    revenues,
    upload_batches,
)
from app.parsing.aktivitaet import parse_angebote, parse_interessenten, parse_kontakte
from app.parsing.einkauf import parse_liefertreue
from app.parsing.lagerpreise import parse_lagerpreise
from app.parsing.material import parse_lagerbewegungen
from app.parsing.materialpreise import parse_materialpreise
from app.parsing.positionen import (
    parse_auftrag_positionen,
    parse_lieferscheine,
    parse_wareneingaenge,
)
from app.parsing.pruefungen import parse_pruefungen
from app.parsing.qualitaet import parse_8d
from app.parsing.vertrieb import parse_auftraege, parse_umsatz

# asyncpg erlaubt 32767 Parameter je Anweisung; danach wird gestückelt.
_MAX_PARAMS = 32767


class Fehlerdetail(BaseModel):
    row: int
    field: str
    message: str


class UploadErgebnis(BaseModel):
    batch_id: int
    filename: str
    kind: str
    rows_total: int
    rows_inserted: int
    rows_updated: int
    status: str
    errors: list[Fehlerdetail]


async def _read_limited(file: UploadFile) -> bytes:
    """Liest den Upload und bricht ab, sobald das Limit überschritten ist."""
    stücke: list[bytes] = []
    gesamt = 0
    while chunk := await file.read(64 * 1024):
        gesamt += len(chunk)
        if gesamt > settings.MAX_UPLOAD_BYTES:
            raise HTTPException(413, f"Datei überschreitet {settings.MAX_UPLOAD_BYTES // (1024 * 1024)} MB")
        stücke.append(chunk)
    return b"".join(stücke)


async def _upsert(
    session: AsyncSession,
    tabelle: sa.Table,
    rows: list[dict[str, Any]],
    schluessel: tuple[str, ...],
) -> None:
    """Zeilen einfügen oder aktualisieren, in Blöcken unterhalb des Parameterlimits."""
    if not rows:
        return
    # Spalten, die die Zeile nicht identifizieren, werden überschrieben.
    # `id` ist ausgenommen: eine Identitätsspalte vergibt die Datenbank.
    spalten = [
        c.name
        for c in tabelle.columns
        if c.name not in schluessel and c.name != "id" and c.name in rows[0]
    ]
    pro_zeile = max(1, len(rows[0]))
    block = max(1, _MAX_PARAMS // pro_zeile)
    for start in range(0, len(rows), block):
        teil = rows[start : start + block]
        stmt = pg_insert(tabelle).values(teil)
        await session.execute(
            stmt.on_conflict_do_update(
                index_elements=list(schluessel),
                set_={c: stmt.excluded[c] for c in spalten},
            )
        )


async def _import(
    *,
    file: UploadFile,
    kind: str,
    tabelle: sa.Table,
    parser: Callable[[bytes], tuple[list[dict[str, Any]], list[dict[str, Any]]]],
    hochgeladen_von: str | None,
    quelle: str = "upload",
    schluessel: tuple[str, ...] = ("vorgang_nr",),
    endungen: tuple[str, ...] = (".txt", ".csv"),
) -> UploadErgebnis:
    filename = file.filename or ""
    if not filename.lower().endswith(endungen):
        raise HTTPException(
            422, f"Nur {', '.join(endungen)}-Dateien werden angenommen."
        )

    contents = await _read_limited(file)
    rows, fehler = await run_in_threadpool(parser, contents)

    now = datetime.now(timezone.utc)
    status = "failed" if (fehler and not rows) else ("partial" if fehler else "success")

    async with SessionLocal() as session:
        async with session.begin():
            vorhanden = 0
            if rows:
                # Wie viele Zeilen es schon gibt, entscheidet über „neu" und
                # „aktualisiert" in der Rückmeldung. Bei einem zusammengesetzten
                # Schlüssel vergleicht Postgres das Tupel als Ganzes.
                spalten = [tabelle.c[k] for k in schluessel]
                werte = [tuple(r[k] for k in schluessel) for r in rows]
                bedingung = (
                    spalten[0].in_([w[0] for w in werte])
                    if len(schluessel) == 1
                    else sa.tuple_(*spalten).in_(werte)
                )
                vorhanden = (
                    await session.execute(
                        sa.select(sa.func.count()).select_from(tabelle).where(bedingung)
                    )
                ).scalar_one()

            batch_id = (
                await session.execute(
                    sa.insert(upload_batches)
                    .values(
                        filename=filename,
                        uploaded_at=now,
                        kind=kind,
                        row_count=len(rows),
                        error_count=len(fehler),
                        status=status,
                        uploaded_by=hochgeladen_von,
                        quelle=quelle,
                    )
                    .returning(upload_batches.c.id)
                )
            ).scalar_one()

            for r in rows:
                r["upload_batch_id"] = batch_id
                r["imported_at"] = now
            await _upsert(session, tabelle, rows, schluessel)

    return UploadErgebnis(
        batch_id=batch_id,
        filename=filename,
        kind=kind,
        rows_total=len(rows),
        rows_inserted=len(rows) - vorhanden,
        rows_updated=vorhanden,
        status=status,
        errors=[
            Fehlerdetail(row=f.get("row", 0), field=f.get("field", ""), message=f.get("message", ""))
            for f in fehler
        ],
    )


async def _import_ersetzend(
    *,
    file: UploadFile,
    kind: str,
    tabelle: sa.Table,
    parser: Callable[[bytes], tuple[list[dict[str, Any]], list[dict[str, Any]]]],
    hochgeladen_von: str | None,
    datumsspalte: str,
    quelle: str = "upload",
) -> UploadErgebnis:
    """Wie `_import`, aber ersetzend statt aktualisierend.

    Für Dateien ohne Geschäftsschlüssel: alle Zeilen im Datumsbereich der
    neuen Datei werden gelöscht, dann kommen die neuen. Der Bereich ergibt
    sich aus der Datei selbst, nicht aus einer Angabe des Nutzers — sonst
    löscht ein Tippfehler mehr als gewollt.
    """
    filename = file.filename or ""
    if not filename.lower().endswith((".txt", ".csv")):
        raise HTTPException(422, "Nur .txt- und .csv-Dateien werden angenommen.")

    contents = await _read_limited(file)
    rows, fehler = await run_in_threadpool(parser, contents)

    now = datetime.now(timezone.utc)
    status = "failed" if (fehler and not rows) else ("partial" if fehler else "success")
    spalte = tabelle.c[datumsspalte]

    async with SessionLocal() as session:
        async with session.begin():
            ersetzt = 0
            if rows:
                daten = [r[datumsspalte] for r in rows]
                von, bis = min(daten), max(daten)
                ersetzt = (
                    await session.execute(
                        sa.select(sa.func.count())
                        .select_from(tabelle)
                        .where(spalte.between(von, bis))
                    )
                ).scalar_one()
                await session.execute(sa.delete(tabelle).where(spalte.between(von, bis)))

            batch_id = (
                await session.execute(
                    sa.insert(upload_batches)
                    .values(
                        filename=filename,
                        uploaded_at=now,
                        kind=kind,
                        row_count=len(rows),
                        error_count=len(fehler),
                        status=status,
                        uploaded_by=hochgeladen_von,
                        quelle=quelle,
                    )
                    .returning(upload_batches.c.id)
                )
            ).scalar_one()

            for r in rows:
                r["upload_batch_id"] = batch_id
                r["imported_at"] = now
                # Nicht jede ersetzend geladene Tabelle kennt die Spalte.
                if "excluded" in tabelle.c:
                    r.setdefault("excluded", False)
            for start in range(0, len(rows), 1000):
                await session.execute(sa.insert(tabelle), rows[start : start + 1000])

    return UploadErgebnis(
        batch_id=batch_id,
        filename=filename,
        kind=kind,
        rows_total=len(rows),
        rows_inserted=len(rows),
        rows_updated=ersetzt,
        status=status,
        errors=[
            Fehlerdetail(row=f.get("row", 0), field=f.get("field", ""), message=f.get("message", ""))
            for f in fehler
        ],
    )


async def _import_ganz_ersetzen(
    *,
    file: UploadFile,
    kind: str,
    tabelle: sa.Table,
    parser: Callable[[bytes], tuple[list[dict[str, Any]], list[dict[str, Any]]]],
    hochgeladen_von: str | None,
    quelle: str = "upload",
) -> UploadErgebnis:
    """Stammdaten ohne Zeitraum: die Datei ist immer der ganze Bestand. Die
    Tabelle wird komplett ersetzt, nicht ergänzt — sonst blieben Zeilen für
    Schlüssel stehen, die es nicht mehr gibt. (Lagerpreise.)"""
    filename = file.filename or ""
    if not filename.lower().endswith((".txt", ".csv")):
        raise HTTPException(422, "Nur .txt- und .csv-Dateien werden angenommen.")

    contents = await _read_limited(file)
    rows, fehler = await run_in_threadpool(parser, contents)

    now = datetime.now(timezone.utc)
    status = "failed" if (fehler and not rows) else ("partial" if fehler else "success")

    async with SessionLocal() as session:
        async with session.begin():
            vorher = (
                await session.execute(sa.select(sa.func.count()).select_from(tabelle))
            ).scalar_one()
            batch_id = (
                await session.execute(
                    sa.insert(upload_batches)
                    .values(
                        filename=filename,
                        uploaded_at=now,
                        kind=kind,
                        row_count=len(rows),
                        error_count=len(fehler),
                        status=status,
                        uploaded_by=hochgeladen_von,
                        quelle=quelle,
                    )
                    .returning(upload_batches.c.id)
                )
            ).scalar_one()
            if rows:
                await session.execute(sa.delete(tabelle))
                for r in rows:
                    r["updated_at"] = now
                for start in range(0, len(rows), 1000):
                    await session.execute(sa.insert(tabelle), rows[start : start + 1000])

    return UploadErgebnis(
        batch_id=batch_id,
        filename=filename,
        kind=kind,
        rows_total=len(rows),
        rows_inserted=len(rows),
        rows_updated=vorher,
        status=status,
        errors=[
            Fehlerdetail(row=f.get("row", 0), field=f.get("field", ""), message=f.get("message", ""))
            for f in fehler
        ],
    )


@dataclass(frozen=True)
class ImportDef:
    """Eine Import-Art, einmal beschrieben für Upload und ODBC-Sync."""

    tabelle: sa.Table
    parser: Callable[[bytes], tuple[list[dict[str, Any]], list[dict[str, Any]]]]
    modus: str  # "upsert" | "ersetzend" | "ganz"
    schluessel: tuple[str, ...] = ("vorgang_nr",)
    datumsspalte: str | None = None
    endungen: tuple[str, ...] = (".txt", ".csv")


# Die Art eines Uploads ist zugleich sein Pfad. Beides getrennt zu pflegen ging
# einmal schief: die Route hiess `/auftrag-positionen`, die Oberfläche schickte
# `auftrag_positionen`, und der Upload endete in einem 404. Darum hier ein
# Wahrheitsort, den Upload-Routen und ODBC-Sync gemeinsam nutzen.
REGISTRY: dict[str, ImportDef] = {
    "umsatz": ImportDef(revenues, parse_umsatz, "upsert", ("vorgang_nr",)),
    "auftraege": ImportDef(auftraege, parse_auftraege, "upsert", ("vorgang_nr",)),
    "liefertreue": ImportDef(delivery_reliability, parse_liefertreue, "upsert", ("auftrag", "pos", "upos")),
    "auftragspositionen": ImportDef(auftrag_positionen, parse_auftrag_positionen, "upsert", ("vorgang_nr", "pos", "upos")),
    "lieferscheine": ImportDef(delivery_records, parse_lieferscheine, "upsert", ("vorgang_nr", "pos", "upos"), endungen=(".xlsx", ".xls")),
    "wareneingaenge": ImportDef(goods_receipt_records, parse_wareneingaenge, "upsert", ("vorgang_nr", "pos", "upos")),
    "acht_d": ImportDef(quality_records, parse_8d, "upsert", ("report_nr",)),
    "pruefungen": ImportDef(inspection_records, parse_pruefungen, "ersetzend", datumsspalte="pruef_datum"),
    "lagerbewegungen": ImportDef(material_movements, parse_lagerbewegungen, "ersetzend", datumsspalte="buch_datum"),
    "materialpreise": ImportDef(material_prices, parse_materialpreise, "upsert", ("vorgang_nr", "pos", "upos")),
    "lagerpreise": ImportDef(stock_article_prices, parse_lagerpreise, "ganz"),
    "kontakte": ImportDef(sales_contacts, parse_kontakte, "ersetzend", datumsspalte="contact_date"),
    "angebote": ImportDef(offers, parse_angebote, "upsert", ("vorgang_nr",)),
    "interessenten": ImportDef(interessenten, parse_interessenten, "upsert", ("adress_nr",)),
}

ARTEN = tuple(REGISTRY)


async def importieren(
    kind: str, file: UploadFile, hochgeladen_von: str | None, quelle: str
) -> UploadErgebnis:
    """Eine Datei nach den Regeln ihrer Art einlesen. Von Upload und ODBC-Sync genutzt."""
    d = REGISTRY[kind]
    if d.modus == "upsert":
        return await _import(
            file=file, kind=kind, tabelle=d.tabelle, parser=d.parser,
            hochgeladen_von=hochgeladen_von, quelle=quelle,
            schluessel=d.schluessel, endungen=d.endungen,
        )
    if d.modus == "ersetzend":
        assert d.datumsspalte is not None
        return await _import_ersetzend(
            file=file, kind=kind, tabelle=d.tabelle, parser=d.parser,
            hochgeladen_von=hochgeladen_von, quelle=quelle, datumsspalte=d.datumsspalte,
        )
    return await _import_ganz_ersetzen(
        file=file, kind=kind, tabelle=d.tabelle, parser=d.parser,
        hochgeladen_von=hochgeladen_von, quelle=quelle,
    )


async def datenquelle_lesen() -> str:
    """Aktueller Wert des Umschalters `plattform_einstellungen.datenquelle`."""
    async with SessionLocal() as session:
        return (
            await session.execute(sa.select(plattform_einstellungen.c.datenquelle))
        ).scalar_one()


async def importe_erlaubt() -> None:
    """Sperrt die manuellen Uploads, wenn die Datenquelle auf ODBC steht."""
    if (await datenquelle_lesen()) == "odbc":
        raise HTTPException(
            409, "Import deaktiviert: Datenquelle steht auf ODBC. Umschalten in den Einstellungen."
        )


router = APIRouter(
    prefix="/api/uploads",
    tags=["uploads"],
    dependencies=[Depends(require_app("uploads", "admin")), Depends(importe_erlaubt)],
)


@router.post("/umsatz", response_model=UploadErgebnis)
async def upload_umsatz(
    file: UploadFile, claims: Claims = Depends(require_app("uploads", "admin"))
) -> UploadErgebnis:
    """AswKpf_RG.txt — Rechnungen und Gutschriften. Erneutes Hochladen derselben
    Datei ändert nichts an den Daten (Upsert auf die Vorgangsnummer)."""
    return await importieren("umsatz", file, claims.sub, "upload")


@router.post("/auftraege", response_model=UploadErgebnis)
async def upload_auftraege(
    file: UploadFile, claims: Claims = Depends(require_app("uploads", "admin"))
) -> UploadErgebnis:
    """AswKpf_AUF.txt — Auftragseingang."""
    return await importieren("auftraege", file, claims.sub, "upload")


@router.post("/liefertreue", response_model=UploadErgebnis)
async def upload_liefertreue(
    file: UploadFile, claims: Claims = Depends(require_app("uploads", "admin"))
) -> UploadErgebnis:
    """dev_excel_Liefertreue_Einkauf.txt — Lieferpositionen der Lieferanten.

    Schlüssel ist die Position, nicht der Auftrag: ein Auftrag hat mehrere
    Positionen mit eigenen Terminen.
    """
    return await importieren("liefertreue", file, claims.sub, "upload")


@router.post("/auftragspositionen", response_model=UploadErgebnis)
async def upload_auftrag_positionen(
    file: UploadFile, claims: Claims = Depends(require_app("uploads", "admin"))
) -> UploadErgebnis:
    """AswKpf_AUF auf Positionsebene — trägt den Zieltermin je Position.

    Dieselbe Quelldatei wie der Auftragseingang, aber die Positionszeilen
    statt der Kopfzeilen. Der Zieltermin des Auftrags ist das späteste
    Lieferdatum seiner Positionen.
    """
    return await importieren("auftragspositionen", file, claims.sub, "upload")


@router.post("/lieferscheine", response_model=UploadErgebnis)
async def upload_lieferscheine(
    file: UploadFile, claims: Claims = Depends(require_app("uploads", "admin"))
) -> UploadErgebnis:
    """AswKpf_LS — Lieferscheinpositionen mit dem Ist-Lieferdatum."""
    return await importieren("lieferscheine", file, claims.sub, "upload")


@router.post("/wareneingaenge", response_model=UploadErgebnis)
async def upload_wareneingaenge(
    file: UploadFile, claims: Claims = Depends(require_app("uploads", "admin"))
) -> UploadErgebnis:
    """AswKpf_WE — Wareneingänge der Lieferanten.

    Bezugsgröße der Fehlerquote auf der Einkaufsseite. Die Warengruppe
    entscheidet, ob eine Zeile zu den Lieferanten oder zu den Werkbänken zählt.
    """
    return await importieren("wareneingaenge", file, claims.sub, "upload")


@router.post("/acht_d", response_model=UploadErgebnis)
async def upload_8d(
    file: UploadFile, claims: Claims = Depends(require_app("uploads", "admin"))
) -> UploadErgebnis:
    """8D.txt — Audit-Befunde und Reklamationen in einer Datei.

    Beide Sorten kommen mit; welche eine Kennzahl zählt, entscheidet der Code
    in `art` bei der Auswertung.
    """
    return await importieren("acht_d", file, claims.sub, "upload")


@router.post("/pruefungen", response_model=UploadErgebnis)
async def upload_pruefungen(
    file: UploadFile, claims: Claims = Depends(require_app("uploads", "admin"))
) -> UploadErgebnis:
    """AswQs2151.txt — Buchungen der Qualitätsprüfung.

    Kein Upsert, sondern Ersetzen: die Quelle hat keinen Geschäftsschlüssel,
    zwei gleiche Buchungszeilen sind erlaubt. Alle Zeilen im Datumsbereich der
    Datei werden vorher gelöscht. Von Hand gesetzte Ausschlüsse in diesem
    Bereich gehen dabei verloren; die Oberfläche sagt es vor dem Hochladen.
    """
    return await importieren("pruefungen", file, claims.sub, "upload")


@router.post("/lagerbewegungen", response_model=UploadErgebnis)
async def upload_lagerbewegungen(
    file: UploadFile, claims: Claims = Depends(require_app("uploads", "admin"))
) -> UploadErgebnis:
    """AswLagBew.txt — Lagerbewegungen.

    Ersetzend wie die Prüfbuchungen: eine Bewegung hat keinen
    Geschäftsschlüssel, dieselbe Entnahme kann zweimal in derselben Minute
    stehen.
    """
    return await importieren("lagerbewegungen", file, claims.sub, "upload")


@router.post("/materialpreise", response_model=UploadErgebnis)
async def upload_materialpreise(
    file: UploadFile, claims: Claims = Depends(require_app("uploads", "admin"))
) -> UploadErgebnis:
    """AswKpf_WE.txt — Materialpreise (Wareneingang), die Preisquelle der
    Materialkostenquote.

    Dieselbe Datei wie der Wareneingang, aber ein eigener Import wie im
    Altsystem: welcher Preisstand gilt, entscheidet dieser Upload. Upsert auf
    die Position — was in der Datei fehlt, bleibt stehen.
    """
    return await importieren("materialpreise", file, claims.sub, "upload")


@router.post("/lagerpreise", response_model=UploadErgebnis)
async def upload_lagerpreise(
    file: UploadFile, claims: Claims = Depends(require_app("uploads", "admin"))
) -> UploadErgebnis:
    """Artikel-Preiskonditionen für die Lagerbewertung.

    Stammdaten, kein Zeitraum: die Datei ist immer der ganze Bestand. Die
    Tabelle wird deshalb komplett ersetzt, nicht ergänzt.
    """
    return await importieren("lagerpreise", file, claims.sub, "upload")


@router.post("/kontakte", response_model=UploadErgebnis)
async def upload_kontakte(
    file: UploadFile, claims: Claims = Depends(require_app("uploads", "admin"))
) -> UploadErgebnis:
    """Kontaktprotokoll des Vertriebs — Erstkontakte, Besuche vor Ort und online.

    Ersetzend statt aktualisierend: die Datei hat keinen Geschäftsschlüssel,
    eine Zeile ist ein Ereignis. Alles im Datumsbereich der neuen Datei wird
    ersetzt, damit ein zweiter Upload desselben Zeitraums die Zahlen nicht
    verdoppelt.
    """
    return await importieren("kontakte", file, claims.sub, "upload")


@router.post("/angebote", response_model=UploadErgebnis)
async def upload_angebote(
    file: UploadFile, claims: Claims = Depends(require_app("uploads", "admin"))
) -> UploadErgebnis:
    """AswKpf_ANG.txt — geschriebene Angebote mit Wert und Erfasser."""
    return await importieren("angebote", file, claims.sub, "upload")


@router.post("/interessenten", response_model=UploadErgebnis)
async def upload_interessenten(
    file: UploadFile, claims: Claims = Depends(require_app("uploads", "admin"))
) -> UploadErgebnis:
    """dev_excel_INT.txt — Stammdaten der Interessenten.

    Aktualisierend auf die Adressnummer: die Datei ist eine Momentaufnahme.
    """
    return await importieren("interessenten", file, claims.sub, "upload")
