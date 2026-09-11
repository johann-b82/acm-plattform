"""Die Übernahme fahren: welche Fachbereiche es gibt und in welcher Reihenfolge.

Die Reihenfolge ist keine Geschmacksfrage. Kindtabellen brauchen die Zuordnung
alt → neu ihrer Elterntabelle, und die entsteht erst, wenn die Eltern geschrieben
sind — die Upload-Protokolle vor allem, was an ihnen hängt, die Zeichnung vor
ihren Ballons.

Jeder Fachbereich liegt in einem eigenen Modul und meldet dort eine Liste
`UMZUEGE`. Hinzufügen heißt: Modul schreiben, Namen hier eintragen.
"""
from __future__ import annotations

import importlib

import sqlalchemy as sa

from app.db import SessionLocal, TABLES
from app.uebernahme.motor import Lauf, Umzug, umziehen

#: Reihenfolge = Abhängigkeit. Was hier oben steht, wird zuerst geschrieben.
BEREICHE: tuple[str, ...] = (
    "vertrieb_einkauf",
    "qualitaet",
    "personal",
    "qualifizierung",
    "atr_stamm",
    "technik",
    "einstellungen",
)

#: Fachbereiche, die sich nicht als Tabellenumzug beschreiben lassen und
#: stattdessen eine eigene Funktion `uebernehmen(quelle)` mitbringen.
EIGENER_WEG = ("einstellungen",)


def umzuege(bereich: str) -> list[Umzug]:
    if bereich in EIGENER_WEG:
        return []
    modul = importlib.import_module(f"app.uebernahme.{bereich}")
    return list(modul.UMZUEGE)


def alle_umzuege(bereiche: tuple[str, ...] = BEREICHE) -> list[Umzug]:
    return [u for b in bereiche for u in umzuege(b)]


def uuid5_tabellen(alle: list[Umzug]) -> set[str]:
    """Welche alten Tabellen einen gerechneten Schlüssel bekommen — nötig,
    damit ein Verweis weiß, ob er rechnen oder nachschlagen muss."""
    return {u.alt for u in alle if u.id_aus == "uuid5"}


async def leeren(bereiche: tuple[str, ...] = BEREICHE) -> list[str]:
    """Die Zieltabellen leeren, bevor übernommen wird.

    Nur für den Umzug gedacht: solange im Ziel noch Demodaten liegen, kann der
    Abgleich nicht 1:1 aufgehen. `truncate … cascade` nimmt auch die Zeilen
    mit, die daran hängen — deshalb steht dieser Griff hinter einem eigenen
    Schalter und nicht im normalen Lauf.
    """
    tabellen = [u.neu for u in alle_umzuege(bereiche)]
    if not tabellen:
        return []
    async with SessionLocal() as sitzung:
        async with sitzung.begin():
            await sitzung.execute(
                sa.text(
                    "truncate "
                    + ", ".join(f"public.{t}" for t in dict.fromkeys(tabellen))
                    + " restart identity cascade"
                )
            )
    return list(dict.fromkeys(tabellen))


async def fahren(
    quelle: sa.engine.Engine,
    bereiche: tuple[str, ...] = BEREICHE,
    trocken: bool = False,
) -> Lauf:
    alle = alle_umzuege(bereiche)
    gerechnet = uuid5_tabellen(alle_umzuege())
    lauf = Lauf()
    for bereich in bereiche:
        if bereich not in EIGENER_WEG:
            continue
        modul = importlib.import_module(f"app.uebernahme.{bereich}")
        if not trocken:
            lauf.bericht.update(await modul.uebernehmen(quelle))
    for umzug in alle:
        ziel = TABLES.get(umzug.neu)
        if ziel is None:
            ziel = await _tabelle_aus_der_datenbank(umzug.neu)
        if trocken:
            lauf.bericht[umzug.neu] = _zaehle(quelle, umzug)
            continue
        await umziehen(quelle, umzug, lauf, gerechnet, ziel)
    return lauf


def _zaehle(quelle: sa.engine.Engine, umzug: Umzug) -> int:
    with quelle.connect() as verbindung:
        return verbindung.execute(
            sa.text(f"select count(*) from public.{umzug.alt}")
        ).scalar()


_METADATEN = sa.MetaData()


async def _tabelle_aus_der_datenbank(name: str) -> sa.Table:
    """Tabellen, die `app/db.py` nicht führt — die schreibt sonst PostgREST
    allein. Für die Übernahme reicht die Form aus der Datenbank selbst."""
    if name in _METADATEN.tables:
        return _METADATEN.tables[name]
    from app.db import engine

    async with engine.connect() as verbindung:
        await verbindung.run_sync(
            lambda synchron: sa.Table(name, _METADATEN, autoload_with=synchron)
        )
    return _METADATEN.tables[name]
