"""Einen Namen aus einer Excel einer Personio-Person zuordnen.

Die Excel schreibt Namen, wie sie gerade passen; Personio führt sie
vollständig. Zwei Stufen, und im Zweifel keine Zuordnung:

1. Der Name stimmt genau (Groß-/Kleinschreibung und Mehrfachleerzeichen egal).
2. **Alle** Namensbestandteile der Excel zeigen auf dieselbe Person. Das deckt
   „Fernando Gomes" → „Fernando Gomes Ferreira" ab. Bleiben mehrere übrig, wird
   bewusst nicht zugeordnet — eine falsche Zuordnung wäre schlimmer als keine,
   weil an ihr Leistungsbewertungen hängen.

Reine Rechnung ohne Datenbank; die Interview-Übernahme (Stufe D) und, früher,
die Matrix-Übernahme benutzen dieselben Helfer.
"""
from __future__ import annotations

#: Spaltenköpfe, die keine Person meinen.
PLATZHALTER = {"n/a", "na", "-", "tbd", "—", "<person(en) zuerst klären>"}


def normalisiere(name: str) -> str:
    return " ".join(name.split()).lower()


def baue_index(zeilen) -> tuple[dict[str, int], dict[str, list[int]]]:
    """Zwei Suchindizes: der ganze Name und die einzelnen Bestandteile.

    `zeilen` sind Objekte mit `id`, `first_name`, `last_name`.
    """
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
