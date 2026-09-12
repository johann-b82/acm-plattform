"""Newsletter gegen eine echte Datenbank.

Drei Dinge stehen im Blick. Erstens die Sichtbarkeit: eine veroeffentlichte
Ausgabe liest, wer das Recht hat, einen Entwurf nur die Redaktion — und die
Kapitel, Eintraege und Bilder erben das, statt es zu wiederholen. Zweitens die
beiden Einfrier-Funktionen, die als `security definer` an Daten kommen, die der
Aufrufer sonst nicht saehe, und deshalb selbst pruefen muessen. Drittens, dass
ein eingefrorener Stand stehen bleibt, wenn sich die Belegschaft weiterdreht.
"""
from __future__ import annotations

from datetime import date

import pytest
import pytest_asyncio
import sqlalchemy as sa

from app.db import SessionLocal
from tests._auth import USER_ID

LESER = ('{"sub":"%s","role":"authenticated","apps":{"newsletter":"viewer"}}') % USER_ID
REDAKTION = ('{"sub":"%s","role":"authenticated",'
             '"apps":{"newsletter":"editor"}}') % USER_ID
# Redaktion, die zusaetzlich Kennzahlen bzw. Personal sehen darf.
REDAKTION_KPI = ('{"sub":"%s","role":"authenticated",'
                 '"apps":{"newsletter":"editor","kpi":"viewer"}}') % USER_ID
REDAKTION_HR = ('{"sub":"%s","role":"authenticated",'
                '"apps":{"newsletter":"editor","hr":"viewer"}}') % USER_ID
FREMD = '{"sub":"%s","role":"authenticated","apps":{"hr":"admin"}}' % USER_ID


@pytest_asyncio.fixture
async def db(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")

    async def leeren():
        async with SessionLocal() as s:
            async with s.begin():
                await s.execute(sa.text("delete from public.newsletter"))
                await s.execute(sa.text("delete from public.personio_employees"))

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


async def als_dauerhaft(claims: str, sql: str, **params):
    async with SessionLocal() as s:
        async with s.begin():
            await s.execute(sa.text("set local role authenticated"))
            await s.execute(
                sa.text("select set_config('request.jwt.claims', :c, true)"), {"c": claims}
            )
            ergebnis = await s.execute(sa.text(sql), params)
            return [dict(r) for r in ergebnis.mappings()] if ergebnis.returns_rows else []


async def anlegen(sql: str, **params):
    async with SessionLocal() as s:
        async with s.begin():
            ergebnis = await s.execute(sa.text(sql), params)
            return [dict(r) for r in ergebnis.mappings()] if ergebnis.returns_rows else []


async def als_erwartet_fehler(claims: str, sql: str, **params) -> str:
    with pytest.raises(Exception) as fehler:
        await als(claims, sql, **params)
    return str(fehler.value).lower()


async def ausgabe(status: str = "veroeffentlicht", jahr: int = 2026, quartal: int = 3) -> str:
    zeilen = await anlegen(
        "insert into public.newsletter (jahr, quartal, titel, status)"
        " values (:j, :q, 'Probe', :s) returning id",
        j=jahr, q=quartal, s=status)
    return str(zeilen[0]["id"])


async def kapitel(newsletter: str, art: str = "eintraege", titel: str = "Intern") -> str:
    zeilen = await anlegen(
        "insert into public.newsletter_kapitel (newsletter_id, titel, art)"
        " values (cast(:n as uuid), :t, :a) returning id",
        n=newsletter, t=titel, a=art)
    return str(zeilen[0]["id"])


class TestSichtbarkeit:
    async def test_veroeffentlichte_ausgabe_liest_wer_das_recht_hat(self, db):
        await ausgabe("veroeffentlicht")
        assert len(await als(LESER, "select * from public.newsletter")) == 1

    async def test_entwurf_sieht_nur_die_redaktion(self, db):
        """Sonst laege die halbfertige Ausgabe offen, waehrend daran
        geschrieben wird."""
        await ausgabe("entwurf")
        assert await als(LESER, "select * from public.newsletter") == []
        assert len(await als(REDAKTION, "select * from public.newsletter")) == 1

    async def test_ohne_newsletter_recht_gar_nichts(self, db):
        await ausgabe("veroeffentlicht")
        assert await als(FREMD, "select * from public.newsletter") == []

    async def test_kapitel_erben_die_sichtbarkeit_ihrer_ausgabe(self, db):
        """Das Kapitel wiederholt die Bedingung nicht, es fragt die Ausgabe.
        Sonst gaebe es zwei Orte, an denen steht, wer eine Ausgabe sehen
        darf — und einer liefe irgendwann hinterher."""
        entwurf = await ausgabe("entwurf", quartal=1)
        offen = await ausgabe("veroeffentlicht", quartal=2)
        await kapitel(entwurf, titel="Geheim")
        await kapitel(offen, titel="Offen")

        titel = [z["titel"] for z in await als(
            LESER, "select titel from public.newsletter_kapitel")]
        assert titel == ["Offen"]
        assert len(await als(
            REDAKTION, "select titel from public.newsletter_kapitel")) == 2

    async def test_eintrag_und_bild_erben_bis_nach_unten(self, db):
        entwurf = await ausgabe("entwurf")
        k = await kapitel(entwurf)
        e = (await anlegen(
            "insert into public.newsletter_eintrag (kapitel_id, untertitel)"
            " values (cast(:k as uuid), 'Titel') returning id", k=k))[0]["id"]
        await anlegen(
            "insert into public.newsletter_bild (eintrag_id, pfad)"
            " values (cast(:e as uuid), 'x/y.jpg')", e=str(e))

        assert await als(LESER, "select * from public.newsletter_eintrag") == []
        assert await als(LESER, "select * from public.newsletter_bild") == []
        assert len(await als(REDAKTION, "select * from public.newsletter_bild")) == 1

    async def test_leser_darf_nicht_schreiben(self, db):
        text = await als_erwartet_fehler(
            LESER,
            "insert into public.newsletter (jahr, quartal) values (2026, 4)")
        assert "row-level security" in text

    async def test_ein_quartal_gibt_es_nur_einmal(self, db):
        await ausgabe(quartal=3)
        text = await als_erwartet_fehler(
            REDAKTION,
            "insert into public.newsletter (jahr, quartal) values (2026, 3)")
        assert "unique" in text or "duplicate" in text


class TestEinfrieren:
    """Beide Funktionen kommen als `security definer` an Daten, die der
    Aufrufer sonst nicht saehe — sie muessen selbst pruefen."""

    async def test_kpi_braucht_das_kennzahlenrecht(self, db):
        k = await kapitel(await ausgabe(), art="kpi", titel="Zahlen")
        text = await als_erwartet_fehler(
            REDAKTION, "select public.newsletter_kpi_einfrieren(cast(:k as uuid))", k=k)
        assert "kennzahlen" in text

    async def test_neuzugaenge_brauchen_das_personalrecht(self, db):
        k = await kapitel(await ausgabe(), art="neuzugaenge", titel="Neu")
        text = await als_erwartet_fehler(
            REDAKTION_KPI,
            "select public.newsletter_neuzugaenge_einfrieren(cast(:k as uuid))", k=k)
        assert "personal" in text

    async def test_kpi_friert_die_zahlen_der_ausgabe_ein(self, db):
        n = await ausgabe(quartal=3)
        k = await kapitel(n, art="kpi", titel="Zahlen")
        await anlegen(
            "insert into public.personio_employees (id, first_name, last_name,"
            " department, status, hire_date, synced_at)"
            " values (1, 'A', 'Muster', 'Fertigung', 'active', :d, now())",
            d=date(2026, 8, 1))

        stand = (await als_dauerhaft(
            REDAKTION_KPI,
            "select public.newsletter_kpi_einfrieren(cast(:k as uuid)) as s", k=k))[0]["s"]
        assert stand["gesamt"] == 1
        assert "verteilung" in stand

    async def test_der_stand_bleibt_stehen(self, db):
        """Eine Ausgabe soll sagen, was sie damals sagte."""
        n = await ausgabe(quartal=3)
        k = await kapitel(n, art="kpi", titel="Zahlen")
        await anlegen(
            "insert into public.personio_employees (id, first_name, last_name,"
            " status, hire_date, synced_at)"
            " values (1, 'A', 'Muster', 'active', :d, now())", d=date(2026, 8, 1))
        await als_dauerhaft(
            REDAKTION_KPI, "select public.newsletter_kpi_einfrieren(cast(:k as uuid))", k=k)

        # Die Belegschaft dreht sich weiter.
        await anlegen(
            "insert into public.personio_employees (id, first_name, last_name,"
            " status, hire_date, synced_at)"
            " values (2, 'B', 'Beispiel', 'active', :d, now())", d=date(2026, 9, 1))

        stand = (await als(
            REDAKTION_KPI,
            "select stand from public.newsletter_kapitel where id = cast(:k as uuid)",
            k=k))[0]["stand"]
        assert stand["gesamt"] == 1

    async def test_neuzugaenge_nur_aus_dem_quartal_der_ausgabe(self, db):
        n = await ausgabe(jahr=2026, quartal=3)          # Juli bis September
        k = await kapitel(n, art="neuzugaenge", titel="Neu")
        for nr, tag in ((1, date(2026, 6, 30)), (2, date(2026, 7, 1)),
                        (3, date(2026, 9, 30)), (4, date(2026, 10, 1))):
            await anlegen(
                "insert into public.personio_employees (id, first_name, last_name,"
                " status, hire_date, synced_at)"
                " values (:i, 'V', :nn, 'active', :d, now())",
                i=nr, nn=f"N{nr}", d=tag)

        stand = (await als_dauerhaft(
            REDAKTION_HR,
            "select public.newsletter_neuzugaenge_einfrieren(cast(:k as uuid)) as s",
            k=k))[0]["s"]
        assert [z["nachname"] for z in stand] == ["N2", "N3"]

    async def test_kein_geburtsdatum_und_kein_foto(self, db):
        """Befund 4 im Altprojekt. Ein Newsletter braucht beides nicht."""
        n = await ausgabe()
        k = await kapitel(n, art="neuzugaenge", titel="Neu")
        await anlegen(
            "insert into public.personio_employees (id, first_name, last_name,"
            " status, hire_date, raw_json, synced_at)"
            " values (1, 'A', 'Muster', 'active', :d,"
            " '{\"birthday\": \"1990-01-01\"}'::jsonb, now())", d=date(2026, 8, 1))
        stand = (await als_dauerhaft(
            REDAKTION_HR,
            "select public.newsletter_neuzugaenge_einfrieren(cast(:k as uuid)) as s",
            k=k))[0]["s"]
        assert set(stand[0]) == {"vorname", "nachname", "abteilung", "hire_date"}

    async def test_falsche_kapitelart_wird_abgelehnt(self, db):
        k = await kapitel(await ausgabe(), art="eintraege")
        text = await als_erwartet_fehler(
            REDAKTION_KPI, "select public.newsletter_kpi_einfrieren(cast(:k as uuid))", k=k)
        assert "kpi-kapitel" in text


class TestBilder:
    async def test_hochladen_darf_nur_die_redaktion(self, db):
        text = await als_erwartet_fehler(
            LESER,
            "insert into storage.objects (bucket_id, name)"
            " values ('newsletter', :n)", n=f"{USER_ID}/bild.jpg")
        assert "row-level security" in text
        await als(REDAKTION, "insert into storage.objects (bucket_id, name)"
                             " values ('newsletter', :n)", n=f"{USER_ID}/bild.jpg")

    async def test_lesen_darf_jeder_mit_newsletter_recht(self, db):
        """Anders als beim Feedback absichtlich weit — ein Newsletter ohne
        Bilder ist keiner."""
        await anlegen("insert into storage.objects (bucket_id, name)"
                      " values ('newsletter', :n)", n=f"{USER_ID}/bild.jpg")
        try:
            assert len(await als(
                LESER,
                "select * from storage.objects where bucket_id = 'newsletter'")) == 1
            assert await als(
                FREMD,
                "select * from storage.objects where bucket_id = 'newsletter'") == []
        finally:
            async with SessionLocal() as s:
                async with s.begin():
                    await s.execute(sa.text(
                        "set local storage.allow_delete_query = 'true'"))
                    await s.execute(sa.text(
                        "delete from storage.objects where bucket_id = 'newsletter'"))

    async def test_der_eimer_ist_nicht_oeffentlich(self, db):
        zeile = (await anlegen(
            "select public, file_size_limit from storage.buckets"
            " where id = 'newsletter'"))[0]
        assert zeile["public"] is False
        assert zeile["file_size_limit"] == 10 * 1024 * 1024


class TestRedaktionsablauf:
    """NEW-01: Anlage, Bearbeitung, Anzeige — mit Testdaten, ohne Versand."""

    async def test_neue_ausgabe_ist_ein_entwurf(self, db):
        await als_dauerhaft(REDAKTION, "insert into public.newsletter (jahr, quartal) values (2026, 4)")
        zeilen = await anlegen("select status, titel from public.newsletter")
        assert zeilen == [{"status": "entwurf", "titel": None}]

    async def test_bearbeiten_setzt_den_aenderungszeitpunkt(self, db):
        n = await ausgabe("entwurf")
        await anlegen("update public.newsletter set geaendert_am = '2020-01-01'"
                      " where id = cast(:n as uuid)", n=n)
        await als_dauerhaft(REDAKTION, "update public.newsletter set titel = 'Sommer'"
                                       " where id = cast(:n as uuid)", n=n)
        zeile = (await anlegen("select titel, geaendert_am from public.newsletter"))[0]
        assert zeile["titel"] == "Sommer"
        assert zeile["geaendert_am"].year > 2020

    async def test_leser_aendert_nichts(self, db):
        n = await ausgabe("veroeffentlicht")
        assert await als(LESER, "update public.newsletter set titel = 'X'"
                                " where id = cast(:n as uuid) returning id", n=n) == []

    async def test_veroeffentlichen_macht_die_ausgabe_lesbar(self, db):
        n = await ausgabe("entwurf")
        assert await als(LESER, "select id from public.newsletter") == []
        await als_dauerhaft(REDAKTION, "update public.newsletter set status = 'veroeffentlicht'"
                                       " where id = cast(:n as uuid)", n=n)
        assert len(await als(LESER, "select id from public.newsletter")) == 1

    async def test_anzeige_liefert_kapitel_und_eintraege_in_ihrer_reihenfolge(self, db):
        n = await ausgabe("veroeffentlicht")
        for titel, nr in (("Zweites", 2), ("Erstes", 1)):
            k = (await anlegen(
                "insert into public.newsletter_kapitel (newsletter_id, titel, sortierung)"
                " values (cast(:n as uuid), :t, :s) returning id", n=n, t=titel, s=nr))[0]["id"]
            await anlegen(
                "insert into public.newsletter_eintrag (kapitel_id, untertitel, inhalt_md)"
                " values (:k, :u, '**fett**')", k=k, u=f"Beitrag {titel}")
        zeilen = await als(
            LESER,
            "select k.titel, e.untertitel, e.inhalt_md from public.newsletter_kapitel k"
            " join public.newsletter_eintrag e on e.kapitel_id = k.id order by k.sortierung")
        assert [z["titel"] for z in zeilen] == ["Erstes", "Zweites"]
        assert zeilen[0]["inhalt_md"] == "**fett**"

    async def test_eintrag_bearbeiten_darf_nur_die_redaktion(self, db):
        k = await kapitel(await ausgabe("veroeffentlicht"))
        await anlegen("insert into public.newsletter_eintrag (kapitel_id, untertitel)"
                      " values (cast(:k as uuid), 'Alt')", k=k)
        assert await als(LESER, "update public.newsletter_eintrag set untertitel = 'Neu'"
                                " returning id") == []
        geaendert = await als(REDAKTION, "update public.newsletter_eintrag set untertitel = 'Neu'"
                                         " returning untertitel")
        assert geaendert == [{"untertitel": "Neu"}]

    async def test_ausgabe_loeschen_nimmt_kapitel_eintraege_und_bildzeilen_mit(self, db):
        n = await ausgabe("entwurf")
        k = await kapitel(n)
        e = (await anlegen("insert into public.newsletter_eintrag (kapitel_id) values"
                           " (cast(:k as uuid)) returning id", k=k))[0]["id"]
        await anlegen("insert into public.newsletter_bild (eintrag_id, pfad) values (:e, 'x/y.jpg')",
                      e=e)
        await als_dauerhaft(REDAKTION, "delete from public.newsletter")
        for tabelle in ("newsletter_kapitel", "newsletter_eintrag", "newsletter_bild"):
            assert await anlegen(f"select id from public.{tabelle}") == []


class TestPeriodenbezug:
    """Eine Ausgabe gehört zu genau einem Quartal, und was sie einfriert,
    kommt aus diesem Quartal."""

    @pytest.mark.parametrize("quartal", [0, 5])
    async def test_nur_quartale_eins_bis_vier(self, db, quartal):
        text = await als_erwartet_fehler(
            REDAKTION, "insert into public.newsletter (jahr, quartal) values (2026, :q)", q=quartal)
        assert "check" in text

    async def test_kpi_stichtag_ist_das_quartalsende(self, db):
        k = await kapitel(await ausgabe(jahr=2025, quartal=2), art="kpi", titel="Zahlen")
        stand = (await als_dauerhaft(
            REDAKTION_KPI,
            "select public.newsletter_kpi_einfrieren(cast(:k as uuid)) as s", k=k))[0]["s"]
        assert stand["stichtag"] == "2025-06-30"

    async def test_neuzugaenge_im_vierten_quartal_enden_am_jahreswechsel(self, db):
        n = await ausgabe(jahr=2025, quartal=4)
        k = await kapitel(n, art="neuzugaenge", titel="Neu")
        for nr, tag in ((1, date(2025, 9, 30)), (2, date(2025, 10, 1)),
                        (3, date(2025, 12, 31)), (4, date(2026, 1, 1))):
            await anlegen(
                "insert into public.personio_employees (id, first_name, last_name,"
                " status, hire_date, synced_at)"
                " values (:i, 'V', :nn, 'active', :d, now())", i=nr, nn=f"N{nr}", d=tag)
        stand = (await als_dauerhaft(
            REDAKTION_HR,
            "select public.newsletter_neuzugaenge_einfrieren(cast(:k as uuid)) as s",
            k=k))[0]["s"]
        assert [z["nachname"] for z in stand] == ["N2", "N3"]
