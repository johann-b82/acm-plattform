"""Upload-Routen und KPI-Funktionen gegen eine echte Datenbank.

Läuft nur, wenn eine Test-Datenbank erreichbar ist (docker-compose.test.yml).
Die Prüfung deckt beides ab: dass der Import die richtigen Zeilen schreibt und
dass die SQL-Funktionen die Rechenwege aus docs/kpi-rechenwege.md abbilden.
"""
from __future__ import annotations

import io
from decimal import Decimal

import pytest
import pytest_asyncio
import sqlalchemy as sa
from asgi_lifespan import LifespanManager
from httpx import ASGITransport, AsyncClient

from app.db import SessionLocal, auftraege, revenues, upload_batches
from app.main import app
from tests._auth import USER_ID, mint_admin

KOPF_RG = "Typ\tVorgang Nr.\tDatum\tAdr Nr.\tName 1\tWert"
KOPF_AUF = "Typ\tVorgang Nr.\tDatum\tAdr Nr.\tName 1\tErfasst durch\tWert"


@pytest_asyncio.fixture
async def client(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")
    async with SessionLocal() as session:
        async with session.begin():
            await session.execute(sa.delete(revenues))
            await session.execute(sa.delete(auftraege))
            await session.execute(sa.delete(upload_batches))
            # upload_batches.uploaded_by zeigt auf auth.users; in Produktion
            # existiert der Nutzer immer, im Test legen wir ihn an.
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


def datei(kopf: str, *zeilen: str) -> bytes:
    return ("\n".join([kopf, *zeilen]) + "\n").encode("utf-8")


async def _upload(client: AsyncClient, pfad: str, name: str, inhalt: bytes):
    return await client.post(
        f"/api/uploads/{pfad}",
        files={"file": (name, io.BytesIO(inhalt), "text/plain")},
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
    async def test_umsatz_import_und_upsert(self, client):
        antwort = await _upload(
            client,
            "umsatz",
            "AswKpf_RG.txt",
            datei(
                KOPF_RG,
                "RG\tR-1\t15.01.2026\t1000\tMüller GmbH\t1.000,00",
                "GS\tG-1\t20.01.2026\t1000\tMüller GmbH\t-250,00",
            ),
        )
        assert antwort.status_code == 200, antwort.text
        body = antwort.json()
        assert (body["rows_total"], body["rows_inserted"], body["rows_updated"]) == (2, 2, 0)
        assert body["status"] == "success"

        # Erneuter Upload derselben Datei: Upsert, keine Dubletten.
        zweite = await _upload(
            client,
            "umsatz",
            "AswKpf_RG.txt",
            datei(
                KOPF_RG,
                "RG\tR-1\t15.01.2026\t1000\tMüller GmbH\t1.500,00",
                "GS\tG-1\t20.01.2026\t1000\tMüller GmbH\t-250,00",
            ),
        )
        assert zweite.json()["rows_updated"] == 2
        async with SessionLocal() as session:
            summe = (await session.execute(sa.select(sa.func.sum(revenues.c.wert_eur)))).scalar_one()
            anzahl = (await session.execute(sa.select(sa.func.count()).select_from(revenues))).scalar_one()
        assert anzahl == 2
        assert summe == Decimal("1250.00")

    async def test_teilweise_fehlerhafte_datei(self, client):
        antwort = await _upload(
            client,
            "umsatz",
            "kaputt.txt",
            datei(KOPF_RG, "RG\tR-1\t15.01.2026\t1\tKunde\t100,00", "RG\tR-2\tXX\t1\tKunde\t100,00"),
        )
        body = antwort.json()
        assert body["status"] == "partial"
        assert body["rows_total"] == 1
        assert body["errors"][0]["field"] == "Datum"

    async def test_batch_wird_protokolliert(self, client):
        await _upload(client, "umsatz", "AswKpf_RG.txt", datei(KOPF_RG, "RG\tR-9\t15.01.2026\t1\tK\t5,00"))
        async with SessionLocal() as session:
            zeilen = (await session.execute(sa.select(upload_batches))).mappings().all()
        assert len(zeilen) == 1
        assert zeilen[0]["kind"] == "umsatz"
        assert zeilen[0]["filename"] == "AswKpf_RG.txt"
        assert zeilen[0]["uploaded_by"] is not None

    async def test_falsche_dateiendung(self, client):
        antwort = await _upload(client, "umsatz", "bild.png", b"nicht relevant")
        assert antwort.status_code == 422

    async def test_ohne_recht_kein_upload(self, client):
        from tests._auth import mint

        client.headers["Authorization"] = f"Bearer {mint({'kpi': 'viewer'})}"
        antwort = await _upload(client, "umsatz", "x.txt", datei(KOPF_RG))
        assert antwort.status_code == 403


class TestKennzahlen:
    @pytest_asyncio.fixture(autouse=True)
    async def daten(self, client):
        await _upload(
            client,
            "umsatz",
            "rg.txt",
            datei(
                KOPF_RG,
                "RG\tR-1\t15.01.2026\t1\tAlpha\t1.000,00",
                "RG\tR-2\t20.02.2026\t2\tBeta\t2.000,00",
                "GS\tG-1\t25.02.2026\t1\tAlpha\t-500,00",
                "RG\tR-3\t10.03.2026\t3\tGamma\t3.000,00",
            ),
        )
        await _upload(
            client,
            "auftraege",
            "auf.txt",
            datei(
                KOPF_AUF,
                "AUF\tA-1\t15.01.2026\t1\tAlpha\tSchmidt\t500,00",
                "AUF\tA-2\t20.02.2026\t2\tBeta\tSchmidt\t1.500,00",
                "AUF\tA-3\t10.03.2026\t3\tGamma\tMeier\t0,00",
            ),
        )

    async def test_summe_gutschriften_ziehen_ab(self):
        (row,) = await _funktion("kpi_vertrieb_summe", None, None)
        # 1000 + 2000 - 500 + 3000
        assert row["umsatz"] == Decimal("5500.00")
        assert row["umsatz_zeilen"] == 4

    async def test_summe_zaehlt_nur_auftraege_ueber_null(self):
        (row,) = await _funktion("kpi_vertrieb_summe", None, None)
        # A-3 mit 0 € bleibt außen vor: Mittelwert aus 500 und 1500.
        assert row["auftraege_anzahl"] == 2
        assert row["auftragswert_avg"] == Decimal("1000.00")

    async def test_zeitfenster_wirkt(self):
        import datetime as dt

        (row,) = await _funktion("kpi_vertrieb_summe", dt.date(2026, 2, 1), dt.date(2026, 2, 28))
        assert row["umsatz"] == Decimal("1500.00")  # 2000 - 500
        assert row["auftraege_anzahl"] == 1

    async def test_leeres_fenster_liefert_nullen_statt_fehler(self):
        import datetime as dt

        (row,) = await _funktion("kpi_vertrieb_summe", dt.date(2020, 1, 1), dt.date(2020, 12, 31))
        assert row["umsatz"] == Decimal("0")
        assert row["auftraege_anzahl"] == 0
        assert row["auftragswert_avg"] == Decimal("0")

    async def test_verlauf_monatlich(self):
        import datetime as dt

        rows = await _funktion("kpi_vertrieb_verlauf", None, None, "month")
        assert [(r["bucket"], r["umsatz"]) for r in rows] == [
            (dt.date(2026, 1, 1), Decimal("1000.00")),
            (dt.date(2026, 2, 1), Decimal("1500.00")),
            (dt.date(2026, 3, 1), Decimal("3000.00")),
        ]

    async def test_verlauf_unbekannter_takt_faellt_auf_monat_zurueck(self):
        assert await _funktion("kpi_vertrieb_verlauf", None, None, "unsinn") == await _funktion(
            "kpi_vertrieb_verlauf", None, None, "month"
        )

    async def test_kundenanteil_mit_rest(self):
        rows = await _funktion("kpi_vertrieb_kundenanteil", "revenues", None, None, 1)
        assert rows[0]["kunde"] == "Gamma"
        assert rows[0]["wert"] == Decimal("3000.00")
        # Anteil ist ein Bruch, kein Prozentwert.
        assert rows[0]["anteil"] == Decimal("0.5455")
        assert rows[1]["kunde"] == "Übrige"
        assert rows[1]["wert"] == Decimal("2500.00")

    async def test_kundenanteil_quelle_auftraege(self):
        rows = await _funktion("kpi_vertrieb_kundenanteil", "auftraege", None, None, 14)
        assert {r["kunde"] for r in rows} == {"Alpha", "Beta", "Gamma"}

    async def test_je_erfasser(self):
        rows = await _funktion("kpi_vertrieb_je_erfasser", None, None)
        assert rows[0]["erfasser"] == "Schmidt"
        assert rows[0]["auftraege_anzahl"] == 2
        assert rows[0]["wert_summe"] == Decimal("2000.00")
        # Der 0-€-Auftrag von Meier zählt nicht mit.
        assert all(r["erfasser"] != "Meier" for r in rows)
