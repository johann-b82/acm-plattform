"""Vertriebsaktivität: Uploads und KPI-Funktionen gegen eine echte Datenbank.

Rechenweg nach docs/kpi-rechenwege.md, Abschnitt „Vertriebsaktivität".
Jede Zahl hier ist von Hand nachgerechnet und im Test kommentiert — sonst
prüft der Test nur, dass die Funktion irgendetwas zurückgibt.

Der Wochen-Eimer ist ISO-Jahr und ISO-Woche. Die Testdaten liegen bewusst
über einen Jahreswechsel: der 31.12.2025 gehört zur ISO-Woche 1 des Jahres
**2026**. Wer `extract(year …)` statt `extract(isoyear …)` schreibt, bekommt
hier 2025 und der Test wird rot.
"""
from __future__ import annotations

import io
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
import pytest_asyncio
import sqlalchemy as sa
from asgi_lifespan import LifespanManager
from httpx import ASGITransport, AsyncClient

from app.db import (
    SessionLocal,
    auftraege,
    interessenten,
    offers,
    sales_contacts,
    upload_batches,
)
from app.main import app
from tests._auth import USER_ID, mint_admin

KOPF_KON = (
    "Datum\tZeit\tW-Vorlage\tAnsprechpartner\tArt\tTyp\tSt\tMitarbeiter"
    "\tName 1\tOrt\tErf. Datum\tErf. Benutzer\tTextfeld\tTyp\tVorgang Nr.\tWert"
)
KOPF_ANG = "Typ\tVorgang Nr.\tDatum\tAdr Nr.\tName 1\tOrt\tErfasst durch\tWert"
KOPF_INT = "Adress-Nr.\tAnrede Brief\tSuchbegriff\tName 1\tDatum Save"


def kontakt(datum: str, typ: str, wer: str, st: str = "1") -> str:
    return (
        f"{datum}\t09:30\t\t\tBesuch\t{typ}\t{st}\t{wer}"
        f"\tKunde AG\tBerlin\t{datum}\tADMIN\tNotiz\tANG\t4711\t0"
    )


def datei(kopf: str, *zeilen: str) -> bytes:
    return ("\n".join([kopf, *zeilen]) + "\n").encode("utf-8")


@pytest_asyncio.fixture
async def client(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")
    async with SessionLocal() as session:
        async with session.begin():
            await session.execute(sa.delete(sales_contacts))
            await session.execute(sa.delete(offers))
            await session.execute(sa.delete(interessenten))
            await session.execute(sa.delete(auftraege))
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


async def _auftrag(nr: str, datum: date, erfasser: str | None, wert: str) -> None:
    async with SessionLocal() as session:
        async with session.begin():
            await session.execute(
                sa.insert(auftraege).values(
                    vorgang_nr=nr,
                    typ="AUF",
                    datum=datum,
                    wert_eur=Decimal(wert),
                    erfasser=erfasser,
                    imported_at=datetime.now(timezone.utc),
                )
            )


class TestUpload:
    async def test_kontakte_ersetzen_statt_verdoppeln(self, client):
        """Ohne Geschäftsschlüssel: der zweite Upload desselben Zeitraums
        ersetzt, sonst zählte jeder Erstkontakt doppelt."""
        inhalt = datei(
            KOPF_KON,
            kontakt("05.01.2026", "ERS", "mm"),
            kontakt("06.01.2026", "ORT", "mm"),
        )
        erste = await _upload(client, "kontakte", "Kontakte.txt", inhalt)
        assert erste.status_code == 200, erste.text
        assert erste.json()["rows_total"] == 2

        zweite = await _upload(client, "kontakte", "Kontakte.txt", inhalt)
        assert zweite.json()["rows_updated"] == 2  # ersetzte Zeilen

        async with SessionLocal() as session:
            anzahl = (
                await session.execute(sa.select(sa.func.count()).select_from(sales_contacts))
            ).scalar_one()
        assert anzahl == 2

    async def test_kontakte_ausserhalb_des_bereichs_bleiben_stehen(self, client):
        """Ersetzt wird nur der Datumsbereich der neuen Datei."""
        await _upload(client, "kontakte", "alt.txt", datei(KOPF_KON, kontakt("05.01.2026", "ERS", "mm")))
        await _upload(client, "kontakte", "neu.txt", datei(KOPF_KON, kontakt("12.01.2026", "ERS", "mm")))
        async with SessionLocal() as session:
            anzahl = (
                await session.execute(sa.select(sa.func.count()).select_from(sales_contacts))
            ).scalar_one()
        assert anzahl == 2

    async def test_angebote_upsert_auf_vorgangsnummer(self, client):
        await _upload(
            client, "angebote", "AswKpf_ANG.txt",
            datei(KOPF_ANG, "ANG\t9001\t05.01.2026\t100\tKunde AG\tBerlin\tMM\t1.000,00"),
        )
        zweite = await _upload(
            client, "angebote", "AswKpf_ANG.txt",
            datei(KOPF_ANG, "ANG\t9001\t05.01.2026\t100\tKunde AG\tBerlin\tMM\t2.000,00"),
        )
        assert zweite.json()["rows_updated"] == 1
        async with SessionLocal() as session:
            summe = (await session.execute(sa.select(sa.func.sum(offers.c.wert_eur)))).scalar_one()
        assert summe == Decimal("2000.00")

    async def test_interessenten_upsert_auf_adressnummer(self, client):
        await _upload(client, "interessenten", "INT.txt", datei(KOPF_INT, "100\tHerr\tK\tAlt\t05.01.2026"))
        zweite = await _upload(
            client, "interessenten", "INT.txt", datei(KOPF_INT, "100\tHerr\tK\tNeu\t12.01.2026")
        )
        assert zweite.json()["rows_updated"] == 1
        async with SessionLocal() as session:
            zeile = (await session.execute(sa.select(interessenten))).mappings().one()
        assert zeile["customer_name"] == "Neu"
        assert zeile["datum_save"] == date(2026, 1, 12)

    async def test_alle_drei_arten_haben_eine_route(self, client):
        """Art und Pfad müssen gleich heißen — im Altprojekt lief ein Upload
        sonst in ein 404, während die Oberfläche „angenommen" meldete."""
        from app.routers.uploads import ARTEN

        pfade = {
            r.path.rsplit("/", 1)[-1]
            for r in app.routes
            if getattr(r, "path", "").startswith("/api/uploads/")
        }
        for art in ("kontakte", "angebote", "interessenten"):
            assert art in ARTEN
            assert art in pfade


class TestKpiAktivitaet:
    async def _grunddaten(self, client) -> None:
        """Zwei Vertriebler, zwei ISO-Wochen über den Jahreswechsel.

        KW 1/2026 läuft vom Mo 29.12.2025 bis So 04.01.2026 — der 31.12.2025
        gehört also zu ISO-Jahr 2026.
        """
        await _upload(
            client, "kontakte", "Kontakte.txt",
            datei(
                KOPF_KON,
                # KW 1/2026 — MM: 2 Erstkontakte, 1 Besuch vor Ort, 1 online
                kontakt("31.12.2025", "ERS", "mm"),
                kontakt("02.01.2026", "ERS", "mm"),
                kontakt("02.01.2026", "ORT", "mm"),
                kontakt("03.01.2026", "ONL", "mm"),
                # KW 1/2026 — SB: 1 Erstkontakt
                kontakt("02.01.2026", "ERS", "sb"),
                # KW 1/2026 — MM: nicht erledigt (St=0), zählt nicht
                kontakt("02.01.2026", "ERS", "mm", st="0"),
                # KW 2/2026 — MM: 1 Besuch vor Ort
                kontakt("07.01.2026", "ORT", "mm"),
            ),
        )
        await _upload(
            client, "angebote", "AswKpf_ANG.txt",
            datei(
                KOPF_ANG,
                # KW 1/2026 — MM: 1.000 + 500 = 1.500
                "ANG\t9001\t02.01.2026\t100\tKunde AG\tBerlin\tMM\t1.000,00",
                "ANG\t9002\t03.01.2026\t100\tKunde AG\tBerlin\tMM\t500,00",
                # KW 1/2026 — ohne Erfasser: fällt heraus
                "ANG\t9003\t03.01.2026\t100\tKunde AG\tBerlin\t\t9.999,00",
            ),
        )
        # KW 1/2026 — MM: 7.000 minus 1.000 Storno = 6.000
        await _auftrag("A-1", date(2026, 1, 2), "MM", "7000.00")
        await _auftrag("A-2", date(2026, 1, 2), "MM", "-1000.00")
        await _auftrag("A-3", date(2026, 1, 2), None, "5000.00")  # ohne Erfasser
        await _upload(
            client, "interessenten", "INT.txt",
            datei(
                KOPF_INT,
                "100\tHerr\tK\tEins\t02.01.2026",
                "101\tHerr\tK\tZwei\t03.01.2026",
                "102\tHerr\tK\tDrei\t07.01.2026",
            ),
        )

    async def test_erstkontakte_und_besuche_je_woche_und_vertriebler(self, client):
        await self._grunddaten(client)
        rows = await _funktion("kpi_vertrieb_aktivitaet", date(2025, 12, 1), date(2026, 1, 31))
        nach = {(r["iso_jahr"], r["iso_woche"], r["erfasser"]): r for r in rows}

        mm1 = nach[(2026, 1, "MM")]
        assert mm1["erstkontakte"] == 2      # 31.12. und 02.01., der mit St=0 nicht
        assert mm1["besuche_ort"] == 1
        assert mm1["besuche_onl"] == 1

        assert nach[(2026, 1, "SB")]["erstkontakte"] == 1
        assert nach[(2026, 2, "MM")]["besuche_ort"] == 1

    async def test_jahreswechsel_sitzt_in_der_iso_woche(self, client):
        """31.12.2025 gehört zu ISO-Woche 1 des Jahres 2026, nicht 2025."""
        await self._grunddaten(client)
        rows = await _funktion("kpi_vertrieb_aktivitaet", date(2025, 12, 1), date(2026, 1, 31))
        assert not [r for r in rows if r["iso_jahr"] == 2025]

    async def test_angebote_in_euro_ohne_erfasserlose(self, client):
        await self._grunddaten(client)
        rows = await _funktion("kpi_vertrieb_aktivitaet", date(2025, 12, 1), date(2026, 1, 31))
        mm1 = next(r for r in rows if (r["iso_jahr"], r["iso_woche"], r["erfasser"]) == (2026, 1, "MM"))
        assert mm1["angebote_eur"] == Decimal("1500.00")
        # Die Zeile ohne Erfasser taucht in keinem Balken auf.
        assert sum(r["angebote_eur"] for r in rows) == Decimal("1500.00")

    async def test_auftraege_ohne_positivfilter(self, client):
        """Anders als die Kacheln zählt dieser Balken Stornos mit."""
        await self._grunddaten(client)
        rows = await _funktion("kpi_vertrieb_aktivitaet", date(2025, 12, 1), date(2026, 1, 31))
        mm1 = next(r for r in rows if (r["iso_jahr"], r["iso_woche"], r["erfasser"]) == (2026, 1, "MM"))
        assert mm1["auftraege_eur"] == Decimal("6000.00")   # 7000 − 1000

    async def test_woche_ohne_kontakte_erscheint_wegen_der_angebote(self, client):
        """Die Achse ist die Vereinigung aller drei Quellen. Fehlte sie, ginge
        eine Woche verloren, in der nur Angebote geschrieben wurden."""
        await _upload(
            client, "angebote", "AswKpf_ANG.txt",
            datei(KOPF_ANG, "ANG\t9100\t20.01.2026\t100\tKunde AG\tBerlin\tXY\t400,00"),
        )
        rows = await _funktion("kpi_vertrieb_aktivitaet", date(2026, 1, 1), date(2026, 1, 31))
        eintrag = next(r for r in rows if r["erfasser"] == "XY")
        assert (eintrag["iso_jahr"], eintrag["iso_woche"]) == (2026, 4)
        assert eintrag["erstkontakte"] == 0
        assert eintrag["angebote_eur"] == Decimal("400.00")

    async def test_zeitraum_grenzt_ein(self, client):
        await self._grunddaten(client)
        rows = await _funktion("kpi_vertrieb_aktivitaet", date(2026, 1, 5), date(2026, 1, 11))
        assert {(r["iso_jahr"], r["iso_woche"]) for r in rows} == {(2026, 2)}

    async def test_interessenten_sind_global_je_woche(self, client):
        await self._grunddaten(client)
        rows = await _funktion("kpi_vertrieb_interessenten", date(2025, 12, 1), date(2026, 1, 31))
        nach = {(r["iso_jahr"], r["iso_woche"]): r["anzahl"] for r in rows}
        assert nach == {(2026, 1): 2, (2026, 2): 1}

    async def test_interessent_ohne_datum_zaehlt_nirgends(self, client):
        await _upload(client, "interessenten", "INT.txt", datei(KOPF_INT, "200\tHerr\tK\tOhne\t"))
        rows = await _funktion("kpi_vertrieb_interessenten", date(2020, 1, 1), date(2030, 1, 1))
        assert rows == []

    async def test_leerer_zeitraum_liefert_nichts(self, client):
        await self._grunddaten(client)
        rows = await _funktion("kpi_vertrieb_aktivitaet", date(2024, 1, 1), date(2024, 12, 31))
        assert rows == []


class TestZielwerte:
    async def test_fünf_zielwerte_für_den_vertrieb(self, client):
        async with SessionLocal() as session:
            rows = (
                await session.execute(
                    sa.text(
                        "select schluessel, wert, richtung from public.zielwerte"
                        " where bereich = 'vertrieb' order by sortierung"
                    )
                )
            ).mappings().all()
        assert [r["schluessel"] for r in rows] == [
            "vertrieb_erstkontakte",
            "vertrieb_besuche",
            "vertrieb_interessenten",
            "vertrieb_angebote_eur",
            "vertrieb_auftraege_eur",
        ]
        # Werte aus dem Altprojekt übernommen (docs/kpi-rechenwege.md).
        assert [int(r["wert"]) for r in rows] == [50, 3, 5, 25000, 50000]
        assert {r["richtung"] for r in rows} == {"min"}


class TestRechte:
    async def test_ohne_kpi_recht_keine_zeilen(self, client):
        """Kein Fehler, sondern ein leeres Ergebnis — so sieht RLS aus.

        Geprüft werden alle drei neuen Tabellen: eine davon ohne Policy
        wäre eine offene Tür, die im Dashboard nicht auffällt.
        """
        await _upload(client, "kontakte", "K.txt", datei(KOPF_KON, kontakt("05.01.2026", "ERS", "mm")))
        await _upload(
            client, "angebote", "A.txt",
            datei(KOPF_ANG, "ANG\t9001\t05.01.2026\t100\tKunde AG\tBerlin\tMM\t1.000,00"),
        )
        await _upload(client, "interessenten", "I.txt", datei(KOPF_INT, "100\tHerr\tK\tEins\t05.01.2026"))

        async with SessionLocal() as session:
            trans = await session.begin()
            try:
                await session.execute(sa.text("set local role authenticated"))
                await session.execute(
                    sa.text("select set_config('request.jwt.claims', :c, true)"),
                    {"c": '{"sub":"' + USER_ID + '","role":"authenticated","apps":{}}'},
                )
                zahlen = {
                    name: await session.scalar(sa.text(f"select count(*) from public.{name}"))
                    for name in ("sales_contacts", "offers", "interessenten")
                }
            finally:
                await trans.rollback()
        assert zahlen == {"sales_contacts": 0, "offers": 0, "interessenten": 0}

    async def test_mit_kpi_recht_sichtbar(self, client):
        """Gegenprobe: mit `kpi: viewer` sind dieselben Zeilen da."""
        await _upload(client, "kontakte", "K.txt", datei(KOPF_KON, kontakt("05.01.2026", "ERS", "mm")))
        async with SessionLocal() as session:
            trans = await session.begin()
            try:
                await session.execute(sa.text("set local role authenticated"))
                await session.execute(
                    sa.text("select set_config('request.jwt.claims', :c, true)"),
                    {
                        "c": '{"sub":"' + USER_ID
                        + '","role":"authenticated","apps":{"kpi":"viewer"}}'
                    },
                )
                anzahl = await session.scalar(sa.text("select count(*) from public.sales_contacts"))
            finally:
                await trans.rollback()
        assert anzahl == 1
