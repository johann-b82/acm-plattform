"""8D-Parser und Audit-Kennzahlen.

Die eine Stelle, an der die Quelle überrascht: das Level eines Audit-Befunds
steht nicht in einer Spalte, sondern im Freitext „Artikel". Alles darum herum
hängt daran.
"""
from __future__ import annotations

import datetime as dt
from decimal import Decimal

import pytest
import pytest_asyncio
import sqlalchemy as sa

from app.db import SessionLocal, quality_records
from app.parsing.qualitaet import level_aus_text, parse_8d

SPALTEN = [
    "Nr.", "Datum", "Art", "Artikel", "Aussteller", "Adressen", "Adress Nr.",
    "Bezeichnung", "Status", "Problembeschreibung", "Ursache", "Menge",
    "akzeptierte Menge", "gelöscht",
]


def zeile(**werte) -> str:
    return "\t".join(str(werte.get(s, "")) for s in SPALTEN)


def datei(*zeilen: str, kodierung: str = "utf-8") -> bytes:
    return ("\n".join(["\t".join(SPALTEN), *zeilen]) + "\n").encode(kodierung)


class TestLevelAusFreitext:
    @pytest.mark.parametrize(
        "text,erwartet",
        [
            ("Audit Major Level 1", 1),
            ("audit major abweichung level 1", 1),
            ("Audit Minor Level 2", 2),
            ("MINOR  ---  LEVEL 2", 2),
            ("Audit Major Level1", 1),
            ("", None),
            ("Reklamation Kunde", None),
            ("Major", None),
            ("Level 1", None),
        ],
    )
    def test_ableitung(self, text, erwartet):
        assert level_aus_text(text) == erwartet

    def test_major_gewinnt_wenn_beides_dasteht(self):
        """Erst Major prüfen, dann Minor — sonst hinge es an der Reihenfolge im Text."""
        assert level_aus_text("Major Level 1 und Minor Level 2") == 1


class TestParser:
    def test_zeile_wird_uebernommen(self):
        (row,), fehler = parse_8d(
            datei(
                zeile(**{
                    "Nr.": "8D-1", "Datum": "15.03.2026", "Art": "BH AUD",
                    "Artikel": "Audit Major Level 1", "Adressen": "Müller GmbH",
                    "Menge": "120,5", "akzeptierte Menge": "100",
                })
            )
        )
        assert fehler == []
        assert row["report_nr"] == "8D-1"
        assert row["report_date"] == dt.date(2026, 3, 15)
        assert row["art"] == "BH AUD"
        assert row["level"] == 1
        assert row["quantity"] == Decimal("120.5")
        assert row["accepted_quantity"] == Decimal("100")

    def test_geloeschte_berichte_kommen_nicht_mit(self):
        """In der Quelle sind sie nur markiert, nicht entfernt."""
        rows, fehler = parse_8d(
            datei(
                zeile(**{"Nr.": "8D-1", "Datum": "15.03.2026", "gelöscht": "J"}),
                zeile(**{"Nr.": "8D-2", "Datum": "15.03.2026", "gelöscht": ""}),
            )
        )
        assert [r["report_nr"] for r in rows] == ["8D-2"]
        assert fehler == []

    def test_reklamationen_kommen_mit(self):
        """Sie stehen in derselben Datei und speisen später die Fehlerquote."""
        (row,), _ = parse_8d(
            datei(zeile(**{"Nr.": "8D-9", "Datum": "01.04.2026", "Art": "KUNRE", "Artikel": "Reklamation"}))
        )
        assert row["art"] == "KUNRE"
        assert row["level"] is None

    def test_fehlende_menge_bleibt_leer(self):
        """Nicht 0 — sonst zählte die Zeile in der Fehlerquote fälschlich mit."""
        (row,), _ = parse_8d(datei(zeile(**{"Nr.": "8D-1", "Datum": "15.03.2026"})))
        assert row["quantity"] is None

    def test_fehlerzeilen(self):
        rows, fehler = parse_8d(
            datei(
                zeile(**{"Nr.": "", "Datum": "15.03.2026"}),
                zeile(**{"Nr.": "8D-2", "Datum": "kein Datum"}),
                zeile(**{"Nr.": "8D-3", "Datum": "15.03.2026"}),
                zeile(**{"Nr.": "8D-3", "Datum": "16.03.2026"}),
            )
        )
        assert [r["report_nr"] for r in rows] == ["8D-3"]
        assert [f["field"] for f in fehler] == ["Nr.", "Datum", "Nr."]

    def test_fehlende_pflichtspalte(self):
        rows, fehler = parse_8d(b"Nr.\tArt\n8D-1\tBH AUD\n")
        assert rows == [] and fehler[0]["field"] == "header"

    def test_cp1252(self):
        (row,), fehler = parse_8d(
            datei(zeile(**{"Nr.": "8D-1", "Datum": "15.03.2026", "Adressen": "Müller & Söhne"}), kodierung="cp1252")
        )
        assert fehler == [] and row["customer_name"] == "Müller & Söhne"


async def _funktion(name: str, *args: tuple[object, str]) -> list[dict]:
    """SQL-Funktion aufrufen; je Argument Wert und Typ.

    Der Typ muss mit: bei mehreren NULL-Argumenten kann Postgres sonst nicht
    entscheiden, welche Funktion gemeint ist, und meldet „does not exist".
    """
    async with SessionLocal() as session:
        platzhalter = ", ".join(f"cast(:p{i} as {typ})" for i, (_, typ) in enumerate(args))
        rows = await session.execute(
            sa.text(f"select * from public.{name}({platzhalter})"),
            {f"p{i}": wert for i, (wert, _) in enumerate(args)},
        )
        return [dict(r) for r in rows.mappings()]


D = "date"
T = "text[]"
I = "int"
S = "text"


@pytest_asyncio.fixture
async def bestand(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")
    zeilen = [
        ("A-1", dt.date(2026, 1, 10), "BH AUD", 1),
        ("A-2", dt.date(2026, 1, 20), "BH AUD", 2),
        ("A-3", dt.date(2026, 2, 5), "KU AUD", 1),
        ("A-4", dt.date(2026, 2, 15), "EX AUD", None),   # Level nicht erkannt
        ("A-5", dt.date(2026, 3, 1), "KUNRE", None),     # Reklamation, kein Audit
    ]
    async with SessionLocal() as session:
        async with session.begin():
            await session.execute(sa.delete(quality_records))
            await session.execute(
                sa.insert(quality_records),
                [
                    {
                        "report_nr": nr,
                        "report_date": datum,
                        "art": art,
                        "level": level,
                        "imported_at": dt.datetime.now(dt.timezone.utc),
                    }
                    for nr, datum, art, level in zeilen
                ],
            )
    return True


class TestAuditKennzahlen:
    async def test_zaehlt_je_level(self, bestand):
        (row,) = await _funktion("kpi_qualitaet_audits", (None, D), (None, D), (None, T))
        assert (row["level_1"], row["level_2"]) == (2, 1)

    async def test_reklamationen_zaehlen_nicht_mit(self, bestand):
        """Nur die vier Audit-Codes, obwohl alles in derselben Tabelle liegt."""
        (row,) = await _funktion("kpi_qualitaet_audits", (None, D), (None, D), (None, T))
        assert row["level_1"] + row["level_2"] + row["ohne_level"] == 4

    async def test_zeilen_ohne_level_werden_ausgewiesen(self, bestand):
        (row,) = await _funktion("kpi_qualitaet_audits", (None, D), (None, D), (None, T))
        assert row["ohne_level"] == 1

    async def test_filter_auf_eine_art(self, bestand):
        (row,) = await _funktion("kpi_qualitaet_audits", (None, D), (None, D), (["BH AUD"], T))
        assert (row["level_1"], row["level_2"]) == (1, 1)

    async def test_unbekannte_art_im_filter_zaehlt_nichts(self, bestand):
        """Kein Fehler, aber auch kein Ergebnis — der Code ist kein Audit-Code."""
        (row,) = await _funktion("kpi_qualitaet_audits", (None, D), (None, D), (["KUNRE"], T))
        assert (row["level_1"], row["level_2"], row["ohne_level"]) == (0, 0, 0)

    async def test_zeitfenster(self, bestand):
        (row,) = await _funktion("kpi_qualitaet_audits", (dt.date(2026, 2, 1), D), (dt.date(2026, 2, 28), D), (None, T))
        assert (row["level_1"], row["level_2"], row["ohne_level"]) == (1, 0, 1)


class TestVerlauf:
    async def test_schluesselt_nach_art_auf(self, bestand):
        zeilen = await _funktion("kpi_qualitaet_audits_verlauf", (None, D), (None, D), ("month", S), (None, T))
        januar = [z for z in zeilen if z["bucket"] == dt.date(2026, 1, 1)]
        assert len(januar) == 1 and januar[0]["art"] == "BH AUD"
        assert (januar[0]["level_1"], januar[0]["level_2"]) == (1, 1)

    async def test_summe_der_aufschluesselung_ist_der_bucketwert(self, bestand):
        zeilen = await _funktion("kpi_qualitaet_audits_verlauf", (None, D), (None, D), ("month", S), (None, T))
        gesamt = sum(z["level_1"] + z["level_2"] for z in zeilen)
        (row,) = await _funktion("kpi_qualitaet_audits", (None, D), (None, D), (None, T))
        assert gesamt == row["level_1"] + row["level_2"]


class TestFindingsListe:
    """Die Tabelle unter den Audit-Kacheln: alle Audit-Berichte im Fenster, auch
    die ohne erkanntes Level — aus ihnen liest die Oberfläche die Diagnoseliste."""

    async def test_alle_audits_auch_ohne_level(self, bestand):
        zeilen = await _funktion("kpi_qualitaet_audits_liste", (None, D), (None, D), (None, T))
        assert sorted(z["report_nr"] for z in zeilen) == ["A-1", "A-2", "A-3", "A-4"]
        nach = {z["report_nr"]: z["level"] for z in zeilen}
        assert nach["A-4"] is None and nach["A-1"] == 1

    async def test_so_viele_zeilen_wie_die_kacheln_zaehlen(self, bestand):
        zeilen = await _funktion("kpi_qualitaet_audits_liste", (None, D), (None, D), (None, T))
        (row,) = await _funktion("kpi_qualitaet_audits", (None, D), (None, D), (None, T))
        assert len(zeilen) == row["level_1"] + row["level_2"] + row["ohne_level"]

    async def test_folgt_dem_artfilter_und_dem_fenster(self, bestand):
        zeilen = await _funktion(
            "kpi_qualitaet_audits_liste", (dt.date(2026, 1, 1), D), (dt.date(2026, 1, 31), D), (["BH AUD"], T)
        )
        assert [z["report_nr"] for z in zeilen] == ["A-2", "A-1"]   # neueste zuerst

    async def test_traegt_die_referenzspalten(self, bestand):
        async with SessionLocal() as session:
            async with session.begin():
                await session.execute(
                    sa.insert(quality_records).values(
                        report_nr="A-9", report_date=dt.date(2026, 4, 1), art="IN AUD", level=2,
                        issuer="Qualität", customer_name="Werk Nord", customer_id="K-7",
                        designation="Kennzeichnung fehlt", status_code="isignal_flag_green",
                        imported_at=dt.datetime.now(dt.timezone.utc),
                    )
                )
        (zeile,) = await _funktion(
            "kpi_qualitaet_audits_liste", (dt.date(2026, 4, 1), D), (dt.date(2026, 4, 1), D), (None, T)
        )
        assert zeile == {
            "report_nr": "A-9", "report_date": dt.date(2026, 4, 1), "art": "IN AUD", "level": 2,
            "issuer": "Qualität", "customer_name": "Werk Nord", "customer_id": "K-7",
            "designation": "Kennzeichnung fehlt", "status_code": "isignal_flag_green",
        }

    async def test_ohne_obergrenze(self, bestand):
        async with SessionLocal() as session:
            async with session.begin():
                await session.execute(
                    sa.insert(quality_records),
                    [
                        {
                            "report_nr": f"V-{i}", "report_date": dt.date(2025, 6, 1), "art": "EX AUD",
                            "imported_at": dt.datetime.now(dt.timezone.utc),
                        }
                        for i in range(501)
                    ],
                )
        zeilen = await _funktion(
            "kpi_qualitaet_audits_liste", (dt.date(2025, 1, 1), D), (dt.date(2025, 12, 31), D), (None, T)
        )
        assert len(zeilen) == 501


class TestRechte:
    async def test_ohne_kpi_recht_keine_zeilen(self, bestand):
        async with SessionLocal() as session:
            trans = await session.begin()
            try:
                await session.execute(sa.text("set local role authenticated"))
                await session.execute(
                    sa.text("select set_config('request.jwt.claims', :c, true)"),
                    {"c": '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","apps":{}}'},
                )
                anzahl = await session.scalar(sa.text("select count(*) from public.quality_records"))
            finally:
                await trans.rollback()
        assert anzahl == 0
