"""Der Dokumentenlauf aus lumeapps: Vorgänge und Nachweise übernehmen (DOK-02).

In der Produktion stehen zwei Vorgänge, im neuen Stack standen nach der
Übernahme null — für die alten Tabellen gab es keinen Umzug. Geprüft wird
hier gegen die Testdatenbank: die alten Tabellen werden dort in ihrer alten
Form angelegt, und der echte Motor zieht sie um. Gegen die Altdatenbank läuft
dabei nichts.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import sqlalchemy as sa

from app.config import settings
from app.db import TABLES, SessionLocal
from app.uebernahme import dateien
from app.uebernahme.lauf import _tabelle_aus_der_datenbank, alle_umzuege, uuid5_tabellen
from app.uebernahme.motor import Lauf, neue_id, umziehen
from app.uebernahme.qualifizierung import UMZUEGE, _weg_schliessen

T0 = datetime(2026, 9, 9, 8, 0, tzinfo=timezone.utc)

VORGANGSTABELLEN = ("einarbeitung_dokument", "schulung_dokument", "schulung_zertifikat")


class TestWegSchliessen:
    def test_ein_stimmiger_vorgang_bleibt_wie_er_ist(self):
        zeile = {
            "status": "uebergeben",
            "erstellt_am": T0,
            "uebergeben_am": T0 + timedelta(hours=1),
            "zurueck_am": None,
            "geprueft_am": None,
        }
        assert _weg_schliessen(dict(zeile)) == zeile

    def test_fehlende_fruehere_stempel_bekommen_den_naechsten(self):
        geprueft = T0 + timedelta(days=2)
        zeile = _weg_schliessen(
            {"status": "geprueft", "erstellt_am": T0, "uebergeben_am": None,
             "zurueck_am": None, "geprueft_am": geprueft}
        )
        assert (zeile["uebergeben_am"], zeile["zurueck_am"]) == (geprueft, geprueft)

    def test_ein_belegter_spaeterer_schritt_hebt_den_stand(self):
        zeile = _weg_schliessen(
            {"status": "erstellt", "erstellt_am": T0, "uebergeben_am": T0 + timedelta(hours=3),
             "zurueck_am": None, "geprueft_am": None}
        )
        assert zeile["status"] == "uebergeben"

    def test_ohne_jeden_beleg_bleibt_der_zeitpunkt_der_anlage(self):
        zeile = _weg_schliessen(
            {"status": "zurueck", "erstellt_am": T0, "uebergeben_am": None,
             "zurueck_am": None, "geprueft_am": None}
        )
        assert (zeile["uebergeben_am"], zeile["zurueck_am"], zeile["geprueft_am"]) == (T0, T0, None)


class TestDateiendung:
    def test_bekannte_arten_bekommen_ihre_endung(self):
        assert dateien._mit_endung("uebernahme/dokumente/abc", Path("abc.JPEG")) == (
            "uebernahme/dokumente/abc.jpg",
            "image/jpeg",
        )
        assert dateien._mit_endung("uebernahme/dokumente/abc", Path("abc.pdf")) == (
            "uebernahme/dokumente/abc.pdf",
            "application/pdf",
        )

    def test_was_der_eimer_nicht_nimmt_bleibt_draussen(self):
        assert dateien._mit_endung("uebernahme/dokumente/abc", Path("abc.tif")) is None


def test_die_vorgaenge_stehen_in_der_uebernahme():
    assert [u.alt for u in UMZUEGE if u.alt in VORGANGSTABELLEN] == list(VORGANGSTABELLEN)
    assert {u.alt: u.fest.get("art") for u in UMZUEGE if u.neu == "dokumentvorgaenge"} == {
        "einarbeitung_dokument": "einarbeitung",
        "schulung_dokument": "schulung",
    }


ALTE_TABELLEN = [
    """create table public.einarbeitung_dokument (
        id integer primary key, doc_uid varchar(32) not null, employee_id integer,
        mitarbeiter_name text not null, stelle text, beginn date, abteilungen jsonb,
        pdf_uuid varchar(64), scan_uuid varchar(64), feld_layout jsonb,
        status varchar(24) not null, erstellt_am timestamptz not null,
        uebergeben_am timestamptz, zurueck_am timestamptz, geprueft_am timestamptz,
        pruef_ergebnis jsonb, vollstaendig boolean, kommentar text)""",
    """create table public.schulung_dokument (
        id integer primary key, doc_uid varchar(32) not null, employee_id integer,
        mitarbeiter_name text not null, funktion text, schulungen jsonb,
        pdf_uuid varchar(64), scan_uuid varchar(64), feld_layout jsonb,
        status varchar(24) not null, erstellt_am timestamptz not null,
        uebergeben_am timestamptz, zurueck_am timestamptz, geprueft_am timestamptz,
        pruef_ergebnis jsonb, vollstaendig boolean, kommentar text)""",
    """create table public.schulung_zertifikat (
        id integer primary key, dokument_id integer not null, schulung_bezeichnung text,
        datei_uuid varchar(64) not null, dateiname text not null,
        hochgeladen_am timestamptz not null)""",
]


@pytest.fixture
def quelle(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")
    engine = sa.create_engine(settings.sync_database_url)

    def aufraeumen():
        with engine.begin() as c:
            c.exec_driver_sql(
                "drop table if exists public.schulung_zertifikat,"
                " public.schulung_dokument, public.einarbeitung_dokument"
            )
            c.exec_driver_sql("delete from public.dokumentvorgaenge")

    aufraeumen()
    with engine.begin() as c:
        for ddl in ALTE_TABELLEN:
            c.exec_driver_sql(ddl)
        # Inkonsistent wie im Altsystem möglich: geprüft, aber ohne Übergabe.
        c.execute(
            sa.text(
                "insert into public.einarbeitung_dokument values (1, 'EA1', null, 'Dana Neu',"
                " 'Näherin', '2026-09-01', cast(:abt as jsonb), 'aaa-111', null,"
                " cast(:layout as jsonb), 'geprueft', :t0, null, null, :g,"
                " cast(:ergebnis as jsonb), true, 'Unterschrift nachgeholt')"
            ),
            {
                "abt": '["Production", "QS"]',
                "layout": '{"seite": [595, 842], "felder": []}',
                "ergebnis": '{"qr_ok": true, "felder": [], "vollstaendig": true}',
                "t0": T0,
                "g": T0 + timedelta(days=2),
            },
        )
        c.execute(
            sa.text(
                "insert into public.schulung_dokument values (7, 'SD7', null, 'Dana Neu',"
                " 'Näherin', cast(:sch as jsonb), 'bbb-222', null, null, 'uebergeben',"
                " :t0, :u, null, null, null, null, null)"
            ),
            {
                "sch": '[{"name": "betrieblich: Brandschutz", "trainer": "Meier"}]',
                "t0": T0,
                "u": T0 + timedelta(hours=1),
            },
        )
        c.execute(
            sa.text(
                "insert into public.schulung_zertifikat values (3, 7, 'betrieblich: Brandschutz',"
                " 'ccc-333', 'Zertifikat.pdf', :h)"
            ),
            {"h": T0 + timedelta(days=1)},
        )
    yield engine
    aufraeumen()
    engine.dispose()


async def _umziehen(quelle) -> int:
    gerechnet = uuid5_tabellen(alle_umzuege())
    lauf = Lauf()
    geschrieben = 0
    for umzug in [u for u in UMZUEGE if u.alt in VORGANGSTABELLEN]:
        ziel = TABLES.get(umzug.neu)
        if ziel is None:
            ziel = await _tabelle_aus_der_datenbank(umzug.neu)
        geschrieben += await umziehen(quelle, umzug, lauf, gerechnet, ziel)
    return geschrieben


@pytest.mark.asyncio
async def test_vorgaenge_und_nachweise_kommen_mit(quelle):
    assert await _umziehen(quelle) == 3

    async with SessionLocal() as s:
        vorgaenge = (
            await s.execute(sa.text("select * from public.dokumentvorgaenge order by art"))
        ).mappings().all()
        nachweise = (
            await s.execute(sa.text("select * from public.dokument_nachweise"))
        ).mappings().all()

    einarbeitung, schulung = vorgaenge
    assert einarbeitung["art"] == "einarbeitung"
    assert einarbeitung["doc_uid"] == "EA1"
    assert einarbeitung["name"] == "Dana Neu"
    assert einarbeitung["funktion"] == "Näherin"
    assert einarbeitung["status"] == "geprueft"
    assert einarbeitung["uebergeben_am"] == einarbeitung["zurueck_am"] == T0 + timedelta(days=2)
    assert einarbeitung["inhalt"] == [{"abteilung": "Production"}, {"abteilung": "QS"}]
    assert einarbeitung["pdf_pfad"] == "uebernahme/dokumente/aaa-111"
    assert einarbeitung["scan_pfad"] is None
    assert einarbeitung["vollstaendig"] is True
    assert einarbeitung["kommentar"] == "Unterschrift nachgeholt"
    assert einarbeitung["feld_layout"] == {"seite": [595, 842], "felder": []}

    assert schulung["art"] == "schulung"
    assert schulung["status"] == "uebergeben"
    assert schulung["inhalt"] == [{"bezeichnung": "betrieblich: Brandschutz", "anbieter": "Meier"}]
    assert str(schulung["id"]) == neue_id("schulung_dokument", 7)

    assert len(nachweise) == 1
    assert nachweise[0]["vorgang_id"] == schulung["id"]
    assert nachweise[0]["zeile"] == "betrieblich: Brandschutz"
    assert nachweise[0]["pfad"] == "uebernahme/dokumente/ccc-333"
    assert nachweise[0]["dateiname"] == "Zertifikat.pdf"


@pytest.mark.asyncio
async def test_ein_zweiter_lauf_legt_nichts_doppelt_an(quelle):
    assert await _umziehen(quelle) == 3
    assert await _umziehen(quelle) == 0
