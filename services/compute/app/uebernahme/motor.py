"""Der Motor der Übernahme: eine Tabelle nach der anderen, erklärt statt geskriptet.

Die Fachmodule beschreiben ihre Tabellen als `Umzug` — welche neue Spalte aus
welcher alten kommt, wie der Schlüssel entsteht, welche Verweise mitwandern.
Das Kopieren selbst steht einmal hier.

**Schlüssel.** Drei Fälle, und die Wahl ist keine Geschmacksfrage:

* `id_aus="alt"` — beide Seiten haben denselben Typ (meist UUID). Der
  Schlüssel wandert mit, und jeder Verweis darauf stimmt ohne Zutun.
* `id_aus="uuid5"` — alt ist eine Zahl, neu eine UUID. Aus Tabellenname und
  alter Zahl wird eine feste UUID gerechnet. Zweimal laufen lassen ergibt
  zweimal dieselbe; Verweise lassen sich ausrechnen statt nachschlagen.
* `id_aus=None` — die neue Tabelle vergibt selbst (Identity). Die Zuordnung
  alt → neu merkt sich der Lauf, damit Kindtabellen sie benutzen können.

**Wiederholbar.** Jeder Umzug nennt einen natürlichen Schlüssel; eingefügt
wird mit `on conflict do nothing`. Ein zweiter Lauf fügt nichts doppelt ein.

Gelesen wird aus der alten Datenbank ausschließlich; geschrieben wird nur in
die neue.
"""
from __future__ import annotations

import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.db import SessionLocal

#: Fester Namensraum für `uuid5`. Ändert sich der Wert, bekommen alle
#: gerechneten Schlüssel neue Werte — dann ist ein zweiter Lauf kein zweiter
#: Lauf mehr, sondern ein zweiter Datenbestand. Also: nie ändern.
NAMENSRAUM = uuid.UUID("6f1c4b8e-0e2a-5d31-9c7a-2f0b1d8e4a55")

#: Wie viele Platzhalter ein Einfügen höchstens tragen darf. Der Treiber
#: (asyncpg) lässt 32767 zu — jede Zeile kostet so viele, wie sie Spalten hat.
#: Ein festes Bündel von 2000 Zeilen sprengt das bei zwanzig Spalten; die
#: Bündelgröße richtet sich deshalb nach der Tabelle.
PLATZHALTER_HOECHSTENS = 30000

#: Obergrenze je Bündel, damit schmale Tabellen nicht Zehntausende Zeilen auf
#: einmal schreiben und den Speicher belegen.
BUENDEL_HOECHSTENS = 2000


def buendelgroesse(spalten: int) -> int:
    if spalten <= 0:
        return BUENDEL_HOECHSTENS
    return max(1, min(BUENDEL_HOECHSTENS, PLATZHALTER_HOECHSTENS // spalten))


def neue_id(tabelle: str, alt_id: Any) -> str:
    """Die feste UUID zu einer alten Zahl. Gleiche Eingabe, gleiche Ausgabe."""
    return str(uuid.uuid5(NAMENSRAUM, f"{tabelle}:{alt_id}"))


@dataclass(frozen=True)
class Umzug:
    alt: str
    neu: str
    #: neue Spalte → alte Spalte. Nur was hier steht, wandert.
    spalten: dict[str, str]
    #: Woher der Schlüssel kommt: "alt", "uuid5" oder None (Datenbank vergibt).
    id_aus: str | None = None
    #: neue Spalte → alte Tabelle, deren Schlüssel dort steht. Der Wert wird
    #: übersetzt: über `uuid5` oder über die gemerkte Zuordnung des Laufs.
    verweise: dict[str, str] = field(default_factory=dict)
    #: Natürlicher Schlüssel für `on conflict do nothing`.
    schluessel: tuple[str, ...] = ("id",)
    #: Feste Werte für neue Spalten ohne Gegenstück.
    fest: dict[str, Any] = field(default_factory=dict)
    #: neue Spalte → f(wert) für Umrechnungen (Einheiten, Kennungen, Sorten).
    wandler: dict[str, Callable[[Any], Any]] = field(default_factory=dict)
    #: Zeilen, die nicht mitkommen sollen — f(alte Zeile) → True heißt: lassen.
    auslassen: Callable[[dict], bool] | None = None
    #: Reihenfolge beim Lesen, wo sie zählt (Elternzeilen vor Kindzeilen).
    sortierung: str = "1"
    #: Ob die alte Tabelle überhaupt einen Schlüssel `id` führt. Ein paar
    #: Ingestionstabellen haben keinen.
    alt_id: bool = True


@dataclass
class Lauf:
    """Der Zustand einer Übernahme: was schon übersetzt wurde."""

    #: alte Tabelle → {alte id: neue id}. Nur für Tabellen, deren Schlüssel die
    #: Datenbank vergibt; die gerechneten stehen nicht drin, die kann man
    #: ausrechnen.
    zuordnung: dict[str, dict[Any, Any]] = field(default_factory=dict)
    bericht: dict[str, int] = field(default_factory=dict)

    def uebersetze(self, tabelle: str, alt_id: Any, per_uuid5: bool) -> Any:
        if alt_id is None:
            return None
        if per_uuid5:
            return neue_id(tabelle, alt_id)
        return self.zuordnung.get(tabelle, {}).get(alt_id)


def _lies(quelle: sa.engine.Engine, umzug: Umzug) -> list[dict]:
    spalten = sorted({*umzug.spalten.values(), *(["id"] if umzug.alt_id else [])})
    with quelle.connect() as verbindung:
        zeilen = verbindung.execute(
            sa.text(
                f"select {', '.join(spalten)} from public.{umzug.alt}"
                f" order by {umzug.sortierung}"
            )
        ).mappings()
        return [dict(z) for z in zeilen]


def _baue(umzug: Umzug, alte_zeile: dict, lauf: Lauf, uuid5_tabellen: set[str]) -> dict:
    neu: dict[str, Any] = {}
    for neue_spalte, alte_spalte in umzug.spalten.items():
        wert = alte_zeile.get(alte_spalte)
        if neue_spalte in umzug.verweise:
            ziel = umzug.verweise[neue_spalte]
            wert = lauf.uebersetze(ziel, wert, ziel in uuid5_tabellen)
        if neue_spalte in umzug.wandler:
            wert = umzug.wandler[neue_spalte](wert)
        neu[neue_spalte] = wert
    neu.update(umzug.fest)
    if umzug.id_aus == "alt":
        neu["id"] = alte_zeile["id"]
    elif umzug.id_aus == "uuid5":
        neu["id"] = neue_id(umzug.alt, alte_zeile["id"])
    return neu


async def umziehen(
    quelle: sa.engine.Engine,
    umzug: Umzug,
    lauf: Lauf,
    uuid5_tabellen: set[str],
    ziel: sa.Table,
    ohne_trigger: bool = True,
) -> int:
    """Eine Tabelle übernehmen. Gibt zurück, wie viele Zeilen geschrieben wurden.

    **Die Trigger schweigen dabei.** Der neue Stack legt beim Einfügen Dinge
    von selbst an — ein Audit bekommt seine Phasen aus der Vorlage, jede
    Änderung eine Zeile im Verlauf, eine freigegebene ATR-Lieferung nimmt
    überhaupt keine Position mehr an. Beim Umzug ist das alles falsch: die
    Phasen stehen schon in der alten Datenbank, der Verlauf auch, und die
    Lieferung war damals freigegeben. `session_replication_role = replica`
    legt für die Dauer der Transaktion beides still — Trigger und
    Fremdschlüsselprüfung. Die Reihenfolge in `lauf.BEREICHE` sorgt dafür,
    dass die Verweise trotzdem stimmen."""
    alte_zeilen = _lies(quelle, umzug)
    if umzug.auslassen:
        alte_zeilen = [z for z in alte_zeilen if not umzug.auslassen(z)]
    if not alte_zeilen:
        lauf.bericht[umzug.neu] = 0
        return 0

    geschrieben = 0
    zuordnung: dict[Any, Any] = {}
    async with SessionLocal() as sitzung:
        async with sitzung.begin():
            if ohne_trigger:
                await sitzung.execute(
                    sa.text("set local session_replication_role = replica")
                )
            groesse = buendelgroesse(len(umzug.spalten) + len(umzug.fest) + 1)
            for anfang in range(0, len(alte_zeilen), groesse):
                buendel = alte_zeilen[anfang : anfang + groesse]
                neue = [_baue(umzug, z, lauf, uuid5_tabellen) for z in buendel]
                anweisung = pg_insert(ziel).values(neue)
                anweisung = anweisung.on_conflict_do_nothing(
                    index_elements=list(umzug.schluessel)
                )
                if umzug.id_aus is None and "id" in ziel.c:
                    anweisung = anweisung.returning(ziel.c.id)
                    vergeben = list((await sitzung.execute(anweisung)).scalars())
                    # `do nothing` liefert für übersprungene Zeilen nichts
                    # zurück; nur ein vollständiger Lauf kann zuordnen.
                    if umzug.alt_id and len(vergeben) == len(buendel):
                        for alt_zeile, neu_id in zip(buendel, vergeben):
                            zuordnung[alt_zeile["id"]] = neu_id
                    geschrieben += len(vergeben)
                else:
                    ergebnis = await sitzung.execute(anweisung)
                    geschrieben += ergebnis.rowcount

    if umzug.id_aus is None and umzug.alt_id and zuordnung:
        lauf.zuordnung[umzug.alt] = zuordnung
    lauf.bericht[umzug.neu] = geschrieben
    return geschrieben
