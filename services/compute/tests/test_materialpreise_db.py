"""Materialpreise (Wareneingang): Upload-Route und Tabelle gegen eine echte Datenbank.

Der vierzehnte Importzugang (UPL-01). Wie im Altsystem ein Upsert auf den
Geschäftsschlüssel `(Vorgang, Pos, UPos)`: eine erneut hochgeladene Zeile wird
aktualisiert, eine neue ergänzt, und was in der neuen Datei fehlt, bleibt
stehen. Der Wareneingangsimport (Reklamationsquote) und die Artikel-Preisliste
(Lager) sind eigene Tabellen und werden davon nicht berührt.
"""
from __future__ import annotations

import datetime as dt
from decimal import Decimal
from pathlib import Path

import pytest
import pytest_asyncio
import sqlalchemy as sa
from asgi_lifespan import LifespanManager
from httpx import ASGITransport, AsyncClient

from app.db import (
    SessionLocal,
    goods_receipt_records,
    material_prices,
    stock_article_prices,
    upload_batches,
)
from app.main import app
from tests._auth import USER_ID, mint, mint_admin

FIXTURES = Path(__file__).parent / "fixtures"
KOPF = "Typ\tVorgang Nr.\tPos\tUPos\tDatum\tArtnr\tBezeichnung 1\tMenge\tME\tPreis\tPos Wert"
JETZT = dt.datetime.now(dt.timezone.utc)


def datei(*zeilen: str) -> bytes:
    return ("\n".join([KOPF, *zeilen]) + "\n").encode("utf-8")


@pytest_asyncio.fixture
async def client(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")
    async with SessionLocal() as session:
        async with session.begin():
            await session.execute(sa.delete(material_prices))
            await session.execute(sa.delete(goods_receipt_records))
            await session.execute(sa.delete(stock_article_prices))
            await session.execute(sa.delete(upload_batches))
            await session.execute(
                sa.text(
                    "insert into auth.users (id, email) values (:id, :mail)"
                    " on conflict (id) do nothing"
                ),
                {"id": USER_ID, "mail": "user@example.com"},
            )
    async with LifespanManager(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            ac.headers["Authorization"] = f"Bearer {mint_admin()}"
            yield ac


async def _hochladen(client: AsyncClient, inhalt: bytes, name: str = "AswKpf_WE.txt"):
    return await client.post(
        "/api/uploads/materialpreise",
        files={"file": (name, inhalt, "text/plain")},
    )


async def _zeilen() -> dict[tuple[str, int, int], dict]:
    async with SessionLocal() as session:
        rows = (await session.execute(sa.select(material_prices))).mappings().all()
    return {(r["vorgang_nr"], r["pos"], r["upos"]): dict(r) for r in rows}


async def _anzahl(tabelle: sa.Table) -> int:
    async with SessionLocal() as session:
        return await session.scalar(sa.select(sa.func.count()).select_from(tabelle))


class TestErstimport:
    async def test_zeilen_und_protokoll(self, client):
        r = await _hochladen(client, (FIXTURES / "materialpreise_cp1252.txt").read_bytes())
        assert r.status_code == 200, r.text
        antwort = r.json()
        assert antwort["kind"] == "materialpreise"
        assert (antwort["rows_total"], antwort["rows_inserted"], antwort["rows_updated"]) == (3, 3, 0)
        assert antwort["status"] == "success"

        zeilen = await _zeilen()
        assert set(zeilen) == {("36389", 1, 0), ("36390", 1, 0), ("36390", 2, 1)}
        a100 = zeilen[("36390", 1, 0)]
        assert a100["article_name"] == "Flügelmutter M8"
        assert a100["datum"] == dt.date(2026, 7, 21)
        assert a100["pos_wert"] == Decimal("1250.00")
        assert a100["upload_batch_id"] == antwort["batch_id"]

        async with SessionLocal() as session:
            batch = (
                await session.execute(
                    sa.select(upload_batches).where(upload_batches.c.id == antwort["batch_id"])
                )
            ).mappings().one()
        assert batch["kind"] == "materialpreise"
        assert (batch["row_count"], batch["error_count"], batch["status"]) == (3, 0, "success")
        assert str(batch["uploaded_by"]) == USER_ID

    async def test_wareneingang_und_lagerpreise_bleiben_unberuehrt(self, client):
        """Dieselbe Datei, aber nicht dieselbe Tabelle — nichts wird verwechselt."""
        async with SessionLocal() as session:
            async with session.begin():
                await session.execute(
                    sa.insert(goods_receipt_records).values(
                        vorgang_nr="36390", pos=1, upos=0, typ="WE", quantity=Decimal("1"),
                        position_value=Decimal("999"), article_number="A-100", imported_at=JETZT,
                    )
                )
                await session.execute(
                    sa.insert(stock_article_prices).values(
                        artnr="A-100", unit_price=Decimal("7"), updated_at=JETZT
                    )
                )
        r = await _hochladen(client, (FIXTURES / "materialpreise_cp1252.txt").read_bytes())
        assert r.status_code == 200, r.text
        assert await _anzahl(goods_receipt_records) == 1
        assert await _anzahl(stock_article_prices) == 1
        async with SessionLocal() as session:
            wert = await session.scalar(sa.select(goods_receipt_records.c.position_value))
        assert wert == Decimal("999.00")


class TestWiederholung:
    async def test_dieselbe_datei_zweimal_verdoppelt_nichts(self, client):
        inhalt = (FIXTURES / "materialpreise_cp1252.txt").read_bytes()
        await _hochladen(client, inhalt)
        r = await _hochladen(client, inhalt)
        assert (r.json()["rows_inserted"], r.json()["rows_updated"]) == (0, 3)
        assert await _anzahl(material_prices) == 3
        assert await _anzahl(upload_batches) == 2

    async def test_teilmenge_ergaenzt_und_aktualisiert_loescht_aber_nichts(self, client):
        await _hochladen(client, (FIXTURES / "materialpreise_cp1252.txt").read_bytes())
        r = await _hochladen(
            client,
            datei(
                "WE\t36390\t1\t0\t21.07.2026\tA-100\tFlügelmutter M8\t1.000\tSTK\t13\t1.300,00",
                "WE\t36400\t1\t0\t05.08.2026\tC-1\tNeu\t2\tSTK\t4\t8,00",
            ),
        )
        assert (r.json()["rows_inserted"], r.json()["rows_updated"]) == (1, 1)
        zeilen = await _zeilen()
        assert len(zeilen) == 4
        assert zeilen[("36390", 1, 0)]["pos_wert"] == Decimal("1300.00")
        assert ("36389", 1, 0) in zeilen  # fehlte in der zweiten Datei, bleibt


class TestUngueltig:
    async def test_teilweise_uebernommen(self, client):
        r = await _hochladen(client, (FIXTURES / "materialpreise_fehler.txt").read_bytes())
        antwort = r.json()
        assert antwort["status"] == "partial"
        assert antwort["rows_total"] == 2
        assert len(antwort["errors"]) == 4
        assert await _anzahl(material_prices) == 2

    async def test_ohne_gueltige_zeile_nichts_gespeichert_aber_protokolliert(self, client):
        r = await _hochladen(client, b"Vorgang Nr.\tPos\n1\t1\n")
        assert r.status_code == 200
        assert r.json()["status"] == "failed"
        assert await _anzahl(material_prices) == 0
        async with SessionLocal() as session:
            status = await session.scalar(sa.select(upload_batches.c.status))
        assert status == "failed"

    async def test_falsche_endung(self, client):
        r = await _hochladen(client, b"x", name="AswKpf_WE.xlsx")
        assert r.status_code == 422
        assert await _anzahl(upload_batches) == 0


class TestRechte:
    @pytest.mark.parametrize(
        "apps, erwartet",
        [({"uploads": "viewer"}, 403), ({"kpi": "admin"}, 403), ({"uploads": "admin"}, 200)],
    )
    async def test_nur_uploads_admin(self, client, apps, erwartet):
        client.headers["Authorization"] = f"Bearer {mint(apps)}"
        r = await _hochladen(client, (FIXTURES / "materialpreise_utf8.txt").read_bytes())
        assert r.status_code == erwartet, r.text
        assert await _anzahl(material_prices) == (3 if erwartet == 200 else 0)

    async def test_ohne_anmeldung(self, client):
        del client.headers["Authorization"]
        r = await _hochladen(client, (FIXTURES / "materialpreise_utf8.txt").read_bytes())
        assert r.status_code == 401


class TestLesen:
    async def _lies_als(self, apps_json: str) -> int:
        async with SessionLocal() as session:
            trans = await session.begin()
            try:
                await session.execute(sa.text("set local role authenticated"))
                await session.execute(
                    sa.text("select set_config('request.jwt.claims', :c, true)"),
                    {"c": '{"sub":"' + USER_ID + '","role":"authenticated","apps":' + apps_json + "}"},
                )
                return await session.scalar(sa.text("select count(*) from public.material_prices"))
            finally:
                await trans.rollback()

    async def test_mit_kpi_recht_lesbar_ohne_keine_zeilen(self, client):
        await _hochladen(client, (FIXTURES / "materialpreise_utf8.txt").read_bytes())
        assert await self._lies_als('{"kpi":"viewer"}') == 3
        assert await self._lies_als("{}") == 0

    async def test_schreiben_nur_ueber_compute(self, client):
        async with SessionLocal() as session:
            trans = await session.begin()
            try:
                await session.execute(sa.text("set local role authenticated"))
                with pytest.raises(Exception) as fehler:
                    await session.execute(
                        sa.text(
                            "insert into public.material_prices (vorgang_nr, pos, upos, artnr)"
                            " values ('X', 1, 0, 'X')"
                        )
                    )
            finally:
                await trans.rollback()
        assert "permission denied" in str(fehler.value).lower()


# --- Erstbefuellung aus Wareneingaengen (Migration 0052) -------------------

def _backfill_sql() -> str:
    """Die UPGRADE-Anweisung aus 0052 direkt lesen, damit Test und Migration
    nicht auseinanderlaufen."""
    mig = Path(__file__).parents[1] / "alembic" / "versions" / "0052_materialpreise_erstbefuellung.py"
    return mig.read_text().split('UPGRADE = """')[1].split('"""')[0]


@pytest.mark.asyncio
async def test_erstbefuellung_aus_wareneingang(datenbank_da):
    """Ein Wareneingang ohne passenden Materialpreis wird nachgezogen; eine
    vorhandene Preiszeile mit gleichem Schluessel bleibt unangetastet."""
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")
    async with SessionLocal() as session:
        async with session.begin():
            await session.execute(sa.delete(material_prices))
            await session.execute(sa.delete(goods_receipt_records))
            await session.execute(
                goods_receipt_records.insert(),
                [
                    dict(
                        vorgang_nr="WE1", pos=1, upos=0, typ="WE",
                        entry_date=dt.date(2026, 3, 1), article_number="A100",
                        article_name="Blech", quantity=Decimal("10"), unit="KG",
                        price=Decimal("2.5"), position_value=Decimal("25"),
                        imported_at=JETZT,
                    ),
                    dict(
                        vorgang_nr="WE2", pos=1, upos=0, typ="WE",
                        entry_date=dt.date(2026, 3, 2), article_number="A200",
                        article_name="Rohr", quantity=Decimal("1"), unit="ST",
                        price=Decimal("99"), position_value=Decimal("99"),
                        imported_at=JETZT,
                    ),
                ],
            )
            await session.execute(
                material_prices.insert(),
                [dict(
                    vorgang_nr="WE2", pos=1, upos=0, typ="WE",
                    datum=dt.date(2026, 3, 2), artnr="A200", article_name="Rohr",
                    menge=Decimal("1"), unit="ST", preis=Decimal("7"),
                    pos_wert=Decimal("7"), imported_at=JETZT,
                )],
            )

        async with session.begin():
            await session.execute(sa.text(_backfill_sql()))

        rows = (
            await session.execute(
                sa.select(material_prices.c.artnr, material_prices.c.preis)
            )
        ).all()
        werte = {r.artnr: r.preis for r in rows}
        assert werte["A100"] == Decimal("2.5000")
        assert werte["A200"] == Decimal("7.0000")

        async with session.begin():
            await session.execute(sa.text(_backfill_sql()))
        anzahl = (
            await session.execute(sa.select(sa.func.count()).select_from(material_prices))
        ).scalar_one()
        assert anzahl == 2
