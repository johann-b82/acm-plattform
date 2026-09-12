"""Verzugsquote gegen eine echte Datenbank.

Der Rechenweg aus docs/kpi-rechenwege.md hat vier Regeln, die man beim Lesen
des SQL leicht übersieht und die deshalb je einen Test haben:

* Der Zieltermin eines Auftrags ist das **späteste** Lieferdatum seiner
  Positionen, nicht das früheste.
* Gezählt wird nur, wenn der Ausgang feststeht: geliefert **oder** Termin
  verstrichen. Ein offener Auftrag mit Termin in der Zukunft zählt nirgends.
* Ein offener, überfälliger Auftrag zählt als verspätet — sein Verzug wächst
  täglich weiter.
* Eine einzige frühe Teillieferung macht den Auftrag „geliefert". Das ist eine
  bekannte Schwäche der Quelldaten, kein Fehler der Rechnung.
"""
from __future__ import annotations

import datetime as dt

import pytest
import pytest_asyncio
import sqlalchemy as sa

from app.db import SessionLocal, auftrag_positionen, delivery_records

HEUTE = dt.date.today()


def tage(n: int) -> dt.date:
    return HEUTE + dt.timedelta(days=n)


async def _funktion(name: str, *args) -> list[dict]:
    async with SessionLocal() as session:
        platzhalter = ", ".join(f":p{i}" for i in range(len(args)))
        rows = await session.execute(
            sa.text(f"select * from public.{name}({platzhalter})"),
            {f"p{i}": v for i, v in enumerate(args)},
        )
        return [dict(r) for r in rows.mappings()]


async def _position(vorgang: str, pos: int, ziel: dt.date | None, kunde: str = "Kunde") -> None:
    async with SessionLocal() as session:
        async with session.begin():
            await session.execute(
                sa.insert(auftrag_positionen).values(
                    vorgang_nr=vorgang,
                    pos=pos,
                    upos=0,
                    typ="AUF",
                    lieferdatum=ziel,
                    customer_name=kunde,
                    imported_at=dt.datetime.now(dt.timezone.utc),
                )
            )


async def _lieferung(vorgang: str, pos: int, datum: dt.date, auftrag: str) -> None:
    async with SessionLocal() as session:
        async with session.begin():
            await session.execute(
                sa.insert(delivery_records).values(
                    vorgang_nr=vorgang,
                    pos=pos,
                    upos=0,
                    typ="LS",
                    delivery_date=datum,
                    order_nr=auftrag,
                    imported_at=dt.datetime.now(dt.timezone.utc),
                )
            )


@pytest_asyncio.fixture
async def leer(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")
    async with SessionLocal() as session:
        async with session.begin():
            await session.execute(sa.delete(delivery_records))
            await session.execute(sa.delete(auftrag_positionen))
    return True


class TestZieltermin:
    async def test_spaeteste_position_bestimmt_den_termin(self, leer):
        await _position("A-1", 10, tage(-20))
        await _position("A-1", 20, tage(-5))
        await _lieferung("L-1", 10, tage(-3), "A-1")
        (row,) = await _funktion("kpi_produktion_verzug", None, None)
        # Gegen den späteren Termin ist die Lieferung 2 Tage zu spät.
        assert row["gesamt"] == 1
        assert row["in_verzug"] == 1
        assert float(row["verzug_schnitt"]) == 2.0

    async def test_positionen_ohne_termin_zaehlen_nicht(self, leer):
        await _position("A-1", 10, tage(-20))
        await _position("A-1", 20, None)
        await _lieferung("L-1", 10, tage(-20), "A-1")
        (row,) = await _funktion("kpi_produktion_verzug", None, None)
        assert row["gesamt"] == 1
        assert row["in_verzug"] == 0

    async def test_auftrag_ganz_ohne_termin_faellt_heraus(self, leer):
        await _position("A-1", 10, None)
        (row,) = await _funktion("kpi_produktion_verzug", None, None)
        assert row["gesamt"] == 0


class TestWasGezaehltWird:
    async def test_offener_auftrag_mit_termin_in_der_zukunft_zaehlt_nicht(self, leer):
        """Weder pünktlich noch verspätet — der Ausgang steht noch nicht fest."""
        await _position("A-1", 10, tage(30))
        (row,) = await _funktion("kpi_produktion_verzug", None, None)
        assert row["gesamt"] == 0
        assert row["quote"] is None

    async def test_offener_auftrag_mit_verstrichenem_termin_ist_in_verzug(self, leer):
        await _position("A-1", 10, tage(-7))
        (row,) = await _funktion("kpi_produktion_verzug", None, None)
        assert row["gesamt"] == 1
        assert row["in_verzug"] == 1
        assert float(row["verzug_schnitt"]) == 7.0

    async def test_frueh_gelieferter_auftrag_geht_negativ_ein(self, leer):
        await _position("A-1", 10, tage(-10))
        await _lieferung("L-1", 10, tage(-13), "A-1")
        (row,) = await _funktion("kpi_produktion_verzug", None, None)
        assert row["in_verzug"] == 0
        assert float(row["verzug_schnitt"]) == -3.0

    async def test_gelieferter_auftrag_mit_termin_in_der_zukunft_zaehlt(self, leer):
        """Der Ausgang steht fest, auch wenn der Termin noch nicht da ist."""
        await _position("A-1", 10, tage(5))
        await _lieferung("L-1", 10, tage(-1), "A-1")
        (row,) = await _funktion("kpi_produktion_verzug", None, None)
        assert row["gesamt"] == 1
        assert row["in_verzug"] == 0

    async def test_teillieferung_macht_den_auftrag_geliefert(self, leer):
        """Bekannte Schwäche der Quelldaten: eine frühe Zeile genügt."""
        await _position("A-1", 10, tage(-10))
        await _position("A-1", 20, tage(-10))
        await _lieferung("L-1", 10, tage(-12), "A-1")
        (row,) = await _funktion("kpi_produktion_verzug", None, None)
        assert row["gesamt"] == 1
        assert row["in_verzug"] == 0


class TestQuote:
    async def test_quote_und_mittelwert(self, leer):
        await _position("A-1", 10, tage(-20))
        await _lieferung("L-1", 10, tage(-10), "A-1")   # 10 Tage zu spät
        await _position("A-2", 10, tage(-20))
        await _lieferung("L-2", 10, tage(-22), "A-2")   # 2 Tage zu früh
        await _position("A-3", 10, tage(-20))
        await _lieferung("L-3", 10, tage(-20), "A-3")   # pünktlich
        (row,) = await _funktion("kpi_produktion_verzug", None, None)
        assert (row["gesamt"], row["in_verzug"]) == (3, 1)
        assert float(row["quote"]) == pytest.approx(1 / 3)
        assert float(row["verzug_schnitt"]) == pytest.approx(8 / 3)

    async def test_ohne_auftraege_keine_quote(self, leer):
        (row,) = await _funktion("kpi_produktion_verzug", None, None)
        assert row["gesamt"] == 0
        assert row["quote"] is None and row["verzug_schnitt"] is None

    async def test_fenster_geht_ueber_den_zieltermin(self, leer):
        """Nicht über das Lieferdatum — sonst läge der Auftrag im falschen Monat."""
        await _position("A-1", 10, dt.date(2026, 1, 15))
        await _lieferung("L-1", 10, dt.date(2026, 3, 20), "A-1")
        im_januar = await _funktion("kpi_produktion_verzug", dt.date(2026, 1, 1), dt.date(2026, 1, 31))
        im_maerz = await _funktion("kpi_produktion_verzug", dt.date(2026, 3, 1), dt.date(2026, 3, 31))
        assert im_januar[0]["gesamt"] == 1
        assert im_maerz[0]["gesamt"] == 0


class TestListe:
    async def test_trennt_verspaetet_und_offen(self, leer):
        await _position("A-1", 10, tage(-30))
        await _lieferung("L-1", 10, tage(-20), "A-1")   # geliefert, zu spät
        await _position("A-2", 10, tage(-9))            # offen, überfällig
        zeilen = await _funktion("kpi_produktion_verzug_liste", None, None)
        nach_auftrag = {z["vorgang_nr"]: z for z in zeilen}
        assert nach_auftrag["A-1"]["art"] == "verspaetet"
        assert nach_auftrag["A-1"]["verzug_tage"] == 10   # Ist − Ziel
        assert nach_auftrag["A-2"]["art"] == "offen"
        assert nach_auftrag["A-2"]["ist"] is None
        assert nach_auftrag["A-2"]["verzug_tage"] == 9    # heute − Ziel

    async def test_puenktliche_stehen_nicht_drin(self, leer):
        await _position("A-1", 10, tage(-10))
        await _lieferung("L-1", 10, tage(-10), "A-1")
        assert await _funktion("kpi_produktion_verzug_liste", None, None) == []

    async def test_offener_auftrag_mit_termin_in_der_zukunft_steht_nicht_drin(self, leer):
        await _position("A-1", 10, tage(3))
        assert await _funktion("kpi_produktion_verzug_liste", None, None) == []

    async def test_groesster_verzug_zuerst(self, leer):
        await _position("A-1", 10, tage(-5))
        await _position("A-2", 10, tage(-40))
        zeilen = await _funktion("kpi_produktion_verzug_liste", None, None)
        assert [z["vorgang_nr"] for z in zeilen] == ["A-2", "A-1"]

    async def test_adressnummer_des_kunden(self, leer):
        """Die Referenz zeigt den Kunden mit Adress-Nr. (PRO-02)."""
        async with SessionLocal() as session:
            async with session.begin():
                await session.execute(
                    sa.insert(auftrag_positionen).values(
                        vorgang_nr="A-1", pos=10, upos=0, typ="AUF", lieferdatum=tage(-5),
                        customer_id="10042", customer_name="Kunde",
                        imported_at=dt.datetime.now(dt.timezone.utc),
                    )
                )
        (zeile,) = await _funktion("kpi_produktion_verzug_liste", None, None)
        assert zeile["adr_nr"] == "10042"

    async def test_keine_grenze(self, leer):
        """Die Tabelle blättert selbst; die Funktion schneidet nichts ab (TAB-01)."""
        async with SessionLocal() as session:
            async with session.begin():
                await session.execute(
                    sa.insert(auftrag_positionen),
                    [
                        {
                            "vorgang_nr": f"A-{i}", "pos": 10, "upos": 0, "typ": "AUF",
                            "lieferdatum": tage(-5),
                            "imported_at": dt.datetime.now(dt.timezone.utc),
                        }
                        for i in range(501)
                    ],
                )
        zeilen = await _funktion("kpi_produktion_verzug_liste", None, None)
        assert len(zeilen) == 501


class TestOffeneZaehlung:
    """„davon N offen" kommt aus SQL, nicht aus einer gekappten Liste (PRO-02)."""

    async def test_offen_zaehlt_ueberfaellige_ohne_lieferschein(self, leer):
        await _position("A-1", 10, tage(-30))
        await _lieferung("L-1", 10, tage(-20), "A-1")   # zu spät geliefert
        await _position("A-2", 10, tage(-9))            # offen, überfällig
        await _position("A-3", 10, tage(-4))            # offen, überfällig
        await _position("A-4", 10, tage(8))             # offen, noch nicht fällig
        (row,) = await _funktion("kpi_produktion_verzug", None, None)
        assert (row["in_verzug"], row["offen"], row["gesamt"]) == (3, 2, 3)

    async def test_offen_im_fenster_ueber_den_zieltermin(self, leer):
        await _position("A-1", 10, dt.date(2025, 1, 15))
        await _position("A-2", 10, dt.date(2025, 3, 15))
        (row,) = await _funktion("kpi_produktion_verzug", dt.date(2025, 1, 1), dt.date(2025, 1, 31))
        assert row["offen"] == 1


class TestGesamterBestand:
    """PRF-01/E-03: „Alles" heißt beide Grenzen offen — nicht der laufende Monat."""

    async def test_alles_umfasst_alte_und_neue_auftraege(self, leer):
        await _position("A-1", 10, dt.date(2019, 5, 1))
        await _lieferung("L-1", 10, dt.date(2019, 5, 20), "A-1")
        await _position("A-2", 10, tage(-2))
        (row,) = await _funktion("kpi_produktion_verzug", None, None)
        assert (row["gesamt"], row["in_verzug"]) == (2, 2)
        zeilen = await _funktion("kpi_produktion_verzug_liste", None, None)
        assert {z["vorgang_nr"] for z in zeilen} == {"A-1", "A-2"}
        verlauf = await _funktion("kpi_produktion_verzug_verlauf", None, None, "month")
        assert sum(z["gesamt"] for z in verlauf) == 2


class TestVerlauf:
    async def test_je_monat_mit_luecke(self, leer):
        await _position("A-1", 10, dt.date(2026, 1, 15))
        await _lieferung("L-1", 10, dt.date(2026, 1, 20), "A-1")
        await _position("A-2", 10, dt.date(2026, 3, 15))
        await _lieferung("L-2", 10, dt.date(2026, 3, 10), "A-2")
        zeilen = await _funktion("kpi_produktion_verzug_verlauf", None, None, "month")
        buckets = {z["bucket"] for z in zeilen}
        # Februar hat keine Aufträge und taucht gar nicht auf — im Diagramm
        # wird daraus eine Lücke, keine Null.
        assert dt.date(2026, 1, 1) in buckets
        assert dt.date(2026, 2, 1) not in buckets
        assert dt.date(2026, 3, 1) in buckets


class TestRechte:
    async def test_ohne_kpi_recht_keine_zeilen(self, leer):
        await _position("A-1", 10, tage(-5))
        async with SessionLocal() as session:
            trans = await session.begin()
            try:
                await session.execute(sa.text("set local role authenticated"))
                await session.execute(
                    sa.text("select set_config('request.jwt.claims', :c, true)"),
                    {"c": '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","apps":{}}'},
                )
                positionen = await session.scalar(
                    sa.text("select count(*) from public.auftrag_positionen")
                )
                sicht = await session.scalar(sa.text("select count(*) from public.auftrag_verzug"))
            finally:
                await trans.rollback()
        assert positionen == 0
        # Die Sicht läuft mit den Rechten des Aufrufers, nicht des Eigentümers.
        assert sicht == 0
