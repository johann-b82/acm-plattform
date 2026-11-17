"""Eine Interviewdatei übernehmen — erst zeigen, dann schreiben.

Anders als die alte Matrix-Übernahme wird **nicht ersetzt, sondern ergänzt**:
die Interviews sind einzeln validiert, ein zweiter Import darf schon Erfasstes
nicht wegwerfen. Deshalb:

* Der Bereich wird über den Namen gefunden oder angelegt.
* Aufgabenfamilien werden angelegt oder in Beschreibung und Reihenfolge
  aktualisiert; eine Familie, die im Blatt fehlt, bleibt stehen (die Vorschau
  nennt sie, gelöscht wird in der Oberfläche).
* Je zugeordneter Person werden das Ist je Familie und die Interviewfelder
  geschrieben (das persönliche Ziel `soll_stufe` bleibt unberührt).
* Ein Name ohne Personio-Treffer wird **nicht** geschrieben, sondern in der
  Vorschau aufgelistet.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.db import (
    SessionLocal,
    kompetenz_bereiche,
    kompetenz_bewertungen,
    kompetenz_familien,
    kompetenz_interview,
    personio_employees,
)
from app.kompetenzen.namen import PLATZHALTER, baue_index, finde_person, normalisiere
from app.parsing.interview import Blatt, Datei


@dataclass
class BlattVorschau:
    bereich: str
    bereich_neu: bool
    familien: int
    familien_neu: list[str]
    familien_entfallen: list[str]
    personen: int
    zugeordnet: int
    nicht_zugeordnet: list[str]


@dataclass
class Vorschau:
    dateiname: str
    blaetter: list[BlattVorschau] = field(default_factory=list)
    hinweise: list[str] = field(default_factory=list)


async def _index():
    async with SessionLocal() as sitzung:
        zeilen = (
            await sitzung.execute(
                sa.select(personio_employees).where(personio_employees.c.status == "active")
            )
        ).all()
    return baue_index(zeilen)


def _zuordnung(blatt: Blatt, exakt, teile) -> tuple[list[int | None], list[str]]:
    zuordnung: list[int | None] = []
    offen: list[str] = []
    for person in blatt.personen:
        if normalisiere(person.name) in PLATZHALTER:
            zuordnung.append(None)
            continue
        treffer = finde_person(person.name, exakt, teile)
        zuordnung.append(treffer)
        if treffer is None:
            offen.append(person.name)
    return zuordnung, offen


async def _bestehende_familien(sitzung, bereich_id) -> dict[str, str]:
    if bereich_id is None:
        return {}
    zeilen = (
        await sitzung.execute(
            sa.select(kompetenz_familien.c.name, kompetenz_familien.c.id).where(
                kompetenz_familien.c.bereich_id == bereich_id
            )
        )
    ).all()
    return {name: fid for name, fid in zeilen}


async def _bereich_id(sitzung, name: str):
    return (
        await sitzung.execute(
            sa.select(kompetenz_bereiche.c.id).where(kompetenz_bereiche.c.name == name)
        )
    ).scalar_one_or_none()


async def _blatt_vorschau(sitzung, blatt: Blatt, offen: list[str], zugeordnet: int) -> BlattVorschau:
    bereich_id = await _bereich_id(sitzung, blatt.bereich)
    bestehend = set((await _bestehende_familien(sitzung, bereich_id)).keys())
    im_blatt = {f.name for f in blatt.familien}
    return BlattVorschau(
        bereich=blatt.bereich,
        bereich_neu=bereich_id is None,
        familien=len(blatt.familien),
        familien_neu=sorted(im_blatt - bestehend),
        familien_entfallen=sorted(bestehend - im_blatt),
        personen=len(blatt.personen),
        zugeordnet=zugeordnet,
        nicht_zugeordnet=offen,
    )


async def vorschau(datei: Datei) -> Vorschau:
    exakt, teile = await _index()
    ergebnis = Vorschau(dateiname=datei.dateiname, hinweise=list(datei.hinweise))
    async with SessionLocal() as sitzung:
        for blatt in datei.blaetter:
            zuordnung, offen = _zuordnung(blatt, exakt, teile)
            zugeordnet = sum(1 for z in zuordnung if z is not None)
            ergebnis.blaetter.append(await _blatt_vorschau(sitzung, blatt, offen, zugeordnet))
    return ergebnis


async def uebernehmen(datei: Datei) -> Vorschau:
    """Ergänzend schreiben, alles in einer Transaktion."""
    exakt, teile = await _index()
    ergebnis = Vorschau(dateiname=datei.dateiname, hinweise=list(datei.hinweise))
    jetzt = datetime.now(timezone.utc)

    async with SessionLocal() as sitzung:
        async with sitzung.begin():
            for blatt in datei.blaetter:
                zuordnung, offen = _zuordnung(blatt, exakt, teile)
                zugeordnet = sum(1 for z in zuordnung if z is not None)
                ergebnis.blaetter.append(await _blatt_vorschau(sitzung, blatt, offen, zugeordnet))

                bereich_id = await _bereich_id(sitzung, blatt.bereich)
                if bereich_id is None:
                    naechste = (
                        await sitzung.execute(
                            sa.select(sa.func.coalesce(sa.func.max(kompetenz_bereiche.c.reihenfolge), 0) + 1)
                        )
                    ).scalar_one()
                    bereich_id = (
                        await sitzung.execute(
                            sa.insert(kompetenz_bereiche)
                            .values(name=blatt.bereich, reihenfolge=naechste)
                            .returning(kompetenz_bereiche.c.id)
                        )
                    ).scalar_one()

                # Familien anlegen oder aktualisieren; Reihenfolge aus dem Blatt.
                familie_ids: dict[str, object] = await _bestehende_familien(sitzung, bereich_id)
                for reihe, fam in enumerate(blatt.familien):
                    if fam.name in familie_ids:
                        await sitzung.execute(
                            sa.update(kompetenz_familien)
                            .where(kompetenz_familien.c.id == familie_ids[fam.name])
                            .values(beschreibung=fam.beschreibung, reihenfolge=reihe)
                        )
                    else:
                        familie_ids[fam.name] = (
                            await sitzung.execute(
                                sa.insert(kompetenz_familien)
                                .values(
                                    bereich_id=bereich_id,
                                    name=fam.name,
                                    beschreibung=fam.beschreibung,
                                    reihenfolge=reihe,
                                )
                                .returning(kompetenz_familien.c.id)
                            )
                        ).scalar_one()

                # Je zugeordneter Person: Interviewfelder und Ist-Stufen.
                for person, employee_id in zip(blatt.personen, zuordnung):
                    if employee_id is None:
                        continue
                    await sitzung.execute(
                        pg_insert(kompetenz_interview)
                        .values(
                            employee_id=employee_id,
                            bereich_id=bereich_id,
                            produkte=person.produkte,
                            weitere_bereiche=person.weitere_bereiche,
                            engpass=person.engpass,
                            validiert_durch=person.validiert_durch,
                            validiert_am=person.validiert_am,
                            notiz=person.notiz,
                        )
                        .on_conflict_do_update(
                            index_elements=["employee_id", "bereich_id"],
                            set_={
                                "produkte": person.produkte,
                                "weitere_bereiche": person.weitere_bereiche,
                                "engpass": person.engpass,
                                "validiert_durch": person.validiert_durch,
                                "validiert_am": person.validiert_am,
                                "notiz": person.notiz,
                            },
                        )
                    )
                    for fam_name, stufe in person.stufen.items():
                        await sitzung.execute(
                            pg_insert(kompetenz_bewertungen)
                            .values(
                                familie_id=familie_ids[fam_name],
                                employee_id=employee_id,
                                ist_stufe=stufe,
                                geaendert_am=jetzt,
                            )
                            .on_conflict_do_update(
                                index_elements=["familie_id", "employee_id"],
                                set_={"ist_stufe": stufe, "geaendert_am": jetzt},
                            )
                        )
    return ergebnis
