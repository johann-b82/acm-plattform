"""Jeder `schluessel` eines Umzugs muss im Zielschema eindeutig sein.

`on conflict (...)` verlangt einen passenden Unique-Index. Fehlt er, bricht der
Lauf erst am Stichtag ab — mitten in der Übernahme, nachdem schon Zehntausende
Zeilen geschrieben sind. Genau das ist mit `einarbeitung_pflicht` passiert:
Migration 0065 gab der Tabelle `geltung` und einen neuen Unique-Index, der alte
Schlüssel `(einarbeitung_id, abteilung)` zeigte danach ins Leere.

Der Test geht deshalb über *alle* Umzüge, nicht nur über den einen.
"""
from __future__ import annotations

import pytest
import pytest_asyncio
import sqlalchemy as sa

from app.db import SessionLocal
from app.uebernahme.atr_stamm import UMZUEGE as ATR
from app.uebernahme.personal import UMZUEGE as PERSONAL
from app.uebernahme.qualifizierung import UMZUEGE as QUALIFIZIERUNG
from app.uebernahme.qualitaet import UMZUEGE as QUALITAET
from app.uebernahme.technik import UMZUEGE as TECHNIK
from app.uebernahme.vertrieb_einkauf import UMZUEGE as VERTRIEB_EINKAUF

ALLE = [*ATR, *PERSONAL, *QUALIFIZIERUNG, *QUALITAET, *TECHNIK, *VERTRIEB_EINKAUF]


@pytest_asyncio.fixture
async def db(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")
    yield


async def _eindeutige_spaltensaetze(tabelle: str) -> list[frozenset[str]]:
    """Alle Spaltenmengen, über die die Tabelle eine Eindeutigkeit führt.

    Nur einfache Spaltenindizes zählen: `on conflict` trifft einen Index über
    Ausdrücke (etwa `coalesce(abteilung, '')`) nicht über die blanke Spalte.
    """
    async with SessionLocal() as s:
        zeilen = (
            await s.execute(
                sa.text(
                    "select i.indkey, i.indexprs is not null as mit_ausdruck,"
                    "       array_agg(a.attname order by a.attnum) as spalten"
                    "  from pg_index i"
                    "  join pg_class t on t.oid = i.indrelid"
                    "  join pg_namespace n on n.oid = t.relnamespace"
                    "  left join pg_attribute a"
                    "         on a.attrelid = t.oid and a.attnum = any(i.indkey)"
                    " where n.nspname = 'public' and t.relname = :t"
                    "   and i.indisunique and i.indpred is null"
                    " group by i.indkey, i.indexprs"
                ),
                {"t": tabelle},
            )
        ).all()
    return [
        frozenset(z.spalten)
        for z in zeilen
        if not z.mit_ausdruck and z.spalten and all(z.spalten)
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize("umzug", ALLE, ids=lambda u: f"{u.alt}->{u.neu}")
async def test_schluessel_hat_eindeutigkeit(db, umzug):
    saetze = await _eindeutige_spaltensaetze(umzug.neu)
    assert saetze, f"{umzug.neu} führt gar keine Eindeutigkeit"
    assert frozenset(umzug.schluessel) in saetze, (
        f"{umzug.alt} → {umzug.neu}: schluessel={umzug.schluessel} trifft keinen"
        f" Unique-Index. Vorhanden: {[sorted(s) for s in saetze]}"
    )


@pytest.mark.asyncio
async def test_pflicht_schreibt_geltung(db):
    """Die beiden Pflicht-Tabellen brauchen seit 0065 eine Geltung.

    `geltung` ist NOT NULL und der CHECK verlangt zur Geltung „abteilung" eine
    gesetzte Abteilung. Ein Umzug, der die Spalte nicht füllt, scheitert erst
    an der echten Zeile.
    """
    for name in ("schulung_pflicht", "einarbeitung_pflicht"):
        umzug = next(u for u in ALLE if u.neu == name)
        assert "geltung" in umzug.spalten or "geltung" in umzug.fest, (
            f"{name}: der Umzug setzt keine Geltung"
        )
        if "geltung" in umzug.wandler:
            assert umzug.wandler["geltung"](None) == "abteilung"
