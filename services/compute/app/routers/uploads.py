"""Datei-Uploads der ERP-Exporte.

Das ist der Teil, der in Python bleiben muss: die Exporte haben deutsche
Zahlen, Latin-1-Kodierung und Eigenheiten je Datei, die pandas abfängt.
Alles danach (Auswertung) passiert in SQL.

Zwei Dinge, die im Altprojekt fehlten und hier von Anfang an drin sind:
  - Die Größe wird beim Lesen geprüft, nicht danach. Eine zu große Datei wird
    abgebrochen, bevor sie im Speicher liegt.
  - Das Parsen läuft in einem Thread. pandas ist blockierend; im Altprojekt
    stand deshalb bei jedem großen Upload der ganze Prozess.
"""
from __future__ import annotations

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
    material_movements,
    quality_records,
    stock_article_prices,
    revenues,
    upload_batches,
)
from app.parsing.einkauf import parse_liefertreue
from app.parsing.lagerpreise import parse_lagerpreise
from app.parsing.material import parse_lagerbewegungen
from app.parsing.positionen import (
    parse_auftrag_positionen,
    parse_lieferscheine,
    parse_wareneingaenge,
)
from app.parsing.pruefungen import parse_pruefungen
from app.parsing.qualitaet import parse_8d
from app.parsing.vertrieb import parse_auftraege, parse_umsatz

router = APIRouter(prefix="/api/uploads", tags=["uploads"], dependencies=[Depends(require_app("uploads", "admin"))])

# asyncpg erlaubt 32767 Parameter je Anweisung; danach wird gestückelt.
_MAX_PARAMS = 32767

# Die Art eines Uploads ist zugleich sein Pfad. Beides getrennt zu pflegen ging
# einmal schief: die Route hiess `/auftrag-positionen`, die Oberfläche schickte
# `auftrag_positionen`, und der Upload endete in einem 404.
ARTEN = (
    "umsatz",
    "auftraege",
    "liefertreue",
    "auftragspositionen",
    "lieferscheine",
    "wareneingaenge",
    "acht_d",
    "pruefungen",
    "lagerbewegungen",
    "lagerpreise",
)


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
    claims: Claims,
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
                        uploaded_by=claims.sub,
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
    claims: Claims,
    datumsspalte: str,
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
                        uploaded_by=claims.sub,
                    )
                    .returning(upload_batches.c.id)
                )
            ).scalar_one()

            for r in rows:
                r["upload_batch_id"] = batch_id
                r["imported_at"] = now
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


@router.post("/umsatz", response_model=UploadErgebnis)
async def upload_umsatz(
    file: UploadFile,
    claims: Claims = Depends(require_app("uploads", "admin")),
) -> UploadErgebnis:
    """AswKpf_RG.txt — Rechnungen und Gutschriften. Erneutes Hochladen derselben
    Datei ändert nichts an den Daten (Upsert auf die Vorgangsnummer)."""
    return await _import(file=file, kind="umsatz", tabelle=revenues, parser=parse_umsatz, claims=claims)


@router.post("/auftraege", response_model=UploadErgebnis)
async def upload_auftraege(
    file: UploadFile,
    claims: Claims = Depends(require_app("uploads", "admin")),
) -> UploadErgebnis:
    """AswKpf_AUF.txt — Auftragseingang."""
    return await _import(file=file, kind="auftraege", tabelle=auftraege, parser=parse_auftraege, claims=claims)


@router.post("/liefertreue", response_model=UploadErgebnis)
async def upload_liefertreue(
    file: UploadFile,
    claims: Claims = Depends(require_app("uploads", "admin")),
) -> UploadErgebnis:
    """dev_excel_Liefertreue_Einkauf.txt — Lieferpositionen der Lieferanten.

    Schlüssel ist die Position, nicht der Auftrag: ein Auftrag hat mehrere
    Positionen mit eigenen Terminen.
    """
    return await _import(
        file=file,
        kind="liefertreue",
        tabelle=delivery_reliability,
        parser=parse_liefertreue,
        claims=claims,
        schluessel=("auftrag", "pos", "upos"),
    )


@router.post("/auftragspositionen", response_model=UploadErgebnis)
async def upload_auftrag_positionen(
    file: UploadFile,
    claims: Claims = Depends(require_app("uploads", "admin")),
) -> UploadErgebnis:
    """AswKpf_AUF auf Positionsebene — trägt den Zieltermin je Position.

    Dieselbe Quelldatei wie der Auftragseingang, aber die Positionszeilen
    statt der Kopfzeilen. Der Zieltermin des Auftrags ist das späteste
    Lieferdatum seiner Positionen.
    """
    return await _import(
        file=file,
        kind="auftragspositionen",
        tabelle=auftrag_positionen,
        parser=parse_auftrag_positionen,
        claims=claims,
        schluessel=("vorgang_nr", "pos", "upos"),
    )


@router.post("/lieferscheine", response_model=UploadErgebnis)
async def upload_lieferscheine(
    file: UploadFile,
    claims: Claims = Depends(require_app("uploads", "admin")),
) -> UploadErgebnis:
    """AswKpf_LS — Lieferscheinpositionen mit dem Ist-Lieferdatum."""
    return await _import(
        file=file,
        kind="lieferscheine",
        tabelle=delivery_records,
        parser=parse_lieferscheine,
        claims=claims,
        schluessel=("vorgang_nr", "pos", "upos"),
        endungen=(".xlsx", ".xls"),
    )


@router.post("/acht_d", response_model=UploadErgebnis)
async def upload_8d(
    file: UploadFile,
    claims: Claims = Depends(require_app("uploads", "admin")),
) -> UploadErgebnis:
    """8D.txt — Audit-Befunde und Reklamationen in einer Datei.

    Beide Sorten kommen mit; welche eine Kennzahl zählt, entscheidet der Code
    in `art` bei der Auswertung.
    """
    return await _import(
        file=file,
        kind="acht_d",
        tabelle=quality_records,
        parser=parse_8d,
        claims=claims,
        schluessel=("report_nr",),
    )


@router.post("/wareneingaenge", response_model=UploadErgebnis)
async def upload_wareneingaenge(
    file: UploadFile,
    claims: Claims = Depends(require_app("uploads", "admin")),
) -> UploadErgebnis:
    """AswKpf_WE — Wareneingänge der Lieferanten.

    Bezugsgröße der Fehlerquote auf der Einkaufsseite. Die Warengruppe
    entscheidet, ob eine Zeile zu den Lieferanten oder zu den Werkbänken
    zählt.
    """
    return await _import(
        file=file,
        kind="wareneingaenge",
        tabelle=goods_receipt_records,
        parser=parse_wareneingaenge,
        claims=claims,
        schluessel=("vorgang_nr", "pos", "upos"),
    )


@router.post("/pruefungen", response_model=UploadErgebnis)
async def upload_pruefungen(
    file: UploadFile,
    claims: Claims = Depends(require_app("uploads", "admin")),
) -> UploadErgebnis:
    """AswQs2151.txt — Buchungen der Qualitätsprüfung.

    Kein Upsert, sondern Ersetzen: die Quelle hat keinen Geschäftsschlüssel,
    zwei gleiche Buchungszeilen sind erlaubt. Alle Zeilen im Datumsbereich der
    Datei werden vorher gelöscht.

    Von Hand gesetzte Ausschlüsse in diesem Bereich gehen dabei verloren. Ohne
    Schlüssel lässt sich das nicht sauber vermeiden; die Oberfläche sagt es
    vor dem Hochladen.
    """
    return await _import_ersetzend(
        file=file,
        kind="pruefungen",
        tabelle=inspection_records,
        parser=parse_pruefungen,
        claims=claims,
        datumsspalte="pruef_datum",
    )


@router.post("/lagerbewegungen", response_model=UploadErgebnis)
async def upload_lagerbewegungen(
    file: UploadFile,
    claims: Claims = Depends(require_app("uploads", "admin")),
) -> UploadErgebnis:
    """AswLagBew.txt — Lagerbewegungen.

    Ersetzend wie die Prüfbuchungen: eine Bewegung hat keinen
    Geschäftsschlüssel, dieselbe Entnahme kann zweimal in derselben Minute
    stehen.
    """
    return await _import_ersetzend(
        file=file,
        kind="lagerbewegungen",
        tabelle=material_movements,
        parser=parse_lagerbewegungen,
        claims=claims,
        datumsspalte="buch_datum",
    )


@router.post("/lagerpreise", response_model=UploadErgebnis)
async def upload_lagerpreise(
    file: UploadFile,
    claims: Claims = Depends(require_app("uploads", "admin")),
) -> UploadErgebnis:
    """Artikel-Preiskonditionen für die Lagerbewertung.

    Stammdaten, kein Zeitraum: die Datei ist immer der ganze Bestand. Die
    Tabelle wird deshalb komplett ersetzt, nicht ergänzt — sonst blieben
    Preise für Artikel stehen, die es nicht mehr gibt.
    """
    filename = file.filename or ""
    if not filename.lower().endswith((".txt", ".csv")):
        raise HTTPException(422, "Nur .txt- und .csv-Dateien werden angenommen.")

    contents = await _read_limited(file)
    rows, fehler = await run_in_threadpool(parse_lagerpreise, contents)

    now = datetime.now(timezone.utc)
    status = "failed" if (fehler and not rows) else ("partial" if fehler else "success")

    async with SessionLocal() as session:
        async with session.begin():
            vorher = (
                await session.execute(
                    sa.select(sa.func.count()).select_from(stock_article_prices)
                )
            ).scalar_one()
            batch_id = (
                await session.execute(
                    sa.insert(upload_batches)
                    .values(
                        filename=filename,
                        uploaded_at=now,
                        kind="lagerpreise",
                        row_count=len(rows),
                        error_count=len(fehler),
                        status=status,
                        uploaded_by=claims.sub,
                    )
                    .returning(upload_batches.c.id)
                )
            ).scalar_one()
            if rows:
                await session.execute(sa.delete(stock_article_prices))
                for r in rows:
                    r["updated_at"] = now
                for start in range(0, len(rows), 1000):
                    await session.execute(
                        sa.insert(stock_article_prices), rows[start : start + 1000]
                    )

    return UploadErgebnis(
        batch_id=batch_id,
        filename=filename,
        kind="lagerpreise",
        rows_total=len(rows),
        rows_inserted=len(rows),
        rows_updated=vorher,
        status=status,
        errors=[
            Fehlerdetail(row=f.get("row", 0), field=f.get("field", ""), message=f.get("message", ""))
            for f in fehler
        ],
    )
