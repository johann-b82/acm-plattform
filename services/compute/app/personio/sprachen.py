"""Welche Muttersprachen in der Belegschaft vorkommen.

Gefragt wird, um zu wissen, welche Sprachen die Oberfläche anbieten soll. Die
Antwort steht in Personio — als Feld, das jedes Haus anders nennt: „Sprache",
„Muttersprache", „Mother tongue", „Native language". Deshalb wird nicht nach
einem festen Feldnamen gesucht, sondern nach jedem, dessen Name danach
aussieht; ausgegeben werden Feld, Wert und Anzahl, damit sichtbar ist, woher
die Liste kommt.

**Kein Netz nötig, wenn abgeglichen wurde.** Der Abgleich legt die
Mitarbeiter-Rohdaten vollständig ab; das Feld steht also schon in der
Datenbank. Nur wenn dort nichts liegt, fragt der Befehl Personio direkt.
"""
from __future__ import annotations

import re
from collections import Counter
from typing import Any

from app.personio.listen import _name

#: Feldnamen, die nach Sprache aussehen. Absichtlich weit: lieber ein Feld zu
#: viel in der Ausgabe als das gesuchte nicht dabei. `sprach` und nicht
#: `sprache` — sonst fällt „Sprachkenntnisse" durch.
SPRACHFELD = re.compile(r"sprach|language|mother|native|tongue", re.IGNORECASE)


def sprachen_aus(rohdaten: list[dict | None]) -> list[tuple[str, str, int]]:
    """Feld, Wert und Anzahl — häufigste zuerst.

    Werte werden getrimmt und in ihrer Schreibweise belassen: „türkisch" und
    „Türkisch" sind derselbe Eintrag, aber „Türkisch" und „Turkish" nicht —
    das zu vereinheitlichen hieße raten, und die Liste soll zeigen, was
    wirklich gepflegt ist.
    """
    zaehler: Counter[tuple[str, str]] = Counter()
    for roh in rohdaten:
        attrs = (roh or {}).get("attributes")
        if not isinstance(attrs, dict):
            continue
        for feld, knoten in attrs.items():
            if not SPRACHFELD.search(feld):
                continue
            for wert in _werte(knoten):
                zaehler[(feld, wert)] += 1
    return [
        (feld, wert, anzahl)
        for (feld, wert), anzahl in sorted(
            zaehler.items(), key=lambda p: (-p[1], p[0][0], p[0][1].lower())
        )
    ]


def _werte(knoten: Any) -> list[str]:
    """Die Texte hinter einem Personio-Feld.

    Ein Feld kann ein Text sein, ein `{value: …}`, eine Referenz mit eigenen
    Attributen — oder eine Mehrfachauswahl. Jeder Eintrag zählt einzeln: wer
    zwei Sprachen gepflegt hat, spricht zwei.
    """
    if isinstance(knoten, dict) and isinstance(knoten.get("value"), list):
        einzeln = [_name(e) for e in knoten["value"]]
        return [w.strip() for w in einzeln if w and w.strip()]
    name = _name(knoten)
    return [name.strip()] if name and name.strip() else []
