"""KPI-Bewertung gegen eine echte Datenbank.

Zwei Dinge stehen im Blick: dass die Registry wirklich `zielwerte` ist (eine
Bewertung ohne Kennzahl darf nicht entstehen), und dass die Rechte stimmen —
lesen darf, wer die Zahlen sieht, schreiben nur, wer die Einstellungen
bearbeiten darf.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest
import pytest_asyncio
import sqlalchemy as sa

from app.db import SessionLocal
from tests._auth import USER_ID

LESER = '{"sub":"%s","role":"authenticated","apps":{"kpi":"viewer"}}' % USER_ID
SCHREIBER = ('{"sub":"%s","role":"authenticated",'
             '"apps":{"kpi":"viewer","settings":"editor"}}') % USER_ID
FREMD = '{"sub":"%s","role":"authenticated","apps":{"hr":"admin"}}' % USER_ID

SCHLUESSEL = "einkauf_otd"


@pytest_asyncio.fixture
async def db(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")

    async def leeren():
        async with SessionLocal() as s:
            async with s.begin():
                await s.execute(sa.text("delete from public.kpi_massnahmen"))
                await s.execute(sa.text("delete from public.kpi_kommentare"))
                await s.execute(sa.text(
                    "insert into auth.users (id, email) values (cast(:i as uuid), :m)"
                    " on conflict (id) do nothing"), {"i": USER_ID, "m": "u@example.com"})

    await leeren()
    yield
    await leeren()


async def als(claims: str, sql: str, **params):
    """Fuehrt SQL als `authenticated` mit diesen Claims aus. Gibt Zeilen oder
    die Ausnahme zurueck — RLS meldet sich je nach Fall verschieden."""
    async with SessionLocal() as s:
        trans = await s.begin()
        try:
            await s.execute(sa.text("set local role authenticated"))
            await s.execute(
                sa.text("select set_config('request.jwt.claims', :c, true)"), {"c": claims}
            )
            ergebnis = await s.execute(sa.text(sql), params)
            return [dict(r) for r in ergebnis.mappings()] if ergebnis.returns_rows else []
        finally:
            await trans.rollback()


async def anlegen(sql: str, **params) -> None:
    """Daten einrichten, ohne Rechte zu pruefen.

    `als` rollt immer zurueck — das ist fuer eine RLS-Probe richtig und fuers
    Einrichten falsch. Wer beides mischt, prueft am Ende gegen eine leere
    Tabelle und merkt es nicht.
    """
    async with SessionLocal() as s:
        async with s.begin():
            await s.execute(sa.text(sql), params)


async def als_erwartet_fehler(claims: str, sql: str, **params) -> str:
    with pytest.raises(Exception) as fehler:
        await als(claims, sql, **params)
    return str(fehler.value).lower()


class TestRegistry:
    async def test_kommentar_braucht_eine_bekannte_kennzahl(self, db):
        """Der Fremdschluessel auf `zielwerte` ist die Registry. Ohne ihn
        entstuende eine zweite Liste, die auseinanderlaufen kann."""
        text = await als_erwartet_fehler(
            SCHREIBER,
            "insert into public.kpi_kommentare (schluessel, text)"
            " values ('gibt_es_nicht', 'Test')",
        )
        assert "foreign key" in text or "verletzt" in text or "violates" in text

    async def test_leerer_text_wird_abgelehnt(self, db):
        text = await als_erwartet_fehler(
            SCHREIBER,
            "insert into public.kpi_kommentare (schluessel, text) values (:s, '   ')",
            s=SCHLUESSEL,
        )
        assert "check" in text

    async def test_uebersicht_kennt_jede_kennzahl_mit_zielwert(self, db):
        zeilen = await als(LESER, "select * from public.kpi_bewertung_uebersicht()")
        async with SessionLocal() as s:
            anzahl = await s.scalar(sa.text("select count(*) from public.zielwerte"))
        assert len(zeilen) == anzahl
        assert all(z["kommentare"] == 0 for z in zeilen)


class TestMassnahmen:
    async def test_erledigt_setzt_das_datum_von_selbst(self, db):
        await anlegen("insert into public.kpi_massnahmen (schluessel, titel, status)"
                      " values (:s, 'Lieferanten anschreiben', 'erledigt')", s=SCHLUESSEL)
        zeilen = await als(LESER, "select status, erledigt_am from public.kpi_massnahmen")
        assert zeilen[0]["erledigt_am"] == date.today()

    async def test_wieder_geoeffnet_verliert_das_datum(self, db):
        async with SessionLocal() as s:
            async with s.begin():
                await s.execute(sa.text(
                    "insert into public.kpi_massnahmen (schluessel, titel, status)"
                    " values (:s, 'T', 'erledigt')"), {"s": SCHLUESSEL})
                await s.execute(sa.text(
                    "update public.kpi_massnahmen set status = 'laeuft'"))
                zeile = (await s.execute(sa.text(
                    "select status, erledigt_am from public.kpi_massnahmen"))).mappings().one()
        assert zeile["erledigt_am"] is None

    async def test_unbekannter_status_wird_abgelehnt(self, db):
        text = await als_erwartet_fehler(
            SCHREIBER,
            "insert into public.kpi_massnahmen (schluessel, titel, status)"
            " values (:s, 'T', 'vielleicht')", s=SCHLUESSEL)
        assert "check" in text

    async def test_uebersicht_zaehlt_offen_ueberfaellig_erledigt(self, db):
        gestern = date.today() - timedelta(days=1)
        morgen = date.today() + timedelta(days=1)
        async with SessionLocal() as s:
            async with s.begin():
                for titel, status, faellig in (
                    ("A", "offen", gestern),      # ueberfaellig
                    ("B", "laeuft", morgen),      # offen, nicht ueberfaellig
                    ("C", "erledigt", gestern),   # zaehlt nicht als offen
                    ("D", "verworfen", gestern),  # zaehlt nirgends
                ):
                    await s.execute(sa.text(
                        "insert into public.kpi_massnahmen (schluessel, titel, status, faellig_am)"
                        " values (:s, :t, :st, :f)"),
                        {"s": SCHLUESSEL, "t": titel, "st": status, "f": faellig})

        zeile = next(z for z in await als(LESER, "select * from public.kpi_bewertung_uebersicht()")
                     if z["schluessel"] == SCHLUESSEL)
        assert zeile["offen"] == 2
        assert zeile["ueberfaellig"] == 1
        assert zeile["erledigt"] == 1

    async def test_kommentar_und_zeitpunkt_in_der_uebersicht(self, db):
        await anlegen("insert into public.kpi_kommentare (schluessel, text)"
                      " values (:s, 'Erster')", s=SCHLUESSEL)
        zeile = next(z for z in await als(LESER, "select * from public.kpi_bewertung_uebersicht()")
                     if z["schluessel"] == SCHLUESSEL)
        assert zeile["kommentare"] == 1
        assert zeile["letzter_kommentar"] is not None

    async def test_geloeschter_zielwert_nimmt_alles_mit(self, db):
        """`on delete cascade`: eine Bewertung ohne Kennzahl bleibt nicht liegen."""
        async with SessionLocal() as s:
            async with s.begin():
                await s.execute(sa.text(
                    "insert into public.zielwerte"
                    " (schluessel, bereich, label, wert, einheit, richtung)"
                    " values ('probe_kennzahl', 'test', 'Probe', 1, 'anzahl', 'min')"))
                await s.execute(sa.text(
                    "insert into public.kpi_kommentare (schluessel, text)"
                    " values ('probe_kennzahl', 'Test')"))
                await s.execute(sa.text(
                    "delete from public.zielwerte where schluessel = 'probe_kennzahl'"))
                rest = await s.scalar(sa.text("select count(*) from public.kpi_kommentare"))
        assert rest == 0


class TestRechte:
    async def test_schreiber_darf_schreiben(self, db):
        """Gegenprobe zur Absage unten — sonst prueft der Test nur, dass
        ueberhaupt niemand schreiben kann."""
        async with SessionLocal() as s:
            trans = await s.begin()
            try:
                await s.execute(sa.text("set local role authenticated"))
                await s.execute(
                    sa.text("select set_config('request.jwt.claims', :c, true)"),
                    {"c": SCHREIBER})
                await s.execute(sa.text(
                    "insert into public.kpi_kommentare (schluessel, text)"
                    " values (:s, 'Geht')"), {"s": SCHLUESSEL})
                anzahl = await s.scalar(sa.text("select count(*) from public.kpi_kommentare"))
            finally:
                await trans.rollback()
        assert anzahl == 1

    async def test_leser_sieht_aber_schreibt_nicht(self, db):
        await anlegen("insert into public.kpi_kommentare (schluessel, text)"
                      " values (:s, 'Da')", s=SCHLUESSEL)
        assert len(await als(LESER, "select * from public.kpi_kommentare")) == 1

        text = await als_erwartet_fehler(
            LESER,
            "insert into public.kpi_kommentare (schluessel, text) values (:s, 'Nicht')",
            s=SCHLUESSEL)
        assert "row-level security" in text or "policy" in text

    async def test_ohne_kpi_recht_keine_zeilen(self, db):
        await anlegen("insert into public.kpi_kommentare (schluessel, text)"
                      " values (:s, 'Da')", s=SCHLUESSEL)
        assert await als(FREMD, "select * from public.kpi_kommentare") == []
        assert await als(FREMD, "select * from public.kpi_bewertung_uebersicht()") == []

    async def test_leser_darf_keine_massnahme_aendern(self, db):
        async with SessionLocal() as s:
            async with s.begin():
                await s.execute(sa.text(
                    "insert into public.kpi_massnahmen (schluessel, titel)"
                    " values (:s, 'Bleibt')"), {"s": SCHLUESSEL})
        # Kein Fehler, aber auch keine geaenderte Zeile — so sieht RLS aus.
        async with SessionLocal() as s:
            trans = await s.begin()
            try:
                await s.execute(sa.text("set local role authenticated"))
                await s.execute(
                    sa.text("select set_config('request.jwt.claims', :c, true)"), {"c": LESER})
                ergebnis = await s.execute(sa.text(
                    "update public.kpi_massnahmen set titel = 'Geaendert'"))
                betroffen = ergebnis.rowcount
            finally:
                await trans.rollback()
        assert betroffen == 0


# ---------------------------------------------------------------------------
# 0050: Bubbles, Priorität und die Verantwortlichen-Auswahl (MAS-01)
# ---------------------------------------------------------------------------

ADMIN_MIT_MAIL = ('{"sub":"%s","email":"u@example.com","role":"authenticated",'
                  '"apps":{"kpi":"viewer","settings":"editor"}}') % USER_ID


class TestBubbles:
    async def test_bubble_bekommt_bereich_und_nummer_von_selbst(self, db):
        """Die Nummer zählt je Bereich, wie im Altsystem je Dashboard."""
        await anlegen("insert into public.kpi_kommentare (schluessel, text)"
                      " values ('einkauf_otd', 'Erste')")
        await anlegen("insert into public.kpi_kommentare (bereich, text, pos_x, pos_y, breite, hoehe)"
                      " values ('einkauf', 'Zweite', 0.1, 0.2, 0.3, 0.1)")
        await anlegen("insert into public.kpi_kommentare (bereich, text)"
                      " values ('vertrieb', 'Andere Seite')")
        zeilen = await als(LESER, "select bereich, nummer, text from public.kpi_kommentare"
                                  " order by bereich, nummer")
        assert [(z["bereich"], z["nummer"]) for z in zeilen] == [
            ("einkauf", 1), ("einkauf", 2), ("vertrieb", 1)]

    async def test_bubble_ohne_bereich_und_kennzahl_geht_nicht(self, db):
        text = await als_erwartet_fehler(
            SCHREIBER, "insert into public.kpi_kommentare (text) values ('Wohin?')")
        assert "null" in text

    async def test_position_ganz_oder_gar_nicht(self, db):
        text = await als_erwartet_fehler(
            SCHREIBER,
            "insert into public.kpi_kommentare (bereich, text, pos_x) values ('einkauf', 'T', 0.5)")
        assert "check" in text
        text = await als_erwartet_fehler(
            SCHREIBER,
            "insert into public.kpi_kommentare (bereich, text, pos_x, pos_y, breite, hoehe)"
            " values ('einkauf', 'T', 1.5, 0, 0.1, 0.1)")
        assert "check" in text

    async def test_ampel_nur_rot_gelb_gruen(self, db):
        text = await als_erwartet_fehler(
            SCHREIBER,
            "insert into public.kpi_kommentare (bereich, text, ampel) values ('einkauf', 'T', 'blau')")
        assert "check" in text

    async def test_verfasser_kommt_aus_der_sitzung(self, db):
        async with SessionLocal() as s:
            async with s.begin():
                await s.execute(sa.text("set local role authenticated"))
                await s.execute(sa.text("select set_config('request.jwt.claims', :c, true)"),
                                {"c": ADMIN_MIT_MAIL})
                await s.execute(sa.text(
                    "insert into public.kpi_kommentare (bereich, text, verfasser_email)"
                    " values ('einkauf', 'T', 'chef@example.com')"))
        async with SessionLocal() as s:
            zeile = (await s.execute(sa.text(
                "select verfasser, verfasser_email, gesehen_am from public.kpi_kommentare"
            ))).mappings().one()
        assert str(zeile["verfasser"]) == USER_ID
        assert zeile["verfasser_email"] == "u@example.com"
        assert zeile["gesehen_am"] is None

    async def test_gesehen_markieren_darf_nur_der_schreiber(self, db):
        await anlegen("insert into public.kpi_kommentare (bereich, text) values ('einkauf', 'T')")
        assert await als(
            LESER, "update public.kpi_kommentare set gesehen_am = now() returning id") == []
        assert len(await als(
            SCHREIBER, "update public.kpi_kommentare set gesehen_am = now() returning id")) == 1

    async def test_geloeschte_bubble_laesst_die_massnahme_stehen(self, db):
        """Wie im Altsystem: die Maßnahme bleibt, nur ohne Bubble-Zuordnung."""
        async with SessionLocal() as s:
            async with s.begin():
                k = await s.scalar(sa.text(
                    "insert into public.kpi_kommentare (bereich, text)"
                    " values ('einkauf', 'T') returning id"))
                await s.execute(sa.text(
                    "insert into public.kpi_massnahmen (schluessel, titel, kommentar_id)"
                    " values ('einkauf_otd', 'Bleibt', :k)"), {"k": k})
                await s.execute(sa.text("delete from public.kpi_kommentare"))
                zeile = (await s.execute(sa.text(
                    "select titel, kommentar_id from public.kpi_massnahmen"))).mappings().one()
        assert zeile["titel"] == "Bleibt"
        assert zeile["kommentar_id"] is None


class TestPrioritaet:
    async def test_vorgabe_ist_mittel(self, db):
        await anlegen("insert into public.kpi_massnahmen (schluessel, titel)"
                      " values ('einkauf_otd', 'T')")
        zeilen = await als(LESER, "select prioritaet from public.kpi_massnahmen")
        assert zeilen[0]["prioritaet"] == "mittel"

    async def test_nur_niedrig_mittel_hoch(self, db):
        text = await als_erwartet_fehler(
            SCHREIBER,
            "insert into public.kpi_massnahmen (schluessel, titel, prioritaet)"
            " values ('einkauf_otd', 'T', 'dringend')")
        assert "check" in text


class TestVerantwortliche:
    @pytest_asyncio.fixture
    async def personen(self, db):
        async def weg():
            await anlegen("delete from public.personio_employees")
        await weg()
        for nr, vor, nach, status in ((1, "Marcel", "Brose", "active"),
                                      (2, "Anna", "Adler", "active"),
                                      (3, "Otto", "Alt", "inactive")):
            await anlegen(
                "insert into public.personio_employees (id, first_name, last_name, status, synced_at)"
                " values (:i, :v, :n, :s, now())", i=nr, v=vor, n=nach, s=status)
        yield
        await weg()

    async def test_schreiber_bekommt_aktive_namen_wie_im_altsystem(self, personen):
        """„Nachname, Vorname“ — so steht die bestehende Zuständigkeit schon da."""
        zeilen = await als(SCHREIBER, "select name from public.kpi_verantwortliche()")
        assert [z["name"] for z in zeilen] == ["Adler, Anna", "Brose, Marcel"]

    async def test_leser_bekommt_keine_namen(self, personen):
        assert await als(LESER, "select name from public.kpi_verantwortliche()") == []


class TestBestand:
    """Die Migration nimmt vorhandene Kommentare und Maßnahmen mit.

    Geprüft wird die Datei selbst: zurück auf den Stand vor 0050, Zeilen in
    der alten Form anlegen, 0050 wieder anwenden — alles in einer Transaktion,
    die am Ende zurückgerollt wird. DDL ist in Postgres transaktional.
    """

    async def test_kommentare_werden_bubbles_ohne_position_und_test_bleibt(self, db):
        import importlib.util
        import pathlib

        from sqlalchemy import create_engine

        from app.config import settings

        pfad = next(pathlib.Path(__file__).parents[1].glob("alembic/versions/0050_*.py"))
        spec = importlib.util.spec_from_file_location("m0050", pfad)
        modul = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(modul)

        engine = create_engine(settings.sync_database_url)
        try:
            with engine.connect() as c:
                trans = c.begin()
                try:
                    c.exec_driver_sql(modul.DOWNGRADE)
                    c.exec_driver_sql(
                        "insert into public.kpi_kommentare (schluessel, text, erstellt_am) values"
                        " ('einkauf_otd', 'Alt eins', '2026-08-01'),"
                        " ('einkauf_otd', 'Alt zwei', '2026-08-02'),"
                        " ('vertrieb_besuche', 'Vertrieb', '2026-08-03')")
                    c.exec_driver_sql(
                        "insert into public.kpi_massnahmen (schluessel, titel, zustaendig,"
                        " faellig_am, status) values ('qualitaet_audit_level1', 'Test',"
                        " 'Brose, Marcel', '2026-08-19', 'offen')")
                    c.exec_driver_sql(modul.UPGRADE)
                    kommentare = c.exec_driver_sql(
                        "select text, bereich, nummer, pos_x, gesehen_am is not null as gesehen"
                        " from public.kpi_kommentare order by erstellt_am").mappings().all()
                    massnahme = c.exec_driver_sql(
                        "select titel, zustaendig, faellig_am, status, prioritaet, kommentar_id"
                        " from public.kpi_massnahmen").mappings().one()
                finally:
                    trans.rollback()
        finally:
            engine.dispose()

        assert [(k["text"], k["bereich"], k["nummer"]) for k in kommentare] == [
            ("Alt eins", "einkauf", 1), ("Alt zwei", "einkauf", 2), ("Vertrieb", "vertrieb", 1)]
        assert all(k["pos_x"] is None for k in kommentare)
        # Vorhandene Kommentare sind keine neuen Bubbles, die jemand sehen muss.
        assert all(k["gesehen"] for k in kommentare)
        assert massnahme["titel"] == "Test"
        assert massnahme["zustaendig"] == "Brose, Marcel"
        assert massnahme["faellig_am"] == date(2026, 8, 19)
        assert massnahme["status"] == "offen"
        assert massnahme["prioritaet"] == "mittel"
        assert massnahme["kommentar_id"] is None
