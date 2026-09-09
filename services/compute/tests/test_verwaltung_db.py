"""Rechteverwaltung gegen eine echte Datenbank.

Die Oberfläche unter /platform schreibt direkt über PostgREST. Was sie darf,
entscheiden allein die Policies aus 0001 und die Sicht aus 0003 — deshalb
prüfen diese Tests die Datenbank, nicht das Frontend.
"""
from __future__ import annotations

import json
import uuid

import pytest
import sqlalchemy as sa

from app.db import SessionLocal, upload_batches

pytestmark = pytest.mark.asyncio

ADMIN_CLAIMS = {"role": "authenticated", "apps": {"platform": "admin"}}
FREMD_CLAIMS = {"role": "authenticated", "apps": {"quality": "editor"}}


async def als_angemeldeter(claims: dict, sql: str, **params):
    """Führt `sql` als Rolle `authenticated` mit diesen Ansprüchen aus.

    Alles läuft in einer Transaktion, die am Ende zurückgerollt wird: die
    Rollenumschaltung bleibt lokal und Schreibversuche hinterlassen nichts.
    """
    async with SessionLocal() as session:
        trans = await session.begin()
        try:
            claims = {"sub": str(uuid.uuid4()), **claims}
            await session.execute(sa.text("set local role authenticated"))
            await session.execute(
                sa.text("select set_config('request.jwt.claims', :c, true)"),
                {"c": json.dumps(claims)},
            )
            ergebnis = await session.execute(sa.text(sql), params)
            return [dict(r) for r in ergebnis.mappings()]
        finally:
            await trans.rollback()


@pytest.fixture
def db(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")


class TestNutzerliste:
    """`plattform_nutzer` öffnet auth.users — aber nur für Plattform-Admins."""

    async def test_admin_sieht_nutzer(self, db):
        async with SessionLocal() as session:
            async with session.begin():
                await session.execute(
                    sa.text(
                        "insert into auth.users (id, email) values (:id, :mail)"
                        " on conflict (id) do nothing"
                    ),
                    {"id": "22222222-2222-2222-2222-222222222222", "mail": "sicht@example.com"},
                )
        zeilen = await als_angemeldeter(
            ADMIN_CLAIMS, "select email from public.plattform_nutzer where email = :m",
            m="sicht@example.com",
        )
        assert [z["email"] for z in zeilen] == ["sicht@example.com"]

    async def test_ohne_plattformrecht_bleibt_die_liste_leer(self, db):
        """Kein Fehler, sondern null Zeilen — sonst verrät die Sicht ihre Existenz."""
        zeilen = await als_angemeldeter(FREMD_CLAIMS, "select id from public.plattform_nutzer")
        assert zeilen == []


class TestPolicies:
    async def test_fremder_sieht_keine_gruppen(self, db):
        zeilen = await als_angemeldeter(FREMD_CLAIMS, "select id from public.groups")
        assert zeilen == []

    async def test_fremder_darf_keine_gruppe_anlegen(self, db):
        with pytest.raises(Exception, match="row-level security"):
            await als_angemeldeter(
                FREMD_CLAIMS, "insert into public.groups (name) values ('darf-nicht')"
            )

    async def test_fremder_darf_kein_recht_vergeben(self, db):
        async with SessionLocal() as session:
            async with session.begin():
                await session.execute(
                    sa.text("insert into public.groups (name) values ('rechte-probe')"
                            " on conflict (name) do nothing")
                )
        try:
            with pytest.raises(Exception, match="row-level security"):
                await als_angemeldeter(
                    FREMD_CLAIMS,
                    "insert into public.app_grants (group_id, app_id, level)"
                    " values ((select id from public.groups where name = 'rechte-probe'),"
                    "         (select id from public.apps order by sort limit 1), 'admin')",
                )
        finally:
            async with SessionLocal() as session:
                async with session.begin():
                    await session.execute(
                        sa.text("delete from public.groups where name = 'rechte-probe'")
                    )

    async def test_admin_darf_gruppe_anlegen_und_recht_vergeben(self, db):
        zeilen = await als_angemeldeter(
            ADMIN_CLAIMS,
            "with g as (insert into public.groups (name) values ('probe') returning id)"
            " insert into public.app_grants (group_id, app_id, level)"
            " select g.id, a.id, 'editor' from g, public.apps a where a.sort ="
            " (select min(sort) from public.apps) returning level",
        )
        assert [z["level"] for z in zeilen] == ["editor"]


class TestAufraeumen:
    async def test_alte_protokolle_verschwinden_neue_bleiben(self, db):
        async with SessionLocal() as session:
            async with session.begin():
                await session.execute(sa.delete(upload_batches))
                await session.execute(
                    sa.text(
                        "insert into public.upload_batches"
                        " (filename, uploaded_at, kind, row_count, error_count, status)"
                        " values ('alt.txt', now() - interval '400 days', 'umsatz', 1, 0, 'success'),"
                        "        ('neu.txt', now() - interval '10 days', 'umsatz', 1, 0, 'success')"
                    )
                )
            geloescht = await session.scalar(
                sa.text("select public.aufraeumen_upload_batches()")
            )
            uebrig = await session.scalars(sa.select(upload_batches.c.filename))
            assert geloescht == 1
            assert list(uebrig) == ["neu.txt"]

    async def test_angemeldete_duerfen_den_job_nicht_ausloesen(self, db):
        with pytest.raises(Exception, match="permission denied"):
            await als_angemeldeter(
                ADMIN_CLAIMS, "select public.aufraeumen_upload_batches()"
            )
