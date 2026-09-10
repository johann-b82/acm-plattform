"""ATR-Teilekatalog gegen eine echte Datenbank.

Im Blick steht die normierte Teilenummer. Sie ist der Schlüssel, über den ein
Lieferschein später sein Teil findet — und sie ist eine erzeugte Spalte, damit
sie von der Teilenummer, aus der sie stammt, nicht abweichen kann.
"""
from __future__ import annotations

import pytest
import pytest_asyncio
import sqlalchemy as sa

from app.db import SessionLocal
from tests._auth import USER_ID

LESER = '{"sub":"%s","role":"authenticated","apps":{"atr":"viewer"}}' % USER_ID
PFLEGER = '{"sub":"%s","role":"authenticated","apps":{"atr":"editor"}}' % USER_ID
FREMD = '{"sub":"%s","role":"authenticated","apps":{"hr":"admin"}}' % USER_ID


@pytest_asyncio.fixture
async def db(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")

    async def leeren():
        async with SessionLocal() as s:
            async with s.begin():
                await s.execute(sa.text("delete from public.atr_teile"))
                await s.execute(sa.text("delete from public.atr_vorlagen"))

    await leeren()
    yield
    await leeren()


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


async def anlegen(sql: str, **params):
    async with SessionLocal() as s:
        async with s.begin():
            ergebnis = await s.execute(sa.text(sql), params)
            return [dict(r) for r in ergebnis.mappings()] if ergebnis.returns_rows else []


TEIL = ("insert into public.atr_teile (teilenummer, bezeichnung, gewicht_kg)"
        " values (:n, :b, :g)")


class TestNormierung:
    @pytest.mark.parametrize(
        "roh, erwartet",
        [
            ("VR-1234-56", "123456"),
            ("VR123456", "123456"),
            ("vr 12 34 56", "123456"),
            ("1234/56", "123456"),
            ("D-2000-11 Issue B", "200011"),
        ],
    )
    async def test_nur_ziffern_zaehlen(self, db, roh, erwartet):
        """Auf dem Lieferschein steht die Nummer anders als im Katalog."""
        zeilen = await anlegen(
            "select public.atr_teilenummer_norm(:n) as norm", n=roh)
        assert zeilen[0]["norm"] == erwartet

    async def test_ohne_ziffern_bleibt_leer(self, db):
        zeilen = await anlegen("select public.atr_teilenummer_norm('nur Text') as norm")
        assert zeilen[0]["norm"] is None

    async def test_die_spalte_folgt_der_teilenummer(self, db):
        """Erzeugt, nicht geschrieben — sie kann nicht auseinanderlaufen."""
        await anlegen(TEIL, n="VR-1234-56", b="Halter", g=1.25)
        zeile = (await anlegen(
            "select teilenummer_norm from public.atr_teile"))[0]
        assert zeile["teilenummer_norm"] == "123456"

        await anlegen("update public.atr_teile set teilenummer = 'VR-9999-00'")
        zeile = (await anlegen(
            "select teilenummer_norm from public.atr_teile"))[0]
        assert zeile["teilenummer_norm"] == "999900"

    async def test_sie_laesst_sich_nicht_selbst_setzen(self, db):
        with pytest.raises(Exception) as fehler:
            await anlegen(
                "insert into public.atr_teile (teilenummer, teilenummer_norm)"
                " values ('VR-1', '4711')")
        assert "generated" in str(fehler.value).lower()

    async def test_dieselbe_nummer_gibt_es_einmal(self, db):
        """Auch wenn sie verschieden geschrieben ist."""
        await anlegen(TEIL, n="VR-1234-56", b="Halter", g=1.0)
        with pytest.raises(Exception) as fehler:
            await anlegen(TEIL, n="VR 1234 56", b="Derselbe Halter", g=2.0)
        assert "unique" in str(fehler.value).lower() or "duplicate" in str(fehler.value).lower()

    async def test_mehrere_ohne_ziffern_blockieren_sich_nicht(self, db):
        """Der Index ist teilweise: eine Nummer ohne Ziffern ist keine."""
        await anlegen(TEIL, n="ohne", b="A", g=None)
        await anlegen(TEIL, n="auch ohne", b="B", g=None)
        zeilen = await anlegen("select count(*) as n from public.atr_teile")
        assert zeilen[0]["n"] == 2


class TestRechte:
    async def test_lesen_braucht_ein_atr_recht(self, db):
        await anlegen(TEIL, n="VR-1", b="A", g=None)
        assert len(await als(LESER, "select * from public.atr_teile")) == 1
        assert await als(FREMD, "select * from public.atr_teile") == []

    async def test_pflegen_braucht_editor(self, db):
        with pytest.raises(Exception) as fehler:
            await als(LESER, TEIL, n="VR-2", b="B", g=None)
        assert "row-level security" in str(fehler.value).lower()
        await als(PFLEGER, TEIL, n="VR-2", b="B", g=None)

    async def test_vorlage_ebenso(self, db):
        await anlegen("insert into public.atr_vorlagen (programm, kunde)"
                      " values ('A350', 'Diehl')")
        assert len(await als(LESER, "select * from public.atr_vorlagen")) == 1
        assert await als(FREMD, "select * from public.atr_vorlagen") == []
        assert await als(
            LESER, "update public.atr_vorlagen set kunde = 'X' returning programm") == []


class TestVorlage:
    async def test_ein_programm_einmal(self, db):
        await anlegen("insert into public.atr_vorlagen (programm) values ('A350')")
        with pytest.raises(Exception) as fehler:
            await anlegen("insert into public.atr_vorlagen (programm) values ('A350')")
        assert "unique" in str(fehler.value).lower() or "duplicate" in str(fehler.value).lower()

    async def test_negatives_gewicht_wird_abgelehnt(self, db):
        with pytest.raises(Exception) as fehler:
            await anlegen(TEIL, n="VR-3", b="C", g=-1)
        assert "check" in str(fehler.value).lower()

    async def test_der_eimer_ist_nicht_oeffentlich(self, db):
        zeile = (await anlegen(
            "select public, allowed_mime_types from storage.buckets where id = 'atr'"))[0]
        assert zeile["public"] is False
        assert any("spreadsheetml" in t for t in zeile["allowed_mime_types"])
