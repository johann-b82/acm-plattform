"""Migration 0051 gegen eine echte Datenbank.

* SET-04: `app_grants_read` verglich `ug.group_id` mit sich selbst — jede
  Person in irgendeiner Gruppe sah alle Rechte aller Gruppen.
* SET-06: App-Name und Farbrollen in `plattform_einstellungen`, lesbar auch vor
  der Anmeldung, und nur als gültige Hexwerte speicherbar.
* SET-08: Der stündliche Anstoß fragt, ob der Abgleich nach dem eingestellten
  Intervall fällig ist.
* SET-09: Eine Schulungs- oder Kompetenzänderung merkt einen Nachweis vor —
  nur mit eingeschaltetem Schalter, und je Person und Art nur einmal offen.
* SET-16: Die E-Mail-Konfiguration gehört `compute` allein.
* SET-07: Das Logo darf SVG sein, hochladen darf nur noch `compute`.
"""
from __future__ import annotations

import json
from datetime import datetime

import pytest
import pytest_asyncio
import sqlalchemy as sa

from app.db import SessionLocal
from tests._auth import USER_ID

pytestmark = pytest.mark.asyncio

ANDERE_ID = "44444444-4444-4444-4444-444444444444"
GRUPPE_A = "aaaaaaaa-0000-0000-0000-000000000051"
GRUPPE_B = "bbbbbbbb-0000-0000-0000-000000000051"
MITARBEITER = 905101


def claims(apps: dict, sub: str = USER_ID) -> str:
    return json.dumps({"sub": sub, "role": "authenticated", "apps": apps})


async def als(rolle: str, claims_json: str | None, sql: str, **params):
    async with SessionLocal() as s:
        trans = await s.begin()
        try:
            await s.execute(sa.text(f"set local role {rolle}"))
            if claims_json:
                await s.execute(
                    sa.text("select set_config('request.jwt.claims', :c, true)"),
                    {"c": claims_json},
                )
            ergebnis = await s.execute(sa.text(sql), params)
            return [dict(r) for r in ergebnis.mappings()] if ergebnis.returns_rows else []
        finally:
            await trans.rollback()


async def ausfuehren(sql: str, **params):
    async with SessionLocal() as s:
        async with s.begin():
            ergebnis = await s.execute(sa.text(sql), params)
            return [dict(r) for r in ergebnis.mappings()] if ergebnis.returns_rows else []


@pytest_asyncio.fixture
async def db(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")

    async def aufraeumen():
        await ausfuehren("delete from public.personio_nachweise")
        await ausfuehren("delete from public.schulung_teilnahmen where employee_id = :m", m=MITARBEITER)
        await ausfuehren("delete from public.kompetenz_matrizen where blatt = 'test-0051'")
        await ausfuehren("delete from public.schulung_katalog where name = 'Test 0051'")
        await ausfuehren("delete from public.personio_sync_meta")
        await ausfuehren("delete from public.personio_employees where id = :m", m=MITARBEITER)
        await ausfuehren("delete from public.groups where id in (cast(:a as uuid), cast(:b as uuid))",
                         a=GRUPPE_A, b=GRUPPE_B)
        await ausfuehren(
            "update public.plattform_einstellungen set app_name = 'ACM-Plattform', farben = null,"
            " personio_sync_intervall_h = 24, personio_nachweis_aktiv = false,"
            " personio_nachweis_kategorie = null"
        )

    await aufraeumen()
    for kennung, mail in ((USER_ID, "a@example.com"), (ANDERE_ID, "b@example.com")):
        await ausfuehren(
            "insert into auth.users (id, email) values (cast(:i as uuid), :m)"
            " on conflict (id) do nothing",
            i=kennung, m=mail,
        )
    yield
    await aufraeumen()


# --- SET-04 ---------------------------------------------------------------------


async def test_rechte_nur_der_eigenen_gruppen_sichtbar(db):
    await ausfuehren(
        "insert into public.groups (id, name) values (cast(:a as uuid), 'Test A 0051'),"
        " (cast(:b as uuid), 'Test B 0051')",
        a=GRUPPE_A, b=GRUPPE_B,
    )
    await ausfuehren(
        "insert into public.app_grants (group_id, app_id, level) values"
        " (cast(:a as uuid), 'kpi', 'viewer'), (cast(:b as uuid), 'hr', 'admin')",
        a=GRUPPE_A, b=GRUPPE_B,
    )
    await ausfuehren(
        "insert into public.user_groups (user_id, group_id) values (cast(:u as uuid), cast(:a as uuid))",
        u=USER_ID, a=GRUPPE_A,
    )
    sql = ("select group_id::text as gruppe, app_id from public.app_grants"
           " where group_id in (cast(:a as uuid), cast(:b as uuid)) order by app_id")

    mitglied = await als("authenticated", claims({"kpi": "viewer"}), sql, a=GRUPPE_A, b=GRUPPE_B)
    assert mitglied == [{"gruppe": GRUPPE_A, "app_id": "kpi"}]

    fremd = await als("authenticated", claims({}, sub=ANDERE_ID), sql, a=GRUPPE_A, b=GRUPPE_B)
    assert fremd == []

    verwaltung = await als("authenticated", claims({"platform": "admin"}, sub=ANDERE_ID), sql,
                           a=GRUPPE_A, b=GRUPPE_B)
    assert len(verwaltung) == 2


# --- SET-06 ---------------------------------------------------------------------


async def test_erscheinung_lesbar_ohne_anmeldung(db):
    zeilen = await als("anon", None, "select public.plattform_erscheinung() as e")
    e = zeilen[0]["e"]
    assert e["app_name"] == "ACM-Plattform"
    assert e["farben"] is None


async def test_ohne_anmeldung_nicht_die_ganze_zeile(db):
    with pytest.raises(Exception):
        await als("anon", None, "select * from public.plattform_einstellungen")


async def test_farben_nur_als_hexwerte(db):
    gueltig = {
        "hell": {"hauptfarbe": "#0041F6", "textAufHauptfarbe": "#FFFFFF"},
        "dunkel": {"hauptfarbe": "#7A9BFF", "textAufHauptfarbe": "#101418"},
    }
    await ausfuehren("update public.plattform_einstellungen set farben = cast(:f as jsonb)",
                     f=json.dumps(gueltig))
    kaputt = {**gueltig, "hell": {"hauptfarbe": "red;}</style>", "textAufHauptfarbe": "#FFFFFF"}}
    with pytest.raises(Exception):
        await ausfuehren("update public.plattform_einstellungen set farben = cast(:f as jsonb)",
                         f=json.dumps(kaputt))
    with pytest.raises(Exception):
        await ausfuehren("update public.plattform_einstellungen set app_name = '   '")


async def test_app_name_und_farben_setzt_nur_die_verwaltung(db):
    sql = ("update public.plattform_einstellungen set app_name = 'Anders'"
           " where id returning app_name")
    assert await als("authenticated", claims({"hr": "admin"}), sql) == []
    assert await als("authenticated", claims({"platform": "admin"}), sql) == [{"app_name": "Anders"}]


# --- SET-08 ---------------------------------------------------------------------


def zeitpunkt(text: str) -> datetime:
    return datetime.fromisoformat(text)


async def faellig(jetzt: str = "2026-09-12 12:15:00+00:00") -> bool:
    zeilen = await ausfuehren("select public.hr_abgleich_faellig(:j) as f", j=zeitpunkt(jetzt))
    return zeilen[0]["f"]


async def abgleich_um(zeit: str, dauer: float = 60) -> None:
    await ausfuehren(
        "insert into public.personio_sync_meta (gelaufen_am, status, dauer_sekunden)"
        " values (:z, 'ok', :d)",
        z=zeitpunkt(zeit), d=dauer,
    )


async def intervall(stunden: int) -> None:
    await ausfuehren("update public.plattform_einstellungen set personio_sync_intervall_h = :h", h=stunden)


async def test_ohne_bisherigen_abgleich_faellig(db):
    assert await faellig() is True


async def test_manuell_heisst_nie_geplant(db):
    await intervall(0)
    assert await faellig() is False


async def test_taeglich_erst_nach_einem_tag(db):
    await intervall(24)
    await abgleich_um("2026-09-11 18:00:00+00")
    assert await faellig("2026-09-12 12:15:00+00") is False
    # Gestern 12:16 geendet, eine Minute gedauert: begonnen 12:15 — heute 12:15 fällig.
    await ausfuehren("delete from public.personio_sync_meta")
    await abgleich_um("2026-09-11 12:16:00+00", dauer=60)
    assert await faellig("2026-09-12 12:15:00+00") is True


async def test_stuendlich_trotz_laufzeit_jede_stunde(db):
    await intervall(1)
    # Begonnen 11:15, zwanzig Minuten gedauert.
    await abgleich_um("2026-09-12 11:35:00+00", dauer=1200)
    assert await faellig("2026-09-12 12:15:00+00") is True
    assert await faellig("2026-09-12 11:45:00+00") is False


async def test_intervall_nur_aus_der_auswahl(db):
    with pytest.raises(Exception):
        await intervall(12)


# --- SET-09 ---------------------------------------------------------------------


async def mitarbeiter_und_schulung() -> str:
    await ausfuehren(
        "insert into public.personio_employees (id, first_name, last_name, synced_at)"
        " values (:m, 'Test', 'Person', now())",
        m=MITARBEITER,
    )
    zeilen = await ausfuehren(
        "insert into public.schulung_katalog (bereich, name) values ('Test', 'Test 0051') returning id::text"
    )
    return zeilen[0]["id"]


async def nachweise() -> list[dict]:
    return await ausfuehren(
        "select employee_id, art, erledigt_am from public.personio_nachweise order by art"
    )


async def schalter(an: bool, kategorie: str | None = "4711") -> None:
    await ausfuehren(
        "update public.plattform_einstellungen set personio_nachweis_aktiv = :a,"
        " personio_nachweis_kategorie = :k",
        a=an, k=kategorie,
    )


async def test_ausgeschaltet_wird_nichts_vorgemerkt(db):
    schulung = await mitarbeiter_und_schulung()
    await ausfuehren(
        "insert into public.schulung_teilnahmen (schulung_id, employee_id, aktuell_datum)"
        " values (cast(:s as uuid), :m, date '2026-09-01')",
        s=schulung, m=MITARBEITER,
    )
    assert await nachweise() == []


async def test_ohne_kategorie_wird_nichts_vorgemerkt(db):
    schulung = await mitarbeiter_und_schulung()
    await schalter(True, None)
    await ausfuehren(
        "insert into public.schulung_teilnahmen (schulung_id, employee_id) values (cast(:s as uuid), :m)",
        s=schulung, m=MITARBEITER,
    )
    assert await nachweise() == []


async def test_schulungsaenderung_merkt_einmal_vor(db):
    schulung = await mitarbeiter_und_schulung()
    await schalter(True)
    await ausfuehren(
        "insert into public.schulung_teilnahmen (schulung_id, employee_id, aktuell_datum)"
        " values (cast(:s as uuid), :m, date '2026-09-01')",
        s=schulung, m=MITARBEITER,
    )
    await ausfuehren(
        "update public.schulung_teilnahmen set aktuell_datum = date '2026-09-02' where employee_id = :m",
        m=MITARBEITER,
    )
    offen = await nachweise()
    assert [(n["employee_id"], n["art"], n["erledigt_am"]) for n in offen] == [
        (MITARBEITER, "schulung", None)
    ]


async def test_externe_person_ohne_personio_profil(db):
    schulung = await mitarbeiter_und_schulung()
    await schalter(True)
    await ausfuehren(
        "insert into public.schulung_teilnahmen (schulung_id, personalnummer, mitarbeiter_name)"
        " values (cast(:s as uuid), 'X-1', 'Extern')",
        s=schulung,
    )
    assert await nachweise() == []


async def test_kompetenzaenderung_merkt_fuer_die_person_vor(db):
    await mitarbeiter_und_schulung()
    await schalter(True)
    matrix = (await ausfuehren(
        "insert into public.kompetenz_matrizen (bereich, blatt) values ('safety', 'test-0051') returning id::text"
    ))[0]["id"]
    quali = (await ausfuehren(
        "insert into public.kompetenz_qualifikationen (matrix_id, bezeichnung, reihenfolge)"
        " values (cast(:m as uuid), 'Löten', 1) returning id::text", m=matrix,
    ))[0]["id"]
    person = (await ausfuehren(
        "insert into public.kompetenz_personen (matrix_id, name, employee_id, reihenfolge)"
        " values (cast(:m as uuid), 'Test Person', :e, 1) returning id::text", m=matrix, e=MITARBEITER,
    ))[0]["id"]
    await ausfuehren(
        "insert into public.kompetenz_bewertungen (qualifikation_id, person_id, erfuellungsgrad)"
        " values (cast(:q as uuid), cast(:p as uuid), 80)", q=quali, p=person,
    )
    assert [(n["employee_id"], n["art"]) for n in await nachweise()] == [(MITARBEITER, "kompetenz")]


async def test_erledigter_nachweis_laesst_neuen_zu(db):
    schulung = await mitarbeiter_und_schulung()
    await schalter(True)
    await ausfuehren(
        "insert into public.schulung_teilnahmen (schulung_id, employee_id) values (cast(:s as uuid), :m)",
        s=schulung, m=MITARBEITER,
    )
    await ausfuehren("update public.personio_nachweise set erledigt_am = now()")
    await ausfuehren(
        "update public.schulung_teilnahmen set aktuell_datum = date '2026-09-03' where employee_id = :m",
        m=MITARBEITER,
    )
    alle = await nachweise()
    assert len(alle) == 2
    assert sum(1 for n in alle if n["erledigt_am"] is None) == 1


async def test_warteschlange_nicht_ueber_postgrest_schreibbar(db):
    with pytest.raises(Exception):
        await als("authenticated", claims({"platform": "admin"}),
                  "insert into public.personio_nachweise (employee_id, art) values (1, 'schulung')")


# --- SET-16 ---------------------------------------------------------------------


async def test_email_konfiguration_nicht_ueber_postgrest(db):
    assert (await ausfuehren("select aktiv, modus from public.email_einstellungen")) == [
        {"aktiv": False, "modus": "app"}
    ]
    with pytest.raises(Exception):
        await als("authenticated", claims({"platform": "admin"}), "select * from public.email_einstellungen")


# --- SET-07 ---------------------------------------------------------------------


async def test_logo_darf_svg_sein(db):
    await ausfuehren("update public.plattform_logo set mime = 'image/svg+xml'")
    await ausfuehren("update public.plattform_logo set mime = null, pfad = null, raster_pfad = null")
    with pytest.raises(Exception):
        await ausfuehren("update public.plattform_logo set mime = 'text/html'")
    typen = await ausfuehren("select allowed_mime_types from storage.buckets where id = 'plattform'")
    assert set(typen[0]["allowed_mime_types"]) == {"image/png", "image/jpeg", "image/svg+xml"}


async def test_logo_hochladen_nur_ueber_compute(db):
    # Eine SVG-Datei am Dienst vorbei in den Eimer legen hieße: ungereinigt.
    with pytest.raises(Exception):
        await als(
            "authenticated", claims({"platform": "admin"}),
            "insert into storage.objects (bucket_id, name) values ('plattform', :n)",
            n=f"{USER_ID}/boese.svg",
        )
    with pytest.raises(Exception):
        await als(
            "authenticated", claims({"platform": "admin"}),
            "update public.plattform_logo set pfad = 'x' where id returning pfad",
        )
