"""Die Schulungsübersicht übernehmen — erst zeigen, dann schreiben.

Die Excel kennt Mitarbeiter über die **Personalnummer**. In Personio liegt sie
in einem Freifeld; gesucht wird über dessen **Beschriftung**, nicht über die
Feld-Kennung — die ist je Personio-Instanz eine andere, und ein Import darf
nicht daran zerbrechen, dass jemand ein Feld neu anlegt.

Zeilen ohne Treffer werden **nicht verworfen**. Sie landen mit Personalnummer
und Namen in der Datenbank und stehen in der Vorschau als solche. Sonst
verschwände Historie, nur weil eine Nummer in Personio nicht gepflegt ist.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.db import (
    SessionLocal,
    personio_employees,
    schulung_importe,
    schulung_katalog,
    schulung_teilnahmen,
)
from app.parsing.schulungsuebersicht import Uebersicht

#: Beschriftung des Personio-Freifelds mit der Personalnummer.
PERSONALNUMMER_FELD = "datev personalnummer"


@dataclass
class OhneZuordnung:
    personalnummer: str
    mitarbeiter_name: str | None
    teilnahmen: int


@dataclass
class Vorschau:
    dateiname: str
    schulungen: int
    schulungen_neu: int
    teilnahmen: int
    teilnahmen_zugeordnet: int
    bereiche: dict[str, int]
    nicht_zugeordnet: list[OhneZuordnung] = field(default_factory=list)
    hinweise: list[str] = field(default_factory=list)


def personalnummer_aus(roh: object) -> str | None:
    """Die Personalnummer aus einem Personio-Rohdatensatz lesen."""
    if not isinstance(roh, dict):
        return None
    for feld in (roh.get("attributes") or {}).values():
        if not isinstance(feld, dict):
            continue
        if str(feld.get("label", "")).strip().lower() == PERSONALNUMMER_FELD:
            wert = feld.get("value")
            text = str(wert).strip() if wert is not None else ""
            return text or None
    return None


async def _nachschlagewerk() -> dict[str, int]:
    """Personalnummer → Personio-Kennung."""
    async with SessionLocal() as sitzung:
        zeilen = (
            await sitzung.execute(
                sa.select(personio_employees.c.id, personio_employees.c.raw_json)
            )
        ).all()
    werk: dict[str, int] = {}
    for zeile in zeilen:
        nummer = personalnummer_aus(zeile.raw_json)
        if nummer:
            werk.setdefault(nummer, zeile.id)
    return werk


def sammle_ohne_zuordnung(uebersicht: Uebersicht, werk: dict[str, int]) -> list[OhneZuordnung]:
    offen: dict[str, OhneZuordnung] = {}
    for schulung in uebersicht.schulungen:
        for teilnahme in schulung.teilnahmen:
            if teilnahme.personalnummer in werk:
                continue
            eintrag = offen.get(teilnahme.personalnummer)
            if eintrag is None:
                offen[teilnahme.personalnummer] = OhneZuordnung(
                    personalnummer=teilnahme.personalnummer,
                    mitarbeiter_name=teilnahme.mitarbeiter_name,
                    teilnahmen=1,
                )
            else:
                eintrag.teilnahmen += 1
                eintrag.mitarbeiter_name = eintrag.mitarbeiter_name or teilnahme.mitarbeiter_name
    return sorted(offen.values(), key=lambda e: e.personalnummer)


def _zahlen(uebersicht: Uebersicht, werk: dict[str, int], dateiname: str, neu: int) -> Vorschau:
    bereiche: dict[str, int] = {}
    for schulung in uebersicht.schulungen:
        bereiche[schulung.bereich] = bereiche.get(schulung.bereich, 0) + 1
    zugeordnet = sum(
        1
        for schulung in uebersicht.schulungen
        for teilnahme in schulung.teilnahmen
        if teilnahme.personalnummer in werk
    )
    return Vorschau(
        dateiname=dateiname,
        schulungen=len(uebersicht.schulungen),
        schulungen_neu=neu,
        teilnahmen=uebersicht.teilnahmen,
        teilnahmen_zugeordnet=zugeordnet,
        bereiche=bereiche,
        nicht_zugeordnet=sammle_ohne_zuordnung(uebersicht, werk),
        hinweise=list(uebersicht.hinweise),
    )


async def vorschau(uebersicht: Uebersicht, dateiname: str) -> Vorschau:
    """Analysieren, ohne zu schreiben."""
    werk = await _nachschlagewerk()
    async with SessionLocal() as sitzung:
        vorhanden = {
            (z.bereich, z.name)
            for z in (
                await sitzung.execute(
                    sa.select(schulung_katalog.c.bereich, schulung_katalog.c.name)
                )
            ).all()
        }
    neu = sum(
        1 for s in uebersicht.schulungen if (s.bereich, s.name) not in vorhanden
    )
    return _zahlen(uebersicht, werk, dateiname, neu)


async def uebernehmen(uebersicht: Uebersicht, dateiname: str) -> Vorschau:
    """Schreiben — Katalog und Teilnahmen in einer Transaktion.

    Ergänzend, nicht ersetzend: was in der Oberfläche gepflegt wurde (Frist,
    Verantwortlicher, Beschreibung), bleibt stehen. Die Excel liefert nur
    Turnus und Daten.
    """
    werk = await _nachschlagewerk()
    jetzt = datetime.now(timezone.utc)

    async with SessionLocal() as sitzung:
        async with sitzung.begin():
            vorhanden = {
                (z.bereich, z.name): z.id
                for z in (
                    await sitzung.execute(
                        sa.select(
                            schulung_katalog.c.id,
                            schulung_katalog.c.bereich,
                            schulung_katalog.c.name,
                        )
                    )
                ).all()
            }
            neu = sum(
                1 for s in uebersicht.schulungen if (s.bereich, s.name) not in vorhanden
            )
            ergebnis = _zahlen(uebersicht, werk, dateiname, neu)

            lauf = (
                await sitzung.execute(
                    sa.insert(schulung_importe)
                    .values(
                        dateiname=dateiname,
                        importiert_am=jetzt,
                        schulungen=ergebnis.schulungen,
                        teilnahmen=ergebnis.teilnahmen,
                        nicht_zugeordnet=len(ergebnis.nicht_zugeordnet),
                    )
                    .returning(schulung_importe.c.id)
                )
            ).scalar_one()

            for schulung in uebersicht.schulungen:
                schulung_id = vorhanden.get((schulung.bereich, schulung.name))
                if schulung_id is None:
                    schulung_id = (
                        await sitzung.execute(
                            sa.insert(schulung_katalog)
                            .values(
                                bereich=schulung.bereich,
                                name=schulung.name,
                                turnus=schulung.turnus,
                                turnus_monate=schulung.turnus_monate,
                                sortierung=schulung.sortierung,
                            )
                            .returning(schulung_katalog.c.id)
                        )
                    ).scalar_one()
                    vorhanden[(schulung.bereich, schulung.name)] = schulung_id
                else:
                    # Nur, was aus der Excel kommt. Frist, Verantwortlicher und
                    # Beschreibung werden hier gepflegt und bleiben stehen.
                    await sitzung.execute(
                        sa.update(schulung_katalog)
                        .where(schulung_katalog.c.id == schulung_id)
                        .values(
                            turnus=schulung.turnus,
                            turnus_monate=schulung.turnus_monate,
                            sortierung=schulung.sortierung,
                        )
                    )

                for teilnahme in schulung.teilnahmen:
                    kennung = werk.get(teilnahme.personalnummer)
                    werte = {
                        "schulung_id": schulung_id,
                        "employee_id": kennung,
                        "personalnummer": teilnahme.personalnummer,
                        "mitarbeiter_name": teilnahme.mitarbeiter_name,
                        "abteilung_kuerzel": teilnahme.abteilung_kuerzel,
                        "initial_datum": teilnahme.initial_datum,
                        "aktuell_datum": teilnahme.aktuell_datum,
                        "naechste_faellig": teilnahme.naechste_faellig,
                        "import_id": lauf,
                        "geaendert_am": jetzt,
                    }
                    # Der passende Eindeutigkeitsindex hängt daran, ob die
                    # Person in Personio gefunden wurde.
                    if kennung is not None:
                        anweisung = (
                            pg_insert(schulung_teilnahmen)
                            .values(werte)
                            .on_conflict_do_update(
                                index_elements=["schulung_id", "employee_id"],
                                index_where=schulung_teilnahmen.c.employee_id.isnot(None),
                                set_={
                                    k: v
                                    for k, v in werte.items()
                                    if k not in ("schulung_id", "employee_id")
                                },
                            )
                        )
                    else:
                        anweisung = (
                            pg_insert(schulung_teilnahmen)
                            .values(werte)
                            .on_conflict_do_update(
                                index_elements=["schulung_id", "personalnummer"],
                                index_where=sa.and_(
                                    schulung_teilnahmen.c.employee_id.is_(None),
                                    schulung_teilnahmen.c.personalnummer.isnot(None),
                                ),
                                set_={
                                    k: v
                                    for k, v in werte.items()
                                    if k not in ("schulung_id", "personalnummer")
                                },
                            )
                        )
                    await sitzung.execute(anweisung)

    return ergebnis
