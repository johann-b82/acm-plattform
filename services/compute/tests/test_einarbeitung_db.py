"""Einarbeitung und Logo gegen eine echte Datenbank."""
from __future__ import annotations

import pytest
import pytest_asyncio
import sqlalchemy as sa

from app.db import SessionLocal
from tests._auth import USER_ID

LESER = '{"sub":"%s","role":"authenticated","apps":{"hr":"viewer"}}' % USER_ID
PFLEGER = '{"sub":"%s","role":"authenticated","apps":{"hr":"editor"}}' % USER_ID
VERWALTUNG = '{"sub":"%s","role":"authenticated","apps":{"platform":"admin"}}' % USER_ID
FREMD = '{"sub":"%s","role":"authenticated","apps":{"kpi":"admin"}}' % USER_ID


@pytest_asyncio.fixture
async def db(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")

    async def leeren():
        async with SessionLocal() as s:
            async with s.begin():
                await s.execute(sa.text("delete from public.einarbeitung_katalog"))
                await s.execute(
                    sa.text("update public.plattform_logo set pfad=null, mime=null")
                )

    await leeren()
    async with SessionLocal() as s:
        async with s.begin():
            await s.execute(
                sa.text(
                    "insert into public.einarbeitung_katalog (inhalt, ansprechpartner)"
                    " values ('Sicherheitsunterweisung', 'Frau Meier')"
                )
            )
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


class TestRechte:
    @pytest.mark.asyncio
    async def test_wer_personal_hat_sieht_den_katalog(self, db):
        assert len(await als(LESER, "select inhalt from public.einarbeitung_katalog")) == 1

    @pytest.mark.asyncio
    async def test_ohne_personal_bleibt_er_unsichtbar(self, db):
        assert await als(FREMD, "select inhalt from public.einarbeitung_katalog") == []

    @pytest.mark.asyncio
    async def test_ein_leser_darf_nicht_pflegen(self, db):
        with pytest.raises(Exception, match="row-level security|violates"):
            await als(LESER, "insert into public.einarbeitung_katalog (inhalt) values ('X')")

    @pytest.mark.asyncio
    async def test_derselbe_inhalt_steht_je_abteilung_nur_einmal(self, db):
        async with SessionLocal() as s:
            async with s.begin():
                inhalt = (
                    await s.execute(sa.text("select id from public.einarbeitung_katalog limit 1"))
                ).scalar()
                await s.execute(
                    sa.text(
                        "insert into public.einarbeitung_pflicht (einarbeitung_id, abteilung)"
                        " values (:i, 'Production')"
                    ),
                    {"i": inhalt},
                )
                with pytest.raises(Exception, match="duplicate|eindeutig"):
                    await s.execute(
                        sa.text(
                            "insert into public.einarbeitung_pflicht"
                            " (einarbeitung_id, abteilung) values (:i, 'Production')"
                        ),
                        {"i": inhalt},
                    )


class TestLogo:
    @pytest.mark.asyncio
    async def test_jeder_angemeldete_sieht_es(self, db):
        """Es steht auf jedem Formblatt — es zu verstecken hätte keinen Zweck."""
        assert len(await als(FREMD, "select pfad from public.plattform_logo")) == 1

    @pytest.mark.asyncio
    async def test_nur_die_verwaltung_darf_es_setzen(self, db):
        assert await als(
            PFLEGER,
            "update public.plattform_logo set pfad = 'x' where id returning pfad",
        ) == []
        assert await als(
            VERWALTUNG,
            "update public.plattform_logo set pfad = 'x' where id returning pfad",
        ) == [{"pfad": "x"}]

    @pytest.mark.asyncio
    async def test_nur_raster_als_typ(self, db):
        """Ein SVG müsste gereinigt werden; openpyxl könnte es ohnehin nicht
        einbetten. Der Fall entfällt, statt behandelt zu werden."""
        async with SessionLocal() as s:
            with pytest.raises(Exception, match="check|mime"):
                async with s.begin():
                    await s.execute(
                        sa.text(
                            "update public.plattform_logo set mime = 'image/svg+xml'"
                        )
                    )
