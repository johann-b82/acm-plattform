"""Jede App, deren Stufe der Web-Code prüft, muss in `public.apps` stehen.

Fehlt der Eintrag, ist das doppelt unsichtbar: Auf dem Starter erscheint keine
Kachel, und weil `app_grants.app_id` auf `apps.id` verweist, lässt sich die
Stufe auch nicht vergeben — die Seite bleibt Plattform-Admins vorbehalten, die
überall `admin` bekommen. Genau so war Digital Signage monatelang erreichbar,
aber nicht zuteilbar.

Den allgemeinen Abgleich — jeder `hasLevel`-Schlüssel im Web-Code gegen die
Migrationen — macht `scripts/ci/check_apps_vollstaendig.sh`: Im compute-Bild
liegen die Web-Quellen nicht, ein Test hier würde still übersprungen.
"""
from __future__ import annotations


import pytest
import pytest_asyncio
import sqlalchemy as sa

from app.db import SessionLocal

@pytest_asyncio.fixture
async def db(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")
    yield


async def _app_kennungen() -> set[str]:
    async with SessionLocal() as s:
        return {z[0] for z in (await s.execute(sa.text("select id from public.apps"))).all()}


@pytest.mark.asyncio
async def test_signage_ist_eine_app(db):
    """Die Kachel, die 0066 nachgetragen hat."""
    async with SessionLocal() as s:
        zeile = (
            await s.execute(
                sa.text("select name, path, sort from public.apps where id = 'signage'")
            )
        ).first()
    assert zeile is not None, "public.apps kennt 'signage' nicht"
    assert zeile.path == "/signage"
    # Zwischen FAIR (80) und Uploads (90), bei den Fachmodulen.
    assert 80 < zeile.sort < 90


@pytest.mark.asyncio
async def test_signage_laesst_sich_zuteilen(db):
    """Der eigentliche Gewinn: eine Gruppe kann die Stufe bekommen."""
    async def probe_weg() -> None:
        async with SessionLocal() as s:
            async with s.begin():
                await s.execute(
                    sa.text("delete from public.groups where name = 'signage-probe'")
                )

    # Auch aufräumen, falls ein früherer Lauf abgebrochen ist: die Gruppe trägt
    # eine Eindeutigkeit auf dem Namen.
    await probe_weg()
    try:
        async with SessionLocal() as s:
            async with s.begin():
                await s.execute(
                    sa.text(
                        "with g as (insert into public.groups (name) values"
                        " ('signage-probe') returning id)"
                        " insert into public.app_grants (group_id, app_id, level)"
                        " select g.id, 'signage', 'admin' from g"
                    )
                )
        async with SessionLocal() as s:
            stufe = (
                await s.execute(
                    sa.text(
                        "select level from public.app_grants where app_id = 'signage'"
                    )
                )
            ).scalar()
        assert stufe == "admin"
    finally:
        # Die Zuweisung hängt an der Gruppe (`on delete cascade`).
        await probe_weg()
