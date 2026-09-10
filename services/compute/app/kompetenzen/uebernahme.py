"""Eine Bereichsdatei übernehmen — erst zeigen, dann schreiben.

Der interessante Teil ist die Zuordnung der Spaltenköpfe zu Personio. Die
Excel schreibt Namen, wie sie gerade passen; Personio führt sie vollständig.
Zwei Stufen, und im Zweifel keine Zuordnung:

1. Der Name stimmt genau.
2. **Alle** Namensbestandteile der Excel zeigen auf dieselbe Person. Das deckt
   „Fernando Gomes" → „Fernando Gomes Ferreira" ab. Bleiben mehrere übrig,
   wird bewusst nicht zugeordnet — eine falsche Zuordnung wäre schlimmer als
   gar keine, weil an ihr Leistungsbewertungen hängen.

Die Spalte behält in jedem Fall ihren Namen aus der Excel. Ohne das verlöre
eine nicht zugeordnete Spalte ihre Beschriftung.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone

import sqlalchemy as sa

from app.db import (
    SessionLocal,
    kompetenz_bewertungen,
    kompetenz_kategorien,
    kompetenz_matrizen,
    kompetenz_personen,
    kompetenz_qualifikationen,
    personio_employees,
)
from app.parsing.kompetenzmatrix import Datei, Matrix

#: Spaltenköpfe, die keine Person meinen.
PLATZHALTER = {"n/a", "na", "-", "tbd", "—"}


@dataclass
class MatrixVorschau:
    blatt: str
    titel: str | None
    qualifikationen: int
    personen: int
    bewertungen: int
    zugeordnet: int
    nicht_zugeordnet: list[str]
    platzhalter: int


@dataclass
class Vorschau:
    dateiname: str
    bereich: str
    matrizen: list[MatrixVorschau] = field(default_factory=list)
    hinweise: list[str] = field(default_factory=list)


def normalisiere(name: str) -> str:
    return " ".join(name.split()).lower()


def finde_person(
    name: str, exakt: dict[str, int], nach_teilen: dict[str, list[int]]
) -> int | None:
    """Die Personio-Kennung zum Spaltenkopf, oder nichts."""
    norm = normalisiere(name)
    if norm in exakt:
        return exakt[norm]

    teile = [t for t in norm.split() if len(t) > 2]
    if not teile:
        return None
    kandidaten: set[int] | None = None
    for teil in teile:
        treffer = set(nach_teilen.get(teil, []))
        if not treffer:
            return None  # ein Bestandteil passt nirgends
        kandidaten = treffer if kandidaten is None else (kandidaten & treffer)
        if not kandidaten:
            return None
    return next(iter(kandidaten)) if kandidaten and len(kandidaten) == 1 else None


def baue_index(zeilen) -> tuple[dict[str, int], dict[str, list[int]]]:
    """Zwei Suchindizes: der ganze Name und die einzelnen Bestandteile."""
    exakt: dict[str, int] = {}
    nach_teilen: dict[str, list[int]] = {}
    for zeile in zeilen:
        voll = normalisiere(f"{zeile.first_name or ''} {zeile.last_name or ''}")
        if voll:
            exakt.setdefault(voll, zeile.id)
        for teil in voll.split():
            if len(teil) > 2:
                nach_teilen.setdefault(teil, []).append(zeile.id)
    return exakt, nach_teilen


async def _index():
    async with SessionLocal() as sitzung:
        zeilen = (
            await sitzung.execute(
                sa.select(personio_employees).where(personio_employees.c.status == "active")
            )
        ).all()
    return baue_index(zeilen)


def _analysiere(matrix: Matrix, exakt, nach_teilen) -> tuple[MatrixVorschau, list[int | None]]:
    zuordnung: list[int | None] = []
    offen: list[str] = []
    platzhalter = 0
    for name in matrix.personen:
        if normalisiere(name) in PLATZHALTER:
            platzhalter += 1
            zuordnung.append(None)
            continue
        treffer = finde_person(name, exakt, nach_teilen)
        zuordnung.append(treffer)
        if treffer is None:
            offen.append(name)

    return (
        MatrixVorschau(
            blatt=matrix.blatt,
            titel=matrix.titel,
            qualifikationen=len(matrix.qualifikationen),
            personen=len(matrix.personen),
            bewertungen=sum(len(q.bewertungen) for q in matrix.qualifikationen),
            zugeordnet=sum(1 for z in zuordnung if z is not None),
            nicht_zugeordnet=offen,
            platzhalter=platzhalter,
        ),
        zuordnung,
    )


async def vorschau(datei: Datei, bereich: str) -> Vorschau:
    """Analysieren, ohne zu schreiben."""
    exakt, nach_teilen = await _index()
    ergebnis = Vorschau(dateiname=datei.dateiname, bereich=bereich, hinweise=list(datei.hinweise))
    for matrix in datei.matrizen:
        blick, _ = _analysiere(matrix, exakt, nach_teilen)
        ergebnis.matrizen.append(blick)
    return ergebnis


async def uebernehmen(datei: Datei, bereich: str) -> Vorschau:
    """Schreiben — je Blatt ersetzend, alles in einer Transaktion.

    Ersetzend, weil die Excel die Wahrheit über ihren eigenen Stand ist: eine
    gelöschte Zeile soll auch hier verschwinden. Wer danach in der Oberfläche
    pflegt, verliert das beim nächsten Import — deshalb zeigt die Maske vorher,
    was passiert.
    """
    exakt, nach_teilen = await _index()
    ergebnis = Vorschau(dateiname=datei.dateiname, bereich=bereich, hinweise=list(datei.hinweise))
    jetzt = datetime.now(timezone.utc)

    async with SessionLocal() as sitzung:
        async with sitzung.begin():
            for matrix in datei.matrizen:
                blick, zuordnung = _analysiere(matrix, exakt, nach_teilen)
                ergebnis.matrizen.append(blick)

                # Die Kaskade räumt Qualifikationen, Personen und Bewertungen.
                await sitzung.execute(
                    sa.delete(kompetenz_matrizen).where(
                        sa.and_(
                            kompetenz_matrizen.c.bereich == bereich,
                            kompetenz_matrizen.c.blatt == matrix.blatt,
                        )
                    )
                )
                matrix_id = (
                    await sitzung.execute(
                        sa.insert(kompetenz_matrizen)
                        .values(
                            bereich=bereich,
                            blatt=matrix.blatt,
                            titel=matrix.titel,
                            stand=matrix.stand,
                            dateiname=datei.dateiname,
                            importiert_am=jetzt,
                        )
                        .returning(kompetenz_matrizen.c.id)
                    )
                ).scalar_one()

                personen_ids = []
                if matrix.personen:
                    personen_ids = list(
                        (
                            await sitzung.execute(
                                sa.insert(kompetenz_personen)
                                .values(
                                    [
                                        {
                                            "matrix_id": matrix_id,
                                            "name": name,
                                            "employee_id": zuordnung[i],
                                            "reihenfolge": i,
                                        }
                                        for i, name in enumerate(matrix.personen)
                                    ]
                                )
                                .returning(kompetenz_personen.c.id)
                            )
                        ).scalars()
                    )

                kategorien = []
                for reihe, name in enumerate(
                    dict.fromkeys(
                        q.kategorie for q in matrix.qualifikationen if q.kategorie
                    )
                ):
                    kategorien.append(
                        {"matrix_id": matrix_id, "name": name, "reihenfolge": reihe}
                    )
                if kategorien:
                    await sitzung.execute(sa.insert(kompetenz_kategorien).values(kategorien))

                for qualifikation in matrix.qualifikationen:
                    qualifikation_id = (
                        await sitzung.execute(
                            sa.insert(kompetenz_qualifikationen)
                            .values(
                                matrix_id=matrix_id,
                                nr=qualifikation.nr,
                                kategorie=qualifikation.kategorie,
                                bezeichnung=qualifikation.bezeichnung,
                                reihenfolge=qualifikation.reihenfolge,
                            )
                            .returning(kompetenz_qualifikationen.c.id)
                        )
                    ).scalar_one()
                    zellen = [
                        {
                            "qualifikation_id": qualifikation_id,
                            "person_id": personen_ids[b.person],
                            "anforderungslevel": b.anforderungslevel,
                            "erfuellungsgrad": b.erfuellungsgrad,
                        }
                        for b in qualifikation.bewertungen
                        if b.person < len(personen_ids)
                    ]
                    if zellen:
                        await sitzung.execute(sa.insert(kompetenz_bewertungen).values(zellen))

    return ergebnis
