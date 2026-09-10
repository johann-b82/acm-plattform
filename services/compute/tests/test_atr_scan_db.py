"""Die Einstellung des Eingangsordners gegen eine echte Datenbank.

Zwei Stufen liegen hier übereinander: sehen darf, wer ATR benutzt — eintragen,
wohin der Dienst greift, nur die Plattform-Verwaltung. Das ist keine Frage der
Oberfläche: wer das Ziel setzt, bestimmt, gegen welchen Rechner im Netz sich
`compute` anmeldet.
"""
from __future__ import annotations

import pytest
import pytest_asyncio
import sqlalchemy as sa

from app.db import SessionLocal
from tests._auth import USER_ID

LESER = '{"sub":"%s","role":"authenticated","apps":{"atr":"viewer"}}' % USER_ID
PFLEGER = '{"sub":"%s","role":"authenticated","apps":{"atr":"editor"}}' % USER_ID
VERWALTUNG = '{"sub":"%s","role":"authenticated","apps":{"platform":"admin"}}' % USER_ID
FREMD = '{"sub":"%s","role":"authenticated","apps":{"hr":"admin"}}' % USER_ID


@pytest_asyncio.fixture
async def db(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")
    yield
    async with SessionLocal() as s:
        async with s.begin():
            await s.execute(sa.text("update public.atr_scan set aktiv = false"))


async def als(claims: str, sql: str, **params):
    async with SessionLocal() as s:
        trans = await s.begin()
        try:
            await s.execute(sa.text("set local role authenticated"))
            await s.execute(
                sa.text("select set_config('request.jwt.claims', :c, true)"), {"c": claims}
            )
            ergebnis = await s.execute(sa.text(sql), params)
            return [dict(r) for r in ergebnis.mappings()] if ergebnis.returns_rows else []
        finally:
            await trans.rollback()


LESEN = "select aktiv from public.atr_scan"
SCHALTEN = "update public.atr_scan set aktiv = true where id returning aktiv"


class TestRechte:
    @pytest.mark.asyncio
    async def test_wer_atr_benutzt_sieht_das_ziel(self, db):
        assert len(await als(LESER, LESEN)) == 1

    @pytest.mark.asyncio
    async def test_ohne_atr_bleibt_die_zeile_unsichtbar(self, db):
        assert await als(FREMD, LESEN) == []

    @pytest.mark.asyncio
    async def test_auch_ein_pfleger_darf_nicht_umstellen(self, db):
        # Kein Fehler, sondern null Zeilen: die Regel filtert, sie wirft nicht.
        assert await als(PFLEGER, SCHALTEN) == []

    @pytest.mark.asyncio
    async def test_die_verwaltung_darf(self, db):
        assert await als(VERWALTUNG, SCHALTEN) == [{"aktiv": True}]
