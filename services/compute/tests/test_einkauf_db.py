"""Liefertermintreue: Upload-Route und KPI-Funktionen gegen eine echte Datenbank.

Geprüft wird der Rechenweg aus docs/kpi-rechenwege.md, Abschnitt
„Liefertermintreue / OTD" — insbesondere die drei Stellen, an denen er sich
nicht von selbst versteht:

* frühe Lieferungen sind pünktlich (`verzug_tage <= 0`, nicht `= 0`),
* eine Position ohne Verzugswert zählt im Nenner, kann aber nie pünktlich
  sein und drückt damit die Quote,
* dieselbe Position verzerrt den Mittelwert nicht, weil dort nur Zeilen mit
  Wert zählen.
"""
from __future__ import annotations

import datetime as dt
import io

import pytest
import pytest_asyncio
import sqlalchemy as sa
from asgi_lifespan import LifespanManager
from httpx import ASGITransport, AsyncClient

from app.db import SessionLocal, delivery_reliability, upload_batches
from app.main import app
from tests._auth import USER_ID, mint, mint_admin

KOPF = "Auftrag\tPos\tUPos\tKundennummer\tKunde\tgeliefert\tLieferdatum\tVerzug (Tage)\tMenge\tME\tArtikel\tBezeichnung"


def datei(*zeilen: str) -> bytes:
    return ("\n".join([KOPF, *zeilen]) + "\n").encode("utf-8")


@pytest_asyncio.fixture
async def client(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")
    async with SessionLocal() as session:
        async with session.begin():
            await session.execute(sa.delete(delivery_reliability))
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


async def _hochladen(client: AsyncClient, inhalt: bytes):
    return await client.post(
        "/api/uploads/liefertreue",
        files={"file": ("dev_excel_Liefertreue_Einkauf.txt", io.BytesIO(inhalt), "text/plain")},
    )


async def _funktion(name: str, *args) -> list[dict]:
    async with SessionLocal() as session:
        platzhalter = ", ".join(f":p{i}" for i in range(len(args)))
        rows = await session.execute(
            sa.text(f"select * from public.{name}({platzhalter})"),
            {f"p{i}": v for i, v in enumerate(args)},
        )
        return [dict(r) for r in rows.mappings()]


class TestUpload:
    async def test_import_und_upsert(self, client):
        antwort = await _hochladen(
            client,
            datei(
                "A-1\t10\t0\t500\tMüller\t15.01.2026\t10.01.2026\t5\t1\tStk\tX-1\tSchraube",
                "A-1\t20\t0\t500\tMüller\t09.01.2026\t10.01.2026\t-1\t1\tStk\tX-2\tMutter",
            ),
        )
        assert antwort.status_code == 200
        koerper = antwort.json()
        assert (koerper["rows_total"], koerper["rows_inserted"], koerper["status"]) == (2, 2, "success")

        # Dieselbe Datei erneut: dieselben Positionen, keine neuen Zeilen.
        zweite = await _hochladen(
            client,
            datei(
                "A-1\t10\t0\t500\tMüller\t16.01.2026\t10.01.2026\t6\t1\tStk\tX-1\tSchraube",
                "A-1\t20\t0\t500\tMüller\t09.01.2026\t10.01.2026\t-1\t1\tStk\tX-2\tMutter",
            ),
        )
        assert zweite.json()["rows_updated"] == 2

        async with SessionLocal() as session:
            gesamt = await session.scalar(
                sa.select(sa.func.count()).select_from(delivery_reliability)
            )
            verzug = await session.scalar(
                sa.select(delivery_reliability.c.verzug_tage).where(
                    delivery_reliability.c.auftrag == "A-1",
                    delivery_reliability.c.pos == 10,
                )
            )
        assert gesamt == 2
        assert verzug == 6  # der zweite Lauf hat den Wert überschrieben

    async def test_ohne_recht_kein_upload(self, client):
        client.headers["Authorization"] = f"Bearer {mint({'kpi': 'viewer'})}"
        antwort = await _hochladen(client, datei("A-1\t10\t0\t500\tM\t15.01.2026\t10.01.2026\t1\t1\tStk\tX\tY"))
        assert antwort.status_code == 403


@pytest_asyncio.fixture
async def bestand(client):
    """Fünf Positionen mit den Fällen, auf die es ankommt."""
    await _hochladen(
        client,
        datei(
            # pünktlich, exakt am Termin
            "A-1\t10\t0\t500\tMüller\t10.01.2026\t10.01.2026\t0\t1\tStk\tX-1\tA",
            # pünktlich, zwei Tage früher
            "A-1\t20\t0\t500\tMüller\t08.01.2026\t10.01.2026\t-2\t1\tStk\tX-2\tB",
            # zu spät
            "A-2\t10\t0\t600\tWeber\t20.01.2026\t10.01.2026\t10\t1\tStk\tX-3\tC",
            # ohne Verzugswert — zählt im Nenner, nie pünktlich
            "A-2\t20\t0\t600\tWeber\t21.01.2026\t10.01.2026\t\t1\tStk\tX-4\tD",
            # anderer Monat, für das Zeitfenster
            "A-3\t10\t0\t700\tSchmidt\t15.02.2026\t10.02.2026\t5\t1\tStk\tX-5\tE",
        ),
    )
    return client


class TestQuote:
    async def test_puenktlich_heisst_verzug_kleiner_gleich_null(self, bestand):
        (row,) = await _funktion("kpi_einkauf_otd", dt.date(2026, 1, 1), dt.date(2026, 1, 31))
        assert row["gesamt"] == 4
        assert row["puenktlich"] == 2  # 0 Tage und -2 Tage
        assert float(row["quote"]) == 0.5

    async def test_position_ohne_verzugswert_drueckt_die_quote(self, bestand):
        """Sie steht im Nenner, aber nie im Zähler."""
        async with SessionLocal() as session:
            async with session.begin():
                await session.execute(
                    sa.delete(delivery_reliability).where(
                        delivery_reliability.c.verzug_tage.is_(None)
                    )
                )
        (row,) = await _funktion("kpi_einkauf_otd", dt.date(2026, 1, 1), dt.date(2026, 1, 31))
        assert row["gesamt"] == 3
        assert float(row["quote"]) == pytest.approx(2 / 3)

    async def test_mittelwert_uebergeht_zeilen_ohne_wert(self, bestand):
        """0, -2 und 10 ergeben 8/3 — die leere Zeile zählt hier nicht mit."""
        (row,) = await _funktion("kpi_einkauf_otd", dt.date(2026, 1, 1), dt.date(2026, 1, 31))
        assert float(row["verzug_schnitt"]) == pytest.approx(8 / 3)

    async def test_fenster_geht_ueber_das_ist_lieferdatum(self, bestand):
        """Nicht über den Zieltermin — die Position aus dem Februar ist draußen."""
        (row,) = await _funktion("kpi_einkauf_otd", dt.date(2026, 2, 1), dt.date(2026, 2, 28))
        assert row["gesamt"] == 1

    async def test_leeres_fenster_gibt_keine_quote(self, bestand):
        """Nenner 0 ergibt NULL, nicht 0 — das Dashboard zeigt dann einen Strich."""
        (row,) = await _funktion("kpi_einkauf_otd", dt.date(2020, 1, 1), dt.date(2020, 12, 31))
        assert row["gesamt"] == 0
        assert row["quote"] is None
        assert row["verzug_schnitt"] is None


class TestVerlauf:
    async def test_je_monat(self, bestand):
        zeilen = await _funktion("kpi_einkauf_otd_verlauf", None, None, "month")
        nach_monat = {z["bucket"]: z for z in zeilen}
        assert nach_monat[dt.date(2026, 1, 1)]["gesamt"] == 4
        assert nach_monat[dt.date(2026, 2, 1)]["gesamt"] == 1
        assert float(nach_monat[dt.date(2026, 1, 1)]["quote"]) == 0.5

    async def test_unbekannter_takt_faellt_auf_monat_zurueck(self, bestand):
        monat = await _funktion("kpi_einkauf_otd_verlauf", None, None, "month")
        unfug = await _funktion("kpi_einkauf_otd_verlauf", None, None, "jahrzehnt")
        assert [z["bucket"] for z in unfug] == [z["bucket"] for z in monat]


class TestPositionen:
    async def test_spaeteste_zuerst(self, bestand):
        zeilen = await _funktion("kpi_einkauf_positionen", dt.date(2026, 1, 1), dt.date(2026, 1, 31))
        # Ohne Verzugswert steht vorn: die Zeile braucht am ehesten einen Blick.
        assert zeilen[0]["verzug_tage"] is None
        assert zeilen[1]["verzug_tage"] == 10

    async def test_menge_einheit_und_adressnummer(self, bestand):
        """Die Liefermenge der Position (EIN-03) — nicht der Lagerbestand."""
        zeilen = await _funktion("kpi_einkauf_positionen", dt.date(2026, 2, 1), dt.date(2026, 2, 28))
        (zeile,) = zeilen
        assert float(zeile["quantity"]) == 1.0
        assert zeile["unit"] == "Stk"
        assert zeile["adr_nr"] == "700"

    async def test_keine_grenze(self, bestand):
        """Die Tabelle blättert selbst; die Funktion schneidet nichts ab (TAB-01)."""
        async with SessionLocal() as session:
            async with session.begin():
                await session.execute(
                    sa.insert(delivery_reliability),
                    [
                        {
                            "auftrag": "V-9",
                            "pos": i,
                            "upos": 0,
                            "delivered_date": dt.date(2025, 6, 1),
                            "verzug_tage": 1,
                            "imported_at": dt.datetime.now(dt.timezone.utc),
                        }
                        for i in range(1, 502)
                    ],
                )
        zeilen = await _funktion("kpi_einkauf_positionen", None, None)
        assert len(zeilen) == 5 + 501


class TestGesamterBestand:
    """PRF-01/E-03: „Alles" heißt beide Grenzen offen — nicht der laufende Monat."""

    async def test_otd_ohne_grenzen_zaehlt_alle_positionen(self, bestand):
        (row,) = await _funktion("kpi_einkauf_otd", None, None)
        assert row["gesamt"] == 5
        assert row["puenktlich"] == 2

    async def test_positionen_ohne_grenzen_sind_alle(self, bestand):
        zeilen = await _funktion("kpi_einkauf_positionen", None, None)
        assert {z["auftrag"] for z in zeilen} == {"A-1", "A-2", "A-3"}
        assert len(zeilen) == 5

    async def test_verlauf_ohne_grenzen_umfasst_alle_monate(self, bestand):
        zeilen = await _funktion("kpi_einkauf_otd_verlauf", None, None, "month")
        assert sum(z["gesamt"] for z in zeilen) == 5


class TestRechte:
    async def test_ohne_kpi_recht_keine_zeilen(self, bestand):
        """Kein Fehler, sondern ein leeres Ergebnis — so sieht RLS aus."""
        async with SessionLocal() as session:
            trans = await session.begin()
            try:
                await session.execute(sa.text("set local role authenticated"))
                await session.execute(
                    sa.text("select set_config('request.jwt.claims', :c, true)"),
                    {"c": '{"sub":"' + USER_ID + '","role":"authenticated","apps":{}}'},
                )
                anzahl = await session.scalar(
                    sa.text("select count(*) from public.delivery_reliability")
                )
            finally:
                await trans.rollback()
        assert anzahl == 0


class TestRoutenUndArten:
    """Der Pfad eines Uploads ist seine Art — sonst endet er in einem 404.

    Genau das ist beim Bau der Produktionsseite passiert: die Route hiess
    `/auftrag-positionen`, die Oberfläche schickte `auftrag_positionen`.
    """

    def test_jede_art_hat_eine_route(self):
        from app.main import app
        from app.routers.uploads import ARTEN

        pfade = {
            r.path.removeprefix("/api/uploads/")
            for r in app.routes
            if getattr(r, "path", "").startswith("/api/uploads/")
        }
        assert pfade == set(ARTEN)
