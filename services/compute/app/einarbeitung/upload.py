"""Zentraler Stapel-Upload der unterschriebenen Einarbeitungsbögen.

Viele Scans auf einmal: je Blatt wird der **QR** gelesen, der Vorgang über die
Kennung gefunden, der Scan als Nachweis abgelegt und der Vorgang auf **geprüft**
(abgeschlossen) gesetzt. Ein Blatt ohne lesbaren QR oder ohne passenden Vorgang
kommt in die Liste „nicht zugeordnet" — es wird dann von Hand einer Person
zugeordnet (`manuell_abschliessen`), etwa Altbestände.

Das ist der Rückweg zu `serie.erzeuge_bereich`: dort entsteht der Vorgang mit
QR, hier kommt der unterschriebene Bogen wieder herein.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, datetime, timezone

import sqlalchemy as sa

from app.db import SessionLocal, dokumentvorgaenge, personio_employees
from app.dokumente import pruefung, speicher, vorgang

log = logging.getLogger(__name__)


@dataclass
class Zugeordnet:
    dateiname: str
    status: str  # 'zugeordnet' | 'nicht_zugeordnet' | 'schon_geprueft' | 'fehler'
    doc_uid: str | None = None
    name: str | None = None
    vollstaendig: bool | None = None
    vorgang_id: str | None = None
    meldung: str | None = None


async def _vorgang_per_kennung(doc_uid: str):
    async with SessionLocal() as sitzung:
        return (
            await sitzung.execute(
                sa.select(dokumentvorgaenge).where(dokumentvorgaenge.c.doc_uid == doc_uid)
            )
        ).mappings().one_or_none()


async def _scan_ablegen_und_pruefen(zeile, daten: bytes, endung: str, typ: str) -> dict:
    """Scan rastern, gegen das Blanko prüfen, ablegen, Vorgang auf geprüft setzen.

    Dieselbe Mechanik wie der Einzel-Scan in `routers/dokumente.py`."""
    bild = await pruefung.rastern(daten, ist_pdf=endung == "pdf")
    blanko = None
    if zeile["pdf_pfad"]:
        try:
            blanko = await pruefung.rastern(await speicher.holen(zeile["pdf_pfad"]), ist_pdf=True)
        except (speicher.SpeicherFehler, pruefung.ScanFehlgeschlagen):
            log.warning("Stapel-Scan ohne Blanko-Vergleich: Blatt fehlt im Speicher")
    ergebnis = pruefung.felder_pruefen(bild, zeile["feld_layout"], blanko)

    pfad = await speicher.ablegen(vorgang.pfad_scan(zeile["doc_uid"], endung), daten, typ)
    jetzt = datetime.now(timezone.utc)
    werte = {
        "scan_pfad": pfad,
        "pruef_ergebnis": ergebnis,
        "vollstaendig": ergebnis["vollstaendig"],
        "geprueft_am": jetzt,
        "status": "geprueft",
    }
    if zeile["uebergeben_am"] is None:
        werte["uebergeben_am"] = zeile["erstellt_am"]
    if zeile["zurueck_am"] is None:
        werte["zurueck_am"] = jetzt
    async with SessionLocal() as sitzung:
        async with sitzung.begin():
            await sitzung.execute(
                dokumentvorgaenge.update()
                .where(dokumentvorgaenge.c.id == zeile["id"])
                .values(**werte)
            )
    return ergebnis


async def ein_blatt(dateiname: str, daten: bytes, endung: str, typ: str) -> Zugeordnet:
    """Ein hochgeladenes Blatt verarbeiten — QR lesen, zuordnen, abschließen."""
    try:
        bild = await pruefung.rastern(daten, ist_pdf=endung == "pdf")
    except pruefung.ScanFehlgeschlagen as fehler:
        return Zugeordnet(dateiname, "fehler", meldung=str(fehler))

    treffer = pruefung.qr_lesen(bild)
    if treffer is None:
        return Zugeordnet(dateiname, "nicht_zugeordnet", meldung="Kein QR erkannt")

    zeile = await _vorgang_per_kennung(treffer.doc_uid)
    if zeile is None:
        return Zugeordnet(dateiname, "nicht_zugeordnet", doc_uid=treffer.doc_uid,
                          meldung="Keine Kennung im System")
    if zeile["status"] == "geprueft" and zeile["scan_pfad"]:
        return Zugeordnet(dateiname, "schon_geprueft", doc_uid=treffer.doc_uid,
                          name=zeile["name"], vorgang_id=str(zeile["id"]))
    if not zeile["feld_layout"]:
        return Zugeordnet(dateiname, "fehler", doc_uid=treffer.doc_uid, name=zeile["name"],
                          meldung="Vorgang ohne Feldliste")

    ergebnis = await _scan_ablegen_und_pruefen(zeile, daten, endung, typ)
    return Zugeordnet(
        dateiname, "zugeordnet", doc_uid=treffer.doc_uid, name=zeile["name"],
        vollstaendig=ergebnis["vollstaendig"], vorgang_id=str(zeile["id"]),
    )


async def manuell_abschliessen(
    employee_id: int, daten: bytes, endung: str, typ: str, beginn: date | None = None
) -> Zugeordnet:
    """Einen Altbestand ohne passenden Vorgang übernehmen: Vorgang für die Person
    anlegen und direkt als geprüft (abgeschlossen) mit dem Scan ablegen."""
    async with SessionLocal() as sitzung:
        person = (
            await sitzung.execute(
                sa.select(personio_employees.c.first_name, personio_employees.c.last_name,
                          personio_employees.c.hire_date)
                .where(personio_employees.c.id == employee_id)
            )
        ).mappings().one_or_none()
    if person is None:
        return Zugeordnet("", "fehler", meldung="Diese Person gibt es nicht.")
    name = f"{person['first_name'] or ''} {person['last_name'] or ''}".strip()

    doc_uid = vorgang.neue_kennung()
    pfad = await speicher.ablegen(vorgang.pfad_scan(doc_uid, endung), daten, typ)
    jetzt = datetime.now(timezone.utc)
    async with SessionLocal() as sitzung:
        async with sitzung.begin():
            zeile = (
                await sitzung.execute(
                    dokumentvorgaenge.insert().values(
                        art="einarbeitung", doc_uid=doc_uid, employee_id=employee_id, name=name,
                        beginn=beginn or person["hire_date"], scan_pfad=pfad,
                        status="geprueft", vollstaendig=True,
                        erstellt_am=jetzt, uebergeben_am=jetzt, zurueck_am=jetzt, geprueft_am=jetzt,
                    ).returning(dokumentvorgaenge.c.id)
                )
            ).scalar_one()
    return Zugeordnet("", "zugeordnet", doc_uid=doc_uid, name=name, vollstaendig=True,
                      vorgang_id=str(zeile))
