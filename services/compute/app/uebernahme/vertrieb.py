"""Vertriebsdaten aus lumeapps übernehmen.

Die Tabellen haben in beiden Projekten dieselbe Form — der neue Strang ist
eine getreue Portierung. Zwei Dinge weichen ab und werden hier abgebildet:

* `upload_batches.kind` hieß im Altprojekt `revenues`, jetzt `umsatz`.
* `upload_batches.uploaded_by` ist neu und bleibt bei übernommenen Zeilen
  leer: die alte Tabelle weiß nicht, wer hochgeladen hat.

Die alten Schlüssel werden **nicht** übernommen. `upload_batches.id` vergibt
die neue Tabelle selbst (`generated always as identity`), und die alten Zahlen
haben im neuen System keine Bedeutung. Stattdessen wird jedes Protokoll neu
eingefügt und die Zuordnung alt → neu auf die Zeilen übertragen.

Wiederholbar ist der Lauf über einen natürlichen Schlüssel: ein Protokoll mit
gleichem Dateinamen, gleichem Zeitpunkt und gleicher Sorte gilt als dasselbe
und wird wiederverwendet statt doppelt angelegt.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.db import SessionLocal, auftraege, revenues, upload_batches

# Nur diese beiden Sorten haben im neuen Stack eine Entsprechung. Alles andere
# (Kontakte, Qualität, Material …) kommt mit dem jeweiligen Modul.
KIND_ABBILDUNG = {"revenues": "umsatz", "auftraege": "auftraege"}
ERLAUBTE_STATUS = {"success", "partial", "failed"}


@dataclass
class Bericht:
    batches: int = 0
    umsaetze: int = 0
    auftraege: int = 0
    uebersprungene_batches: list[str] = field(default_factory=list)

    def zeilen(self) -> list[str]:
        z = [
            f"Upload-Protokolle: {self.batches}",
            f"Rechnungen und Gutschriften: {self.umsaetze}",
            f"Aufträge: {self.auftraege}",
        ]
        if self.uebersprungene_batches:
            z.append(
                "Übersprungene Protokolle (Sorte hat im neuen Stack noch kein Zuhause): "
                + ", ".join(sorted(set(self.uebersprungene_batches)))
            )
        return z


def aufbereiten(alte_batches: list[dict]) -> tuple[list[dict], list[str]]:
    """Alte Protokollzeilen auf die neue Form bringen.

    Ohne Datenbank, damit die beiden Abbildungen — Sorte und Status — für sich
    prüfbar bleiben. Gibt die übernehmbaren Zeilen zurück und die Sorten, die
    im neuen Stack noch kein Zuhause haben.
    """
    batches: list[dict] = []
    uebersprungen: list[str] = []
    for b in alte_batches:
        neue_sorte = KIND_ABBILDUNG.get(b["kind"])
        if neue_sorte is None:
            uebersprungen.append(b["kind"])
            continue
        batches.append(
            {
                "alt_id": b["id"],
                "filename": b["filename"],
                "uploaded_at": b["uploaded_at"],
                "kind": neue_sorte,
                "row_count": b["row_count"],
                "error_count": b["error_count"],
                # Ein unbekannter Status wäre eine stille Lüge; lieber deutlich.
                "status": b["status"] if b["status"] in ERLAUBTE_STATUS else "failed",
                "uploaded_by": None,
            }
        )
    return batches, uebersprungen


def _lies(quelle: sa.engine.Engine, sql: str) -> list[dict]:
    """Die alte Datenbank wird synchron gelesen — ein Lauf, kein Nebenläufigkeitsbedarf."""
    with quelle.connect() as conn:
        return [dict(r) for r in conn.execute(sa.text(sql)).mappings()]


async def uebernehmen(quelle: sa.engine.Engine, trocken: bool = False) -> Bericht:
    bericht = Bericht()

    alte_batches = _lies(
        quelle,
        "select id, filename, uploaded_at, kind, row_count, error_count, status"
        " from public.upload_batches order by id",
    )
    batches, bericht.uebersprungene_batches = aufbereiten(alte_batches)

    alte_ids = {b["alt_id"] for b in batches}
    spalten_um = "vorgang_nr, typ, datum, adr_nr, customer_name, wert_eur, upload_batch_id, imported_at, raw"
    spalten_auf = (
        "vorgang_nr, typ, datum, adr_nr, customer_name, erfasser, wert_eur,"
        " upload_batch_id, imported_at, raw"
    )
    alte_umsaetze = _lies(quelle, f"select {spalten_um} from public.revenues")
    alte_auftraege = _lies(quelle, f"select {spalten_auf} from public.auftraege")

    bericht.batches = len(batches)
    bericht.umsaetze = len(alte_umsaetze)
    bericht.auftraege = len(alte_auftraege)

    if trocken:
        return bericht

    async with SessionLocal() as session:
        async with session.begin():
            abbildung: dict[int, int] = {}
            for b in batches:
                alt_id = b.pop("alt_id")
                abbildung[alt_id] = await _protokoll_id(session, b)

            # Zeilen, deren Protokoll nicht mitkommt, verlieren nur den Verweis —
            # die Zeile selbst ist die Nutzlast und bleibt.
            for zeile in (*alte_umsaetze, *alte_auftraege):
                alt = zeile["upload_batch_id"]
                zeile["upload_batch_id"] = abbildung.get(alt) if alt in alte_ids else None

            for tabelle, zeilen in ((revenues, alte_umsaetze), (auftraege, alte_auftraege)):
                for stueck in _stuecke(zeilen):
                    await session.execute(
                        pg_insert(tabelle)
                        .values(stueck)
                        .on_conflict_do_nothing(index_elements=["vorgang_nr"])
                    )
    return bericht


async def _protokoll_id(session, protokoll: dict) -> int:
    """Id des Protokolls in der neuen Datenbank — vorhandenes oder neues.

    Ohne diese Suche legte ein zweiter Lauf jedes Protokoll erneut an. Einen
    Unique-Index dafür gibt es bewusst nicht: er wäre nur für die Übernahme da
    und würde echte Uploads mit gleichem Namen und Zeitpunkt verbieten.
    """
    vorhanden = await session.scalar(
        sa.select(upload_batches.c.id).where(
            upload_batches.c.filename == protokoll["filename"],
            upload_batches.c.uploaded_at == protokoll["uploaded_at"],
            upload_batches.c.kind == protokoll["kind"],
        )
    )
    if vorhanden is not None:
        return int(vorhanden)
    neu = await session.scalar(
        sa.insert(upload_batches).values(protokoll).returning(upload_batches.c.id)
    )
    return int(neu)


def _stuecke(zeilen: list[dict], groesse: int = 1000):
    """asyncpg erlaubt 32767 Parameter je Anweisung — in Stücken einfügen."""
    for i in range(0, len(zeilen), groesse):
        yield zeilen[i : i + groesse]
