"""Seiten-Feedback gegen eine echte Datenbank.

Drei Dinge stehen im Blick. Erstens die Schranke, die absichtlich schief ist:
melden darf jede angemeldete Person, lesen nur die Plattform-Verwaltung.
Zweitens der Trigger, der Melder und E-Mail aus der Sitzung setzt — sonst
liesse sich ein Bericht unter fremdem Namen einreichen. Drittens die Regeln
auf `storage.objects`: hochladen nur in den eigenen Ordner, lesen nur die
Verwaltung.
"""
from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
import sqlalchemy as sa

from app.db import SessionLocal
from tests._auth import USER_ID

FREMD_ID = "33333333-3333-3333-3333-333333333333"

MELDER = ('{"sub":"%s","email":"melder@example.com","role":"authenticated",'
          '"apps":{"kpi":"viewer"}}') % USER_ID
VERWALTUNG = ('{"sub":"%s","email":"admin@example.com","role":"authenticated",'
              '"apps":{"platform":"admin"}}') % USER_ID
# Ein Admin einer Fachanwendung ist noch keine Plattform-Verwaltung.
FACHADMIN = ('{"sub":"%s","email":"hr@example.com","role":"authenticated",'
             '"apps":{"hr":"admin"}}') % USER_ID


@pytest_asyncio.fixture
async def db(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")

    async def leeren():
        await objekte_weg("feedback")
        async with SessionLocal() as s:
            async with s.begin():
                await s.execute(sa.text("delete from public.feedback"))
                for kennung, mail in ((USER_ID, "melder@example.com"),
                                      (FREMD_ID, "fremd@example.com")):
                    await s.execute(sa.text(
                        "insert into auth.users (id, email)"
                        " values (cast(:i as uuid), :m) on conflict (id) do nothing"),
                        {"i": kennung, "m": mail})

    await leeren()
    yield
    await leeren()


async def als(claims: str, sql: str, **params):
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
    """Einrichten ohne Rechtepruefung — `als` rollt immer zurueck."""
    async with SessionLocal() as s:
        async with s.begin():
            await s.execute(sa.text(sql), params)


async def als_erwartet_fehler(claims: str, sql: str, **params) -> str:
    with pytest.raises(Exception) as fehler:
        await als(claims, sql, **params)
    return str(fehler.value).lower()


async def als_dauerhaft(claims: str, sql: str, **params) -> None:
    """Wie `als`, aber es bleibt stehen.

    Braucht man, wo erst der naechste Blick zeigt, was der Trigger gesetzt
    hat: mit `returning` kaeme man an die eigene Zeile nicht heran, weil auf
    die Rueckgabe eines `insert` die Leseregel angewandt wird.
    """
    async with SessionLocal() as s:
        async with s.begin():
            await s.execute(sa.text("set local role authenticated"))
            await s.execute(
                sa.text("select set_config('request.jwt.claims', :c, true)"), {"c": claims}
            )
            await s.execute(sa.text(sql), params)


async def objekte_weg(eimer: str) -> None:
    """Raeumt einen Eimer ab. Der Speicher verbietet ein direktes `delete`;
    fuers Aufraeumen im Test setzen wir den Schalter, den er dafuer kennt."""
    async with SessionLocal() as s:
        async with s.begin():
            await s.execute(sa.text("set local storage.allow_delete_query = 'true'"))
            await s.execute(
                sa.text("delete from storage.objects where bucket_id = :e"), {"e": eimer})


async def zeilen_ungeprueft(sql: str, **params):
    """Nachsehen, ohne durch die Leseregel zu gehen."""
    async with SessionLocal() as s:
        ergebnis = await s.execute(sa.text(sql), params)
        return [dict(r) for r in ergebnis.mappings()]


BERICHT = ("insert into public.feedback (seite, beschreibung)"
           " values ('/kpi/einkauf', 'Die Kachel zeigt einen leeren Wert')")


class TestMelden:
    async def test_jede_angemeldete_person_darf_melden(self, db):
        """Ein Fehlerbericht, den nur Berechtigte schreiben duerfen, erreicht
        die Fehler nicht, die es zu finden gilt."""
        await als(MELDER, BERICHT)
        await als(FACHADMIN, BERICHT)

    async def test_leere_beschreibung_wird_abgelehnt(self, db):
        text = await als_erwartet_fehler(
            MELDER,
            "insert into public.feedback (seite, beschreibung)"
            " values ('/kpi', '   ')",
        )
        assert "check" in text

    async def test_melder_kommt_aus_der_sitzung(self, db):
        await als_dauerhaft(MELDER, BERICHT)
        zeile = (await zeilen_ungeprueft(
            "select melder, melder_email from public.feedback"))[0]
        assert str(zeile["melder"]) == USER_ID
        assert zeile["melder_email"] == "melder@example.com"

    async def test_fremder_melder_im_formular_wird_ueberschrieben(self, db):
        """Die Zuordnung darf keine Angabe des Aufrufers sein."""
        await als_dauerhaft(
            MELDER,
            "insert into public.feedback (seite, beschreibung, melder, melder_email)"
            " values ('/kpi', 'Test', cast(:f as uuid), 'chef@example.com')", f=FREMD_ID)
        zeile = (await zeilen_ungeprueft(
            "select melder, melder_email from public.feedback"))[0]
        assert str(zeile["melder"]) == USER_ID
        assert zeile["melder_email"] == "melder@example.com"

    async def test_wer_meldet_bekommt_die_eigene_zeile_nicht_zurueck(self, db):
        """`insert ... returning` laeuft durch die Leseregel. Deshalb holt die
        Oberflaeche nach dem Melden nichts zurueck — sie hat nichts zu holen."""
        text = await als_erwartet_fehler(MELDER, BERICHT + " returning id")
        assert "row-level security" in text


class TestLesen:
    async def test_verwaltung_sieht_die_berichte(self, db):
        await anlegen(BERICHT)
        zeilen = await als(VERWALTUNG, "select * from public.feedback")
        assert len(zeilen) == 1
        assert zeilen[0]["status"] == "neu"
        assert zeilen[0]["gesehen_am"] is None

    async def test_wer_meldet_liest_nicht_mit(self, db):
        """Auch nicht den eigenen Bericht: er geht an die Verwaltung."""
        await anlegen(BERICHT)
        assert await als(MELDER, "select * from public.feedback") == []
        assert await als(FACHADMIN, "select * from public.feedback") == []

    async def test_nur_die_verwaltung_aendert_den_status(self, db):
        await anlegen(BERICHT)
        assert await als(
            MELDER,
            "update public.feedback set status = 'erledigt' returning id") == []
        geaendert = await als(
            VERWALTUNG,
            "update public.feedback set status = 'erledigt' returning status")
        assert geaendert[0]["status"] == "erledigt"

    async def test_nur_die_verwaltung_loescht(self, db):
        await anlegen(BERICHT)
        assert await als(MELDER, "delete from public.feedback returning id") == []
        assert len(await als(VERWALTUNG, "delete from public.feedback returning id")) == 1


class TestBearbeiten:
    """App Feedback: ein dritter Status zwischen offen und erledigt, und eine
    Person, die sich kuemmert."""

    async def test_in_bearbeitung_ist_ein_status(self, db):
        await anlegen(BERICHT)
        geaendert = await als(
            VERWALTUNG,
            "update public.feedback set status = 'in_bearbeitung' returning status")
        assert geaendert[0]["status"] == "in_bearbeitung"

    async def test_ein_unbekannter_status_wird_abgelehnt(self, db):
        await anlegen(BERICHT)
        text = await als_erwartet_fehler(
            VERWALTUNG, "update public.feedback set status = 'irgendwas'")
        assert "check" in text

    async def test_die_verwaltung_weist_zu(self, db):
        await anlegen(BERICHT)
        geaendert = await als(
            VERWALTUNG,
            "update public.feedback set zugewiesen = cast(:f as uuid) returning zugewiesen",
            f=FREMD_ID)
        assert str(geaendert[0]["zugewiesen"]) == FREMD_ID

    async def test_wer_meldet_weist_nicht_zu(self, db):
        await anlegen(BERICHT)
        assert await als(
            MELDER,
            "update public.feedback set zugewiesen = cast(:f as uuid) returning id",
            f=FREMD_ID) == []

    async def test_zuweisbar_ist_nur_ein_konto(self, db):
        # Zufaellig statt fest: andere Tests legen Konten mit festen Kennungen an.
        await anlegen(BERICHT)
        text = await als_erwartet_fehler(
            VERWALTUNG,
            "update public.feedback set zugewiesen = cast(:f as uuid)",
            f=str(uuid.uuid4()))
        assert "foreign key" in text

    async def test_geht_das_konto_bleibt_die_meldung_ohne_zuweisung(self, db):
        kennung = "55555555-5555-5555-5555-555555555555"
        await anlegen("insert into auth.users (id, email) values (cast(:i as uuid), 'weg@example.com')"
                      " on conflict (id) do nothing", i=kennung)
        await anlegen(BERICHT)
        await anlegen("update public.feedback set zugewiesen = cast(:i as uuid)", i=kennung)
        await anlegen("delete from auth.users where id = cast(:i as uuid)", i=kennung)
        zeile = (await zeilen_ungeprueft("select zugewiesen from public.feedback"))[0]
        assert zeile["zugewiesen"] is None

    async def test_die_verwaltung_sieht_die_zuweisbaren_konten(self, db):
        """Zuweisbar ist, wer ein Konto hat — dieselbe Sicht wie die Zugaenge."""
        konten = await als(VERWALTUNG, "select id, email from public.plattform_nutzer")
        assert {str(k["id"]) for k in konten} >= {USER_ID, FREMD_ID}
        assert await als(MELDER, "select id from public.plattform_nutzer") == []


class TestBild:
    """Die Regeln auf `storage.objects` — der erste Verbraucher des Speichers."""

    async def test_der_eimer_ist_nicht_oeffentlich(self, db):
        async with SessionLocal() as s:
            zeile = (await s.execute(sa.text(
                "select public, file_size_limit, allowed_mime_types"
                " from storage.buckets where id = 'feedback'"))).mappings().one()
        assert zeile["public"] is False
        assert zeile["file_size_limit"] == 5 * 1024 * 1024
        assert "image/png" in zeile["allowed_mime_types"]

    async def test_hochladen_nur_in_den_eigenen_ordner(self, db):
        await als(MELDER,
                  "insert into storage.objects (bucket_id, name)"
                  " values ('feedback', :n)", n=f"{USER_ID}/bild.png")
        text = await als_erwartet_fehler(
            MELDER,
            "insert into storage.objects (bucket_id, name)"
            " values ('feedback', :n)", n=f"{FREMD_ID}/bild.png")
        assert "row-level security" in text

    async def test_ein_bild_ohne_ordner_geht_nicht(self, db):
        """Ohne Ordner ist der erste Pfadabschnitt NULL — die Regel greift."""
        text = await als_erwartet_fehler(
            MELDER,
            "insert into storage.objects (bucket_id, name)"
            " values ('feedback', 'bild.png')")
        assert "row-level security" in text

    async def test_lesen_darf_nur_die_verwaltung(self, db):
        await anlegen("insert into storage.objects (bucket_id, name)"
                      " values ('feedback', :n)", n=f"{USER_ID}/bild.png")
        assert len(await als(
            VERWALTUNG, "select * from storage.objects where bucket_id = 'feedback'")) == 1
        # Auch nicht das eigene: wer meldet, laedt hoch und liest nicht zurueck.
        assert await als(
            MELDER, "select * from storage.objects where bucket_id = 'feedback'") == []

    async def test_direkt_loeschen_ist_auch_der_verwaltung_verwehrt(self, db):
        """Der Speicher laesst kein `delete` auf `storage.objects` zu, auch
        nicht mit Recht. Geloescht wird ueber den Dienst, der die Datei
        mitnimmt — sonst bliebe sie im Eimer liegen. Deshalb geht die
        Oberflaeche fuers Loeschen ueber `storage.remove`, nicht ueber
        PostgREST."""
        await anlegen("insert into storage.objects (bucket_id, name)"
                      " values ('feedback', :n)", n=f"{USER_ID}/bild.png")
        text = await als_erwartet_fehler(
            VERWALTUNG, "delete from storage.objects where bucket_id = 'feedback'")
        assert "direct deletion" in text

    async def test_ein_fremder_eimer_bleibt_unberuehrt(self, db):
        """Die Regeln sind auf `feedback` eingegrenzt und oeffnen sonst nichts."""
        await anlegen("insert into storage.buckets (id, name) values ('anderer', 'anderer')"
                      " on conflict (id) do nothing")
        await anlegen("insert into storage.objects (bucket_id, name)"
                      " values ('anderer', :n)", n=f"{USER_ID}/bild.png")
        try:
            assert await als(
                VERWALTUNG, "select * from storage.objects where bucket_id = 'anderer'") == []
            text = await als_erwartet_fehler(
                VERWALTUNG,
                "insert into storage.objects (bucket_id, name)"
                " values ('anderer', 'x.png')")
            assert "row-level security" in text
        finally:
            await objekte_weg("anderer")
            await anlegen("delete from storage.buckets where id = 'anderer'")
