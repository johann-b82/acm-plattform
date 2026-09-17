"""„Auf Server speichern" gegen eine echte Datenbank.

Der Dateiserver ist eine Attrappe; geprüft wird, was der Endpunkt daraus macht:
jedes Ziel einzeln, und `abgelegt` nur, wenn alle drei stehen.
"""
from __future__ import annotations

from unittest.mock import patch

import pytest
import pytest_asyncio
import sqlalchemy as sa
from fastapi import HTTPException

from app.atr import scan as scan_modul
from app.atr.dateiserver import DateiserverFehler, Ziel
from app.db import SessionLocal
from app.routers import atr as atr_router
from tests._auth import USER_ID
from tests.test_atr_ablage import VORGABEN

PFLEGER = '{"sub":"%s","role":"authenticated","apps":{"atr":"editor"}}' % USER_ID
VERWALTUNG = '{"sub":"%s","role":"authenticated","apps":{"platform":"admin"}}' % USER_ID

ZIEL = Ziel(
    rechner="acm_file.acm.local", freigabe="Dateiablage", domaene="ACM",
    benutzer="dienst", passwort="geheim", eingang="ATR/Input",
    ausgang="ATR/Output", archiv="ATR/Archiv",
)


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


async def ausfuehren(sql: str, **params):
    async with SessionLocal() as s:
        async with s.begin():
            ergebnis = await s.execute(sa.text(sql), params)
            return [dict(r) for r in ergebnis.mappings()] if ergebnis.returns_rows else []


async def lieferung(pdf: str | None = "l/ATR.pdf") -> str:
    zeilen = await ausfuehren(
        "insert into public.atr_lieferungen"
        " (quelle_dateiname, lieferschein_nr, programm, atr_nummer, msn, mappe_pfad, pdf_pfad)"
        " values ('ls.pdf', 'LS-1', 'A380', '77', '12', 'l/ATR.xlsx', :pdf) returning id",
        pdf=pdf,
    )
    return str(zeilen[0]["id"])


async def status(lieferung_id: str) -> str:
    zeilen = await ausfuehren(
        "select status from public.atr_lieferungen where id = :id", id=lieferung_id
    )
    return zeilen[0]["status"]


async def _einstellungen():
    return VORGABEN, ZIEL


async def _datei(pfad: str, was: str = "Die Datei") -> bytes:
    return pfad.encode()


def ablauf(schreibe):
    """Einstellungen, Eimer und Dateiserver als Attrappen."""
    return (
        patch.object(scan_modul, "zugang", _einstellungen),
        patch.object(atr_router, "_hole_datei", _datei),
        patch.object(atr_router.dateiserver, "schreibe", schreibe),
    )


class TestAblegen:
    async def test_alle_ziele_stehen_dann_abgelegt(self, db):
        lid = await lieferung()
        geschrieben: list[tuple[str, str, bytes]] = []

        def schreibe(ziel, pfad, name, daten):
            geschrieben.append((pfad, name, daten))
            return name

        a, b, c = ablauf(schreibe)
        with a, b, c:
            ergebnis = await atr_router.auf_server_ablegen(lid)

        assert ergebnis.gescheitert == []
        assert len(ergebnis.abgelegt) == 3
        # Die Mappe in den A380-Ordner, das PDF in beide PDF-Ziele.
        # Der Name des Altprojekts, nicht die Lieferscheinnummer.
        assert geschrieben[0][1:] == ("ACM_ATR_WR_COC_A380_ATR-77-01_MSN 12.xlsx", b"l/ATR.xlsx")
        assert "\\A380\\" in geschrieben[0][0]
        assert [g[1] for g in geschrieben[1:]] == ["ACM_ATR_WR_COC_A380_ATR-77-01_MSN 12.pdf"] * 2
        assert await status(lid) == "abgelegt"

    async def test_ein_gescheitertes_ziel_haelt_die_anderen_nicht_auf(self, db):
        lid = await lieferung()
        versucht: list[str] = []

        def schreibe(ziel, pfad, name, daten):
            versucht.append(pfad)
            if pfad.startswith("1200 - Logistik"):
                raise DateiserverFehler("kein Zugriff")
            return name

        a, b, c = ablauf(schreibe)
        with a, b, c:
            ergebnis = await atr_router.auf_server_ablegen(lid)

        assert len(versucht) == 3
        assert [z.bezeichnung for z in ergebnis.gescheitert] == ["Logistik – Versand"]
        assert len(ergebnis.abgelegt) == 2
        # Ein fehlendes Ziel heißt: nicht ausgeliefert.
        assert await status(lid) != "abgelegt"

    async def test_ohne_pdf_gibt_es_nichts_abzulegen(self, db):
        lid = await lieferung(pdf=None)

        def schreibe(*_):
            raise AssertionError("darf nicht schreiben")

        a, b, c = ablauf(schreibe)
        with a, b, c, pytest.raises(HTTPException) as fehler:
            await atr_router.auf_server_ablegen(lid)
        assert fehler.value.status_code == 400

    async def test_unbekannte_lieferung(self, db):
        with pytest.raises(HTTPException) as fehler:
            await atr_router.auf_server_ablegen("00000000-0000-0000-0000-000000000000")
        assert fehler.value.status_code == 404


async def als(claims: str, sql: str):
    async with SessionLocal() as s:
        trans = await s.begin()
        try:
            await s.execute(sa.text("set local role authenticated"))
            await s.execute(
                sa.text("select set_config('request.jwt.claims', :c, true)"), {"c": claims}
            )
            ergebnis = await s.execute(sa.text(sql))
            return [dict(r) for r in ergebnis.mappings()] if ergebnis.returns_rows else []
        finally:
            await trans.rollback()


SPALTEN = tuple(VORGABEN)


class TestZieleInDenEinstellungen:
    async def test_vorbelegt_mit_den_pfaden_des_altprojekts(self, db):
        """Zeichen für Zeichen — sonst legt eine frische Plattform still neben
        die Ordner, in denen QS und Logistik suchen."""
        async with SessionLocal() as s:
            vorgaben = {
                z["column_name"]: z["column_default"]
                for z in (
                    await s.execute(
                        sa.text(
                            "select column_name, column_default"
                            " from information_schema.columns"
                            " where table_schema = 'public' and table_name = 'atr_scan'"
                        )
                    )
                ).mappings()
            }
        for spalte, pfad in VORGABEN.items():
            assert vorgaben[spalte] == f"'{pfad}'::character varying", spalte

    @pytest.mark.parametrize(
        "wert",
        [
            "",
            "   ",
            r"A\..\B",
            "../B",
            r"A\..",
            r"A\{jahr",
            r"A\{monat}",
            r"A\}",
        ],
    )
    async def test_die_datenbank_weist_ab(self, db, wert):
        for spalte in SPALTEN:
            with pytest.raises(Exception, match="gueltig"):
                async with SessionLocal() as s:
                    async with s.begin():
                        await s.execute(
                            sa.text(f"update public.atr_scan set {spalte} = :w"), {"w": wert}
                        )

    @pytest.mark.parametrize("wert", [r"A\B..C\{jahr}\KW {kw}", "A/B", "Ordner ..x"])
    async def test_gewoehnliche_pfade_gehen_durch(self, db, wert):
        async with SessionLocal() as s:
            trans = await s.begin()
            await s.execute(sa.text("update public.atr_scan set ziel_logistik = :w"), {"w": wert})
            await trans.rollback()

    async def test_nur_die_verwaltung_setzt_die_ziele(self, db):
        sql = "update public.atr_scan set ziel_logistik = 'X' where id returning ziel_logistik"
        assert await als(PFLEGER, sql) == []
        assert await als(VERWALTUNG, sql) == [{"ziel_logistik": "X"}]
