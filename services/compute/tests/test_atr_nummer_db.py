"""Die laufende ATR-Nummer gegen eine echte Datenbank.

Wie im Altprojekt (`compute_next_atr_number`): die höchste bereits vergebene
Nummer plus eins, **je Programmfamilie** — A350 und A380 haben getrennte
Nummernkreise. Wer von Hand etwas einträgt, behält es.

Eine doppelte Nummer fällt niemandem auf: zwei ATR tragen dieselbe, und die
Ablage legt sie nebeneinander in denselben Jahresordner.
"""
from __future__ import annotations

import pytest
import pytest_asyncio
import sqlalchemy as sa

from app.atr import nummer as nummer_modul
from app.db import SessionLocal


@pytest_asyncio.fixture
async def db(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")

    async def leeren():
        async with SessionLocal() as s:
            async with s.begin():
                await s.execute(sa.text("delete from public.atr_lieferungen"))

    await leeren()
    yield
    await leeren()


async def lieferung(programm: str | None, atr_nummer: str | None) -> None:
    async with SessionLocal() as s:
        async with s.begin():
            await s.execute(
                sa.text(
                    "insert into public.atr_lieferungen (quelle_dateiname, programm, atr_nummer)"
                    " values ('ls.pdf', :p, :n)"
                ),
                {"p": programm, "n": atr_nummer},
            )


class TestNaechsteNummer:
    async def test_ohne_lieferungen_gibt_es_keinen_vorschlag(self, db):
        """Die erste Nummer setzt jemand von Hand — geraten wird nicht."""
        assert await nummer_modul.naechste("A350") is None

    async def test_hoechste_plus_eins(self, db):
        for n in ("4820", "4963", "4901"):
            await lieferung("A350", n)
        assert await nummer_modul.naechste("A350") == "4964"

    async def test_die_familien_zaehlen_getrennt(self, db):
        await lieferung("A350 XWB", "4963")
        await lieferung("A380-800", "120")
        assert await nummer_modul.naechste("A350") == "4964"
        assert await nummer_modul.naechste("A380") == "121"

    async def test_die_schreibweise_des_programms_ist_egal(self, db):
        """Die Quelle schreibt „A 380", „A380-800", „a380" — wie bei den
        Ablagezielen entscheidet die Ziffernfolge."""
        await lieferung("A 380", "7")
        assert await nummer_modul.naechste("a380-800") == "8"

    async def test_nicht_numerische_nummern_zaehlen_nicht(self, db):
        await lieferung("A350", "4963")
        await lieferung("A350", "S-2024/1")
        await lieferung("A350", "")
        assert await nummer_modul.naechste("A350") == "4964"

    async def test_ohne_programm_gilt_a350(self, db):
        """Wie in `programmfamilie` und bei den Zielen: ohne Angabe A350."""
        await lieferung("A350", "12")
        assert await nummer_modul.naechste(None) == "13"


class TestVergabeBeimErzeugen:
    """Vergeben wird beim Erzeugen, nicht beim Anlegen — wie im Altprojekt.

    Die schweren Teile (Gerüst holen, Excel bauen, PDF, Eimer) sind Attrappen;
    geprüft wird allein, welche Nummer in der Zeile landet.
    """

    async def _erzeuge(self, lieferung_id: str):
        from unittest.mock import patch

        from app.routers import atr as atr_router

        async def geruest(_pfad):
            return b"XLSX"

        async def ablegen(pfad, _daten, _typ):
            return pfad

        async def pdf(_daten, name=""):
            return b"PDF"

        with patch.object(atr_router, "_hole_geruest", geruest), patch.object(
            atr_router, "baue_atr", lambda *a, **k: b"XLSX"
        ), patch.object(atr_router, "baue_etikett", lambda *a, **k: b"DOCX"), patch.object(
            atr_router, "ablegen", ablegen
        ), patch.object(atr_router, "nach_pdf", pdf):
            return await atr_router._erzeuge(lieferung_id)

    async def _vorbereiten(self, programm: str, atr_nummer: str | None) -> str:
        async with SessionLocal() as s:
            async with s.begin():
                lieferung_id = str(
                    (
                        await s.execute(
                            sa.text(
                                "insert into public.atr_lieferungen"
                                " (quelle_dateiname, programm, atr_nummer)"
                                " values ('ls.pdf', :p, :n) returning id"
                            ),
                            {"p": programm, "n": atr_nummer},
                        )
                    ).scalar()
                )
                await s.execute(
                    sa.text(
                        "insert into public.atr_positionen"
                        " (lieferung_id, reihenfolge, teilenummer, menge)"
                        " values (:l, 1, 'T-1', 1)"
                    ),
                    {"l": lieferung_id},
                )
                await s.execute(
                    sa.text(
                        "insert into public.atr_vorlagen (programm, geruest_pfad)"
                        " values (:p, 'geruest.xlsx')"
                        " on conflict (programm) do update set geruest_pfad = 'geruest.xlsx'"
                    ),
                    {"p": "A380" if "380" in programm else "A350"},
                )
        return lieferung_id

    async def _nummer(self, lieferung_id: str) -> str | None:
        async with SessionLocal() as s:
            return (
                await s.execute(
                    sa.text("select atr_nummer from public.atr_lieferungen where id = :i"),
                    {"i": lieferung_id},
                )
            ).scalar()

    async def test_leeres_feld_bekommt_die_naechste_nummer(self, db):
        await lieferung("A350", "4963")
        neue = await self._vorbereiten("A350", None)
        await self._erzeuge(neue)
        assert await self._nummer(neue) == "4964"

    async def test_eine_eingetragene_nummer_bleibt(self, db):
        await lieferung("A350", "4963")
        neue = await self._vorbereiten("A350", "S-2024/1")
        await self._erzeuge(neue)
        assert await self._nummer(neue) == "S-2024/1"

    async def test_zwei_lieferungen_bekommen_verschiedene_nummern(self, db):
        """Ohne Vergabe beim Erzeugen trügen beide dieselbe."""
        await lieferung("A350", "10")
        eins = await self._vorbereiten("A350", None)
        zwei = await self._vorbereiten("A350", None)
        await self._erzeuge(eins)
        await self._erzeuge(zwei)
        assert sorted([await self._nummer(eins), await self._nummer(zwei)]) == ["11", "12"]
