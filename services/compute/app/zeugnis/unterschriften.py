"""Wer das Zeugnis unterschreibt.

Zwei Unterschriften stehen darunter, und nur eine davon ist für alle gleich:

  links   die **fachliche** — der oder die Vorgesetzte der Person. Die hängt
          an der Person, nicht am Haus: wer in der Näherei arbeitet, bekommt
          die Unterschrift der Näherei.
  rechts  die **personalseitige** — eine feste Person aus dem Personalwesen.

Die linke kommt deshalb aus Personios Organisationsstruktur, die rechte aus
dem Ausstellerprofil. Beide fallen auf die Freitextfelder zurück: ein Zeugnis
ohne Unterschrift wäre wertlos, und es gibt genug Fälle, in denen Personio
nichts hergibt — extern gepflegte Personen, ein nicht gepflegter Vorgesetzter,
ein Abgleich, der gerade nicht gelaufen ist.

Die Position ist der Titel unter dem Namen. Sie steht in `raw_json`, nicht in
einer Spalte — deshalb der Umweg über die Rohdaten.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import sqlalchemy as sa

from app.db import personio_employees


@dataclass(frozen=True)
class Unterschrift:
    name: str | None
    titel: str | None
    #: Woher sie stammt — die Maske zeigt es an, damit niemand raten muss.
    quelle: str  # "personio" | "profil" | "keine"

    @property
    def leer(self) -> bool:
        return not self.name


LEER = Unterschrift(None, None, "keine")


def pfad(wurzel: Any, *schluessel: str) -> Any:
    """Durch verschachtelte Personio-Rohdaten laufen, ohne bei jedem Schritt zu prüfen."""
    knoten = wurzel
    for s in schluessel:
        if not isinstance(knoten, dict):
            return None
        knoten = knoten.get(s)
    return knoten


def position_aus(roh: Any) -> str | None:
    """Die Position — der Titel unter der Unterschrift."""
    wert = pfad(roh, "attributes", "position", "value")
    return str(wert).strip() or None if isinstance(wert, str) else None


def name_aus(knoten: Any) -> str | None:
    """Den Namen aus einem eingebetteten Personenknoten ziehen.

    Personio führt neben Vor- und Nachname einen `preferred_name`. Der ist das,
    was im Haus auf dem Türschild steht — er geht vor.
    """
    bevorzugt = pfad(knoten, "preferred_name", "value")
    if isinstance(bevorzugt, str) and bevorzugt.strip():
        return bevorzugt.strip()
    teile = [
        pfad(knoten, "first_name", "value"),
        pfad(knoten, "last_name", "value"),
    ]
    name = " ".join(t.strip() for t in teile if isinstance(t, str) and t.strip())
    return name or None


def vorgesetzten_knoten(roh: Any) -> Any:
    """Der eingebettete Vorgesetztenknoten in den Rohdaten einer Person."""
    return pfad(roh, "attributes", "supervisor", "value", "attributes")


async def _person(sitzung, employee_id: int):
    return (
        await sitzung.execute(
            sa.select(personio_employees).where(personio_employees.c.id == employee_id)
        )
    ).mappings().one_or_none()


def _aus_profil(name: Any, titel: Any) -> Unterschrift:
    sauber = str(name).strip() if isinstance(name, str) and name.strip() else None
    if sauber is None:
        return LEER
    return Unterschrift(
        sauber,
        str(titel).strip() if isinstance(titel, str) and titel.strip() else None,
        "profil",
    )


async def fachlich(sitzung, employee_id: int | None, aussteller) -> Unterschrift:
    """Die linke Unterschrift: der oder die Vorgesetzte aus Personio."""
    rueckfall = _aus_profil(
        (aussteller or {}).get("unterzeichner1_name"),
        (aussteller or {}).get("unterzeichner1_titel"),
    )
    if not employee_id:
        return rueckfall

    person = await _person(sitzung, employee_id)
    chef = vorgesetzten_knoten(person["raw_json"] if person else None)
    name = name_aus(chef)
    if not name:
        return rueckfall

    # Die Position steht am eingebetteten Knoten oft nicht — dann über die ID
    # den vollen Datensatz holen. Ohne Titel unterschreibt sie trotzdem.
    titel = None
    chef_id = pfad(chef, "id", "value")
    if isinstance(chef_id, int):
        voll = await _person(sitzung, chef_id)
        titel = position_aus(voll["raw_json"] if voll else None)
    return Unterschrift(name, titel or position_aus({"attributes": chef}), "personio")


async def personalseitig(sitzung, aussteller) -> Unterschrift:
    """Die rechte Unterschrift: die feste Person aus dem Personalwesen."""
    rueckfall = _aus_profil(
        (aussteller or {}).get("unterzeichner2_name"),
        (aussteller or {}).get("unterzeichner2_titel"),
    )
    kennung = (aussteller or {}).get("hr_employee_id")
    if not kennung:
        return rueckfall

    person = await _person(sitzung, kennung)
    if person is None:
        return rueckfall
    name = f"{person['first_name'] or ''} {person['last_name'] or ''}".strip()
    if not name:
        return rueckfall
    return Unterschrift(name, position_aus(person["raw_json"]) or rueckfall.titel, "personio")


async def beide(sitzung, employee_id: int | None, aussteller) -> tuple[Unterschrift, Unterschrift]:
    return (
        await fachlich(sitzung, employee_id, aussteller),
        await personalseitig(sitzung, aussteller),
    )
