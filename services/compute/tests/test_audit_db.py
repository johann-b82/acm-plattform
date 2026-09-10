"""Audit gegen eine echte Datenbank.

Drei Dinge, die im Altprojekt als offen dokumentiert sind, stehen hier anders —
und genau die werden geprüft: der Verlauf schreibt sich selbst, er kennt die
handelnde Person, und er lässt sich nicht mehr ändern.
"""
from __future__ import annotations

import pytest
import pytest_asyncio
import sqlalchemy as sa

from app.db import SessionLocal
from tests._auth import USER_ID

LESER = '{"sub":"%s","role":"authenticated","apps":{"quality":"viewer"}}' % USER_ID
PFLEGER = (
    '{"sub":"%s","role":"authenticated","email":"qs@acm.local",'
    '"apps":{"quality":"editor"}}' % USER_ID
)
FREMD = '{"sub":"%s","role":"authenticated","apps":{"hr":"admin"}}' % USER_ID

VORLAGE = "11111111-1111-1111-1111-111111111111"
AUDIT = "22222222-2222-2222-2222-222222222222"


@pytest_asyncio.fixture
async def db(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")

    async def leeren():
        async with SessionLocal() as s:
            async with s.begin():
                # Der Verlauf lässt sich nicht löschen — der Trigger muss für
                # das Aufräumen kurz weichen.
                await s.execute(
                    sa.text("alter table public.audit_verlauf disable trigger audit_verlauf_fest")
                )
                await s.execute(sa.text("delete from public.audit_verlauf"))
                await s.execute(
                    sa.text("alter table public.audit_verlauf enable trigger audit_verlauf_fest")
                )
                await s.execute(sa.text("delete from public.audits"))
                await s.execute(sa.text("delete from public.audit_vorlagen"))
                await s.execute(sa.text("delete from public.audit_normen"))

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


async def sql(text: str, **params):
    async with SessionLocal() as s:
        async with s.begin():
            ergebnis = await s.execute(sa.text(text), params)
            return [dict(r) for r in ergebnis.mappings()] if ergebnis.returns_rows else []


async def vorlage_mit_schritten():
    await sql(
        "insert into public.audit_vorlagen (id, name, kategorie)"
        " values (:v, 'Systemaudit', 'system')",
        v=VORLAGE,
    )
    await sql(
        "insert into public.audit_vorlage_schritte (vorlage_id, position, titel, pflicht)"
        " values (:v, 1, 'Auditplan', true), (:v, 2, 'Eröffnung', true),"
        " (:v, 3, 'Bericht', false)",
        v=VORLAGE,
    )


async def audit_anlegen(mit_vorlage: bool = True):
    await sql(
        "insert into public.audits (id, nummer, titel, art, vorlage_id)"
        " values (:a, 'A-2026-01', 'EN 9100', 'intern', :v)",
        a=AUDIT,
        v=VORLAGE if mit_vorlage else None,
    )


class TestPhasenAusVorlage:
    @pytest.mark.asyncio
    async def test_die_phasen_kommen_beim_anlegen_mit(self, db):
        await vorlage_mit_schritten()
        await audit_anlegen()
        zeilen = await sql(
            "select position, titel, pflicht from public.audit_phasen order by position"
        )
        assert [z["titel"] for z in zeilen] == ["Auditplan", "Eröffnung", "Bericht"]
        assert [z["pflicht"] for z in zeilen] == [True, True, False]

    @pytest.mark.asyncio
    async def test_ohne_vorlage_bleibt_die_checkliste_leer(self, db):
        await audit_anlegen(mit_vorlage=False)
        assert await sql("select count(*) as n from public.audit_phasen") == [{"n": 0}]

    @pytest.mark.asyncio
    async def test_eine_geaenderte_vorlage_schreibt_keine_historie_um(self, db):
        """Die Phasen werden kopiert, nicht verknüpft."""
        await vorlage_mit_schritten()
        await audit_anlegen()
        await sql(
            "update public.audit_vorlage_schritte set titel = 'Ganz anders'"
            " where vorlage_id = :v and position = 1",
            v=VORLAGE,
        )
        zeilen = await sql("select titel from public.audit_phasen where position = 1")
        assert zeilen[0]["titel"] == "Auditplan"


class TestVerlauf:
    @pytest.mark.asyncio
    async def test_anlegen_und_statuswechsel_stehen_drin(self, db):
        await vorlage_mit_schritten()
        await audit_anlegen()
        await sql("update public.audits set status = 'in_durchfuehrung' where id = :a", a=AUDIT)
        zeilen = await sql(
            "select aktion, entitaet, alt, neu from public.audit_verlauf order by id"
        )
        assert zeilen[0]["aktion"] == "angelegt"
        assert zeilen[-1] == {
            "aktion": "status",
            "entitaet": "audits",
            "alt": "geplant",
            "neu": "in_durchfuehrung",
        }

    @pytest.mark.asyncio
    async def test_er_kennt_die_handelnde_person(self, db):
        """Im Altprojekt steht dort nur eine UUID: das Token trug keine echte
        Adresse, und eine hineinzuschreiben hätte eine Identität erfunden."""
        await audit_anlegen(mit_vorlage=False)
        async with SessionLocal() as s:
            async with s.begin():
                await s.execute(sa.text("set local role authenticated"))
                await s.execute(
                    sa.text("select set_config('request.jwt.claims', :c, true)"),
                    {"c": PFLEGER},
                )
                await s.execute(
                    sa.text("update public.audits set status = 'berichtet' where id = :a"),
                    {"a": AUDIT},
                )
        zeilen = await sql(
            "select wer_email from public.audit_verlauf where aktion = 'status'"
        )
        assert zeilen[0]["wer_email"] == "qs@acm.local"

    @pytest.mark.asyncio
    async def test_der_grund_geht_mit(self, db):
        await vorlage_mit_schritten()
        await audit_anlegen()
        await sql(
            "update public.audit_phasen set status = 'nicht_zutreffend',"
            " uebersprungen_warum = 'Kunde hat verzichtet' where position = 2"
        )
        zeilen = await sql(
            "select grund from public.audit_verlauf where aktion = 'status'"
            " and entitaet = 'audit_phasen'"
        )
        assert zeilen[0]["grund"] == "Kunde hat verzichtet"

    @pytest.mark.asyncio
    async def test_er_laesst_sich_nicht_aendern(self, db):
        """Der Kern: im Altprojekt hält das nur die Absprache, dass kein Router
        ein UPDATE anbietet. Hier weist die Datenbank es ab."""
        await audit_anlegen(mit_vorlage=False)
        with pytest.raises(Exception, match="nicht ändern oder löschen"):
            await sql("update public.audit_verlauf set neu = 'gefälscht'")

    @pytest.mark.asyncio
    async def test_er_laesst_sich_nicht_loeschen(self, db):
        await audit_anlegen(mit_vorlage=False)
        with pytest.raises(Exception, match="nicht ändern oder löschen"):
            await sql("delete from public.audit_verlauf")

    @pytest.mark.asyncio
    async def test_auch_ueber_postgrest_gibt_es_kein_recht_dazu(self, db):
        await audit_anlegen(mit_vorlage=False)
        with pytest.raises(Exception, match="permission denied|keine Berechtigung"):
            await als(PFLEGER, "update public.audit_verlauf set neu = 'x'")


class TestPhasenregeln:
    @pytest.mark.asyncio
    async def test_pflichtphase_entfaellt_nicht_ohne_grund(self, db):
        await vorlage_mit_schritten()
        await audit_anlegen()
        with pytest.raises(Exception, match="audit_phasen_grund"):
            await sql(
                "update public.audit_phasen set status = 'nicht_zutreffend'"
                " where position = 1"
            )

    @pytest.mark.asyncio
    async def test_eine_freiwillige_phase_darf_ohne_grund_entfallen(self, db):
        await vorlage_mit_schritten()
        await audit_anlegen()
        await sql(
            "update public.audit_phasen set status = 'nicht_zutreffend' where position = 3"
        )

    @pytest.mark.asyncio
    async def test_erledigt_braucht_ein_datum(self, db):
        await vorlage_mit_schritten()
        await audit_anlegen()
        with pytest.raises(Exception, match="audit_phasen_erledigt"):
            await sql("update public.audit_phasen set status = 'erledigt' where position = 1")


class TestStand:
    @pytest.mark.asyncio
    async def test_ueberfaellig_wird_gerechnet_nicht_gespeichert(self, db):
        await vorlage_mit_schritten()
        await audit_anlegen()
        await sql(
            "update public.audit_phasen set faellig_am = current_date - 1 where position = 1"
        )
        stand = await sql("select phasen, erledigt, ueberfaellig from public.audit_stand")
        assert stand[0] == {"phasen": 3, "erledigt": 0, "ueberfaellig": 1}

        await sql(
            "update public.audit_phasen set status='erledigt', erledigt_am=current_date"
            " where position = 1"
        )
        stand = await sql("select erledigt, ueberfaellig from public.audit_stand")
        assert stand[0] == {"erledigt": 1, "ueberfaellig": 0}


class TestRechte:
    @pytest.mark.asyncio
    async def test_ohne_qualitaet_bleibt_alles_unsichtbar(self, db):
        await audit_anlegen(mit_vorlage=False)
        assert await als(FREMD, "select nummer from public.audits") == []

    @pytest.mark.asyncio
    async def test_ein_leser_darf_nicht_pflegen(self, db):
        await audit_anlegen(mit_vorlage=False)
        assert await als(LESER, "select nummer from public.audits") != []
        with pytest.raises(Exception, match="row-level security|violates"):
            await als(LESER, "insert into public.audits (nummer, titel, art)"
                             " values ('X', 'Y', 'intern')")

    @pytest.mark.asyncio
    async def test_eine_benutzte_norm_laesst_sich_nicht_loeschen(self, db):
        """Sie wird stillgelegt — sonst verlöre ein Audit still seine Grundlage."""
        await audit_anlegen(mit_vorlage=False)
        norm = (
            await sql(
                "insert into public.audit_normen (regelwerk, klausel)"
                " values ('EN 9100', '9.2') returning id"
            )
        )[0]["id"]
        await sql(
            "insert into public.audit_normbezug (audit_id, norm_id) values (:a, :n)",
            a=AUDIT,
            n=norm,
        )
        with pytest.raises(Exception, match="violates foreign key|restrict"):
            await sql("delete from public.audit_normen where id = :n", n=norm)
