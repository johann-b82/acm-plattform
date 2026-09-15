"""Realtime und Konfliktschutz gegen eine echte Datenbank (ADR-0006, Phase 1).

Drei Dinge stehen im Blick. Erstens die Version je Zeile: sie steigt bei jeder
Änderung, egal wer schreibt — so erkennt ein Speichern auf veraltetem Stand,
dass jemand anders schneller war. Zweitens die Meldung einer Änderung: sie
nennt nur Tabelle, Vorgang und Kennung, nie den Inhalt; wer mehr wissen will,
liest über PostgREST und damit durch die Leseregel. Drittens die Rechte auf
den Kanälen: empfangen und anwesend sein darf nur, wer die Tabelle lesen darf,
und selbst Änderungen melden darf niemand.
"""
from __future__ import annotations

import json

import pytest
import pytest_asyncio
import sqlalchemy as sa

from app.db import SessionLocal
from tests._auth import USER_ID

ATR_LESER = '{"sub":"%s","role":"authenticated","apps":{"atr":"viewer"}}' % USER_ID
QS_LESER = '{"sub":"%s","role":"authenticated","apps":{"quality":"viewer"}}' % USER_ID
PRODUKTION_LESER = '{"sub":"%s","role":"authenticated","apps":{"production":"viewer"}}' % USER_ID
VERWALTUNG = '{"sub":"%s","role":"authenticated","apps":{"platform":"admin"}}' % USER_ID
FREMD = '{"sub":"%s","role":"authenticated","apps":{"hr":"admin"}}' % USER_ID


@pytest_asyncio.fixture
async def db(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")

    async def leeren():
        async with SessionLocal() as s:
            async with s.begin():
                await s.execute(sa.text("delete from public.atr_lieferungen"))
                await s.execute(sa.text(
                    "alter table public.audit_verlauf disable trigger audit_verlauf_fest"))
                await s.execute(sa.text("delete from public.audit_verlauf"))
                await s.execute(sa.text(
                    "alter table public.audit_verlauf enable trigger audit_verlauf_fest"))
                await s.execute(sa.text("delete from public.audits"))
                await s.execute(sa.text("delete from public.maschinen"))
                await s.execute(sa.text("delete from public.feedback"))
                await s.execute(sa.text("delete from realtime.messages"))

    await leeren()
    yield
    await leeren()


async def roh(sql: str, **params) -> list[dict]:
    """Ohne Rechtepruefung, mit Commit — wie ein Dienst, der schreibt."""
    async with SessionLocal() as s:
        async with s.begin():
            ergebnis = await s.execute(sa.text(sql), params)
            return [dict(r) for r in ergebnis.mappings()] if ergebnis.returns_rows else []


async def als(claims: str, sql: str, thema: str | None = None, **params) -> list[dict]:
    """Als angemeldete Person, optional mit gesetztem Kanal — so prueft der
    Realtime-Dienst die Rechte eines Kanals. Rollt immer zurueck."""
    async with SessionLocal() as s:
        trans = await s.begin()
        try:
            await s.execute(sa.text("set local role authenticated"))
            await s.execute(
                sa.text("select set_config('request.jwt.claims', :c, true)"), {"c": claims})
            if thema is not None:
                await s.execute(
                    sa.text("select set_config('realtime.topic', :t, true)"), {"t": thema})
            ergebnis = await s.execute(sa.text(sql), params)
            return [dict(r) for r in ergebnis.mappings()] if ergebnis.returns_rows else []
        finally:
            await trans.rollback()


# --- Je Tabelle der Phase 1: eine Zeile anlegen und eine Spalte ändern -------

async def atr_lieferung() -> str:
    return str((await roh(
        "insert into public.atr_lieferungen (quelle_dateiname) values ('ls.pdf') returning id"
    ))[0]["id"])


async def atr_position() -> str:
    lieferung = await atr_lieferung()
    return str((await roh(
        "insert into public.atr_positionen (lieferung_id, reihenfolge)"
        " values (cast(:l as uuid), 1) returning id", l=lieferung))[0]["id"])


async def audit() -> str:
    return str((await roh(
        "insert into public.audits (nummer, titel, art) values ('A-1', 'EN 9100', 'intern')"
        " returning id"))[0]["id"])


async def audit_phase() -> str:
    a = await audit()
    return str((await roh(
        "insert into public.audit_phasen (audit_id, position, titel)"
        " values (cast(:a as uuid), 1, 'Planung') returning id", a=a))[0]["id"])


async def maschine() -> str:
    return str((await roh(
        "insert into public.maschinen (name) values ('Fräse 3') returning id"))[0]["id"])


async def wartungsaufgabe() -> str:
    m = await maschine()
    return str((await roh(
        "insert into public.wartungsaufgaben (maschine_id, titel, intervall)"
        " values (cast(:m as uuid), 'Öl', 'monatlich') returning id", m=m))[0]["id"])


async def feedback() -> str:
    return str((await roh(
        "insert into public.feedback (seite, beschreibung) values ('/atr', 'Knopf fehlt')"
        " returning id"))[0]["id"])


PHASE_1 = {
    "atr_lieferungen": (atr_lieferung, "lieferschein_nr = '704511'"),
    "atr_positionen": (atr_position, "reihenfolge = 2"),
    "audits": (audit, "titel = 'EN 9100 neu'"),
    "audit_phasen": (audit_phase, "titel = 'Durchführung'"),
    "maschinen": (maschine, "name = 'Fräse 4'"),
    "wartungsaufgaben": (wartungsaufgabe, "titel = 'Filter'"),
    "feedback": (feedback, "beschreibung = 'Knopf fehlt immer noch'"),
}


class TestVersion:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("tabelle", PHASE_1)
    async def test_beginnt_bei_eins_und_steigt_mit_jeder_aenderung(self, db, tabelle):
        anlegen, aenderung = PHASE_1[tabelle]
        kennung = await anlegen()
        vorher = await roh(f"select version from public.{tabelle} where id = cast(:i as uuid)",
                           i=kennung)
        assert vorher[0]["version"] == 1
        await roh(f"update public.{tabelle} set {aenderung} where id = cast(:i as uuid)", i=kennung)
        await roh(f"update public.{tabelle} set {aenderung} where id = cast(:i as uuid)", i=kennung)
        nachher = await roh(f"select version from public.{tabelle} where id = cast(:i as uuid)",
                            i=kennung)
        assert nachher[0]["version"] == 3

    @pytest.mark.asyncio
    async def test_eine_von_aussen_gesetzte_version_zaehlt_nicht(self, db):
        # Sonst liesse sich die Pruefung umgehen, indem man die erwartete
        # Version gleich mitschreibt.
        kennung = await maschine()
        await roh("update public.maschinen set version = 99 where id = cast(:i as uuid)", i=kennung)
        zeile = await roh("select version from public.maschinen where id = cast(:i as uuid)",
                          i=kennung)
        assert zeile[0]["version"] == 2

    @pytest.mark.asyncio
    async def test_speichern_auf_veraltetem_stand_trifft_keine_zeile(self, db):
        kennung = await maschine()
        # Jemand anders war schneller.
        await roh("update public.maschinen set name = 'Fräse 4' where id = cast(:i as uuid)",
                  i=kennung)
        getroffen = await roh(
            "update public.maschinen set name = 'Fräse 5'"
            " where id = cast(:i as uuid) and version = 1 returning id", i=kennung)
        assert getroffen == []
        zeile = await roh("select name from public.maschinen where id = cast(:i as uuid)",
                          i=kennung)
        assert zeile[0]["name"] == "Fräse 4"

    @pytest.mark.asyncio
    async def test_gesehen_zu_setzen_ist_keine_aenderung_am_inhalt(self, db):
        # Die Liste hakt ab, was sie angezeigt hat. Das darf niemandem, der
        # gerade den Status aendert, einen Konflikt bescheren — auch nicht
        # der Person selbst, die im selben Zug beides tut.
        kennung = await feedback()
        await roh("update public.feedback set gesehen_am = now() where id = cast(:i as uuid)",
                  i=kennung)
        zeile = await roh("select version from public.feedback where id = cast(:i as uuid)",
                          i=kennung)
        assert zeile[0]["version"] == 1
        await roh("update public.feedback set status = 'erledigt' where id = cast(:i as uuid)",
                  i=kennung)
        zeile = await roh("select version from public.feedback where id = cast(:i as uuid)",
                          i=kennung)
        assert zeile[0]["version"] == 2


class TestMeldung:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("tabelle", PHASE_1)
    async def test_jede_aenderung_wird_auf_dem_kanal_der_tabelle_gemeldet(self, db, tabelle):
        anlegen, aenderung = PHASE_1[tabelle]
        kennung = await anlegen()
        await roh(f"update public.{tabelle} set {aenderung} where id = cast(:i as uuid)", i=kennung)
        await roh(f"delete from public.{tabelle} where id = cast(:i as uuid)", i=kennung)

        meldungen = await roh(
            "select topic, extension, private, event, payload from realtime.messages"
            " where topic = :t and payload ->> 'datensatz' = :i order by inserted_at, id",
            t=f"tabelle:{tabelle}", i=kennung)
        vorgaenge = {m["payload"]["op"] for m in meldungen}
        assert vorgaenge == {"INSERT", "UPDATE", "DELETE"}
        for m in meldungen:
            assert m["extension"] == "broadcast"
            assert m["private"] is True
            assert m["event"] == "aenderung"
            assert m["payload"]["tabelle"] == tabelle

    @pytest.mark.asyncio
    async def test_die_meldung_traegt_keinen_inhalt(self, db):
        # Die Leseregel gilt nur beim Lesen ueber PostgREST. Stuende der
        # Inhalt in der Meldung, saehe ihn jeder auf dem Kanal.
        await roh("insert into public.feedback (seite, beschreibung)"
                  " values ('/hr', 'Gehalt von Frau X steht falsch')")
        meldung = (await roh(
            "select payload from realtime.messages where topic = 'tabelle:feedback'"))[0]
        assert set(meldung["payload"]) == {"id", "tabelle", "op", "datensatz"}
        assert "Gehalt" not in json.dumps(meldung["payload"])


class TestKanalrechte:
    @staticmethod
    async def meldung(thema: str) -> None:
        await roh("insert into realtime.messages (topic, extension, payload, event, private)"
                  " values (:t, 'broadcast', '{}', 'aenderung', true)", t=thema)

    @pytest.mark.asyncio
    @pytest.mark.parametrize(("claims", "thema", "darf"), [
        (ATR_LESER, "tabelle:atr_lieferungen", True),
        (ATR_LESER, "tabelle:atr_positionen", True),
        (FREMD, "tabelle:atr_lieferungen", False),
        (QS_LESER, "tabelle:audits", True),
        (QS_LESER, "tabelle:audit_phasen", True),
        (ATR_LESER, "tabelle:audits", False),
        (PRODUKTION_LESER, "tabelle:maschinen", True),
        (PRODUKTION_LESER, "tabelle:wartungsaufgaben", True),
        # App Feedback liest nur die Plattform-Verwaltung — auf dem Kanal auch.
        (QS_LESER, "tabelle:feedback", False),
        (VERWALTUNG, "tabelle:feedback", True),
        # Nicht freigegebene Tabellen haben keinen Kanal, fuer niemanden.
        (VERWALTUNG, "tabelle:personio_employees", False),
    ])
    async def test_empfangen_darf_wer_die_tabelle_lesen_darf(self, db, claims, thema, darf):
        await self.meldung(thema)
        zeilen = await als(claims, "select count(*) as n from realtime.messages"
                                   " where topic = realtime.topic()", thema=thema)
        assert (zeilen[0]["n"] == 1) is darf

    @pytest.mark.asyncio
    async def test_anwesend_sein_darf_wer_den_datensatz_lesen_darf(self, db):
        kennung = await atr_lieferung()
        thema = f"datensatz:atr_lieferungen:{kennung}"
        eintragen = ("insert into realtime.messages (topic, extension, payload)"
                     " values (realtime.topic(), 'presence', '{}')")
        await als(ATR_LESER, eintragen, thema=thema)
        with pytest.raises(Exception, match="row-level security"):
            await als(FREMD, eintragen, thema=thema)
        # Wer anwesend ist, sieht auch die anderen.
        await roh("insert into realtime.messages (topic, extension, payload)"
                  " values (:t, 'presence', '{}')", t=thema)
        sichtbar = await als(ATR_LESER, "select count(*) as n from realtime.messages"
                                        " where topic = realtime.topic()", thema=thema)
        assert sichtbar[0]["n"] == 1

    @pytest.mark.asyncio
    async def test_aenderungen_melden_darf_nur_die_datenbank(self, db):
        # Sonst liesse sich allen offenen Seiten ein Neuladen aufzwingen.
        with pytest.raises(Exception, match="row-level security"):
            await als(VERWALTUNG,
                      "insert into realtime.messages (topic, extension, payload, event)"
                      " values (realtime.topic(), 'broadcast', '{}', 'aenderung')",
                      thema="tabelle:maschinen")

    @pytest.mark.asyncio
    async def test_die_freigabeliste_ist_lesbar_aber_nicht_aenderbar(self, db):
        tabellen = {z["tabelle"] for z in await als(
            ATR_LESER, "select tabelle from public.realtime_tabellen")}
        assert set(PHASE_1) <= tabellen
        with pytest.raises(Exception, match="row-level security|permission denied"):
            await als(VERWALTUNG, "insert into public.realtime_tabellen (tabelle, app)"
                                  " values ('personio_employees', 'hr')")
