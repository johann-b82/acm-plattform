"""Die Abbildung alt → neu muss eindeutig sein.

Sie ist die Liste, an der die Übernahme abgehakt wird. Steht eine Tabelle
zweimal darin, zählt der Abgleich sie zweimal und ein Fehlbestand fällt nicht
auf; fehlt eine Tabelle der neuen Datenbank ganz, wird sie nie geprüft.
"""
from __future__ import annotations

from collections import Counter

import pytest
import sqlalchemy as sa

from app.db import SessionLocal
from app.uebernahme.abgleich import PAARE, Zeile

def test_keine_tabelle_steht_zweimal_da():
    for seite in ("alt", "neu"):
        namen = [getattr(p, seite) for p in PAARE if getattr(p, seite)]
        doppelt = [n for n, anzahl in Counter(namen).items() if anzahl > 1]
        assert doppelt == [], f"{seite}: {doppelt}"


def test_jede_zeile_hat_wenigstens_eine_seite():
    assert [p for p in PAARE if not p.alt and not p.neu] == []


def test_was_nicht_portiert_wird_traegt_eine_begruendung():
    for p in PAARE:
        if p.neu is None:
            assert p.hinweis, p.alt


def test_gleiche_zahl_stimmt_ueberein():
    assert Zeile("M", "a", "b", 5, 5, "").stimmt
    assert not Zeile("M", "a", "b", 5, 4, "").stimmt
    # Eine Seite fehlt absichtlich: nichts zu vergleichen.
    assert Zeile("M", "a", None, 5, None, "Grund").stimmt


@pytest.mark.asyncio
async def test_jede_neue_tabelle_gibt_es_auch(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")
    async with SessionLocal() as sitzung:
        vorhanden = set(
            (
                await sitzung.execute(
                    sa.text(
                        "select table_name from information_schema.tables"
                        " where table_schema = 'public' and table_type = 'BASE TABLE'"
                    )
                )
            ).scalars()
        )
    genannt = {p.neu for p in PAARE if p.neu}
    assert genannt - vorhanden == set()
