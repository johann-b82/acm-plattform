"""Personio-Abgleich: Doppellauf-Sperre und Delta-Fenster gegen eine echte DB.

Der Personio-Client ist eine Attrappe — geprüft wird nicht, was Personio
liefert, sondern dass zwei Läufe nicht gleichzeitig laufen und dass ein
Folgelauf die Anwesenheiten nur seit dem letzten Erfolg holt.
"""
from __future__ import annotations

from datetime import date, timedelta

import pytest
import pytest_asyncio
import sqlalchemy as sa

from app.db import SessionLocal
from app.personio import sync

pytestmark = pytest.mark.asyncio


class FakeKlient:
    """Merkt sich, mit welchem `seit` die Anwesenheiten geholt wurden."""

    def __init__(self) -> None:
        self.anwesenheiten_seit: date | None = None

    async def mitarbeiter(self):
        return []

    async def anwesenheiten(self, seit):
        self.anwesenheiten_seit = seit
        return []

    async def abwesenheiten(self):
        return []

    async def freistellungen(self):
        return []

    async def schliessen(self):
        return None


@pytest_asyncio.fixture
async def db(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")

    async def leeren():
        async with SessionLocal() as s:
            async with s.begin():
                await s.execute(sa.text("delete from public.personio_sync_meta"))
                await s.execute(sa.text("delete from public.personio_employees"))

    await leeren()
    yield
    await leeren()


@pytest.fixture
def fake_klient(monkeypatch) -> FakeKlient:
    fake = FakeKlient()

    async def klient():
        return fake

    monkeypatch.setattr(sync.zugang, "klient", klient)
    return fake


async def test_ein_zweiter_lauf_wird_abgewiesen(db, fake_klient):
    """Hält eine Sitzung den Riegel, startet kein zweiter Abgleich."""
    async with SessionLocal() as halter:
        gehalten = (
            await halter.execute(
                sa.text("select pg_try_advisory_lock(:k)"), {"k": sync.SPERRE_SCHLUESSEL}
            )
        ).scalar()
        assert gehalten is True
        with pytest.raises(sync.BereitsInArbeit):
            await sync.abgleichen()
        await halter.execute(
            sa.text("select pg_advisory_unlock(:k)"), {"k": sync.SPERRE_SCHLUESSEL}
        )

    # Ist der Riegel frei, läuft es wieder.
    ergebnis = await sync.abgleichen()
    assert ergebnis.status in ("ok", "teilweise")


async def test_erster_lauf_holt_das_ganze_fenster(db, fake_klient):
    """Ohne vorherigen Erfolg zählt das volle Fenster."""
    await sync.abgleichen()
    assert fake_klient.anwesenheiten_seit == date.today() - timedelta(days=sync.FENSTER_TAGE)


async def test_folgelauf_holt_nur_das_delta(db, fake_klient):
    """Nach einem geglückten Lauf vor zehn Tagen reicht das Delta seit damals
    (minus Überlappung)."""
    async with SessionLocal() as s:
        async with s.begin():
            await s.execute(
                sa.text(
                    "insert into public.personio_sync_meta (status, gelaufen_am)"
                    " values ('ok', now() - interval '10 days')"
                )
            )
    await sync.abgleichen()
    assert fake_klient.anwesenheiten_seit == date.today() - timedelta(
        days=10 + sync.DELTA_UEBERLAPP_TAGE
    )


async def test_voll_ueberspringt_das_delta(db, fake_klient):
    """`voll=True` holt trotz vorherigem Erfolg das ganze Fenster."""
    async with SessionLocal() as s:
        async with s.begin():
            await s.execute(
                sa.text(
                    "insert into public.personio_sync_meta (status, gelaufen_am)"
                    " values ('ok', now() - interval '10 days')"
                )
            )
    await sync.abgleichen(voll=True)
    assert fake_klient.anwesenheiten_seit == date.today() - timedelta(days=sync.FENSTER_TAGE)


async def test_letzter_erfolg_ignoriert_fehlerlaeufe(db):
    """Ein gescheiterter Lauf setzt den letzten Erfolg nicht zurück."""
    async with SessionLocal() as s:
        async with s.begin():
            await s.execute(
                sa.text(
                    "insert into public.personio_sync_meta (status, gelaufen_am)"
                    " values ('ok', now() - interval '10 days'),"
                    "        ('fehler', now() - interval '1 day')"
                )
            )
        erfolg = await sync.letzter_erfolg(s)
    assert erfolg is not None
    assert (date.today() - erfolg.date()).days == 10
