"""AD-Provisionierung gegen eine echte Test-Datenbank, mit LDAP-Attrappe.

Geprüft wird das Riskante: aus den AD-Gruppen der Person werden `groups`-Zeilen
(source='ad') und passende `user_groups`; ein zweiter Login mit weniger Gruppen
räumt die verwaisten AD-Mitgliedschaften ab, lässt von Hand gepflegte Gruppen
aber in Ruhe.
"""
from __future__ import annotations

import pytest
import pytest_asyncio
import sqlalchemy as sa

from app.ad import anmeldung as ablauf
from app.ad.ldap import AdPerson
from app.db import SessionLocal
from app.routers import verwaltung

EMAIL = "max@firma.local"
USER_ID = "22222222-2222-2222-2222-222222222222"
VERTRIEB = "CN=Vertrieb,OU=Gruppen,DC=firma,DC=local"
ADMINS = "CN=Admins,OU=Gruppen,DC=firma,DC=local"


class Attrappe:
    """LDAP-Attrappe: gibt eine feste Person zurück oder None (falsches Passwort)."""

    def __init__(self, person: AdPerson | None):
        self.person = person

    def person_lesen(self, benutzer: str, passwort: str) -> AdPerson | None:
        return self.person if passwort == "richtig" else None


def person(*gruppen: str, email: str = EMAIL) -> AdPerson:
    return AdPerson(email=email, name="Max Mustermann", gruppen=tuple(gruppen), dn="CN=Max,DC=firma,DC=local")


@pytest_asyncio.fixture
async def db(datenbank_da, monkeypatch):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")

    async def leeren():
        async with SessionLocal() as s:
            async with s.begin():
                await s.execute(sa.text("delete from public.user_groups where user_id = :u"), {"u": USER_ID})
                await s.execute(sa.text("delete from public.groups where source='ad'"))
                await s.execute(sa.text("delete from public.groups where name='Handgemacht'"))
                await s.execute(sa.text("delete from auth.users where id = :u"), {"u": USER_ID})

    await leeren()
    async with SessionLocal() as s:
        async with s.begin():
            await s.execute(
                sa.text("insert into auth.users (id, email) values (:u, :e)"),
                {"u": USER_ID, "e": EMAIL},
            )

    # GoTrue nicht wirklich rufen: das Konto steht schon in der DB, das
    # Einmalpasswort quittieren wir mit 200.
    async def kein_anlegen(email, passwort):
        return 200, {"id": USER_ID, "email": email}

    async def passwort_ok(user_id, passwort):
        return 200, {}

    monkeypatch.setattr(verwaltung, "gotrue_nutzer_anlegen", kein_anlegen)
    monkeypatch.setattr(verwaltung, "gotrue_passwort_setzen", passwort_ok)
    yield
    await leeren()


async def _ad_gruppen_von(user_id: str) -> set[str]:
    async with SessionLocal() as s:
        rows = (
            await s.execute(
                sa.text(
                    "select g.name from public.user_groups ug join public.groups g on g.id=ug.group_id"
                    " where ug.user_id = :u and g.source='ad'"
                ),
                {"u": user_id},
            )
        ).all()
    return {r[0] for r in rows}


class TestProvisionierung:
    @pytest.mark.asyncio
    async def test_falsches_passwort_wird_abgelehnt(self, db):
        with pytest.raises(ablauf.Abgelehnt):
            await ablauf.anmelden(Attrappe(person(VERTRIEB)), "max", "falsch")

    @pytest.mark.asyncio
    async def test_ohne_email_kein_konto(self, db):
        with pytest.raises(ablauf.Abgelehnt):
            await ablauf.anmelden(Attrappe(person(VERTRIEB, email="")), "max", "richtig")

    @pytest.mark.asyncio
    async def test_gruppen_werden_angelegt_und_zugeordnet(self, db):
        email, einmal = await ablauf.anmelden(Attrappe(person(VERTRIEB, ADMINS)), "max", "richtig")
        assert email == EMAIL
        assert einmal  # ein Einmalpasswort kam zurück
        assert await _ad_gruppen_von(USER_ID) == {"Vertrieb", "Admins"}
        # Die Gruppen tragen source='ad' und den DN als external_id.
        async with SessionLocal() as s:
            quelle = (
                await s.execute(sa.text("select source, external_id from public.groups where name='Vertrieb'"))
            ).first()
        assert quelle[0] == "ad" and quelle[1] == VERTRIEB

    @pytest.mark.asyncio
    async def test_zweiter_login_raeumt_verwaiste_ad_gruppen(self, db):
        await ablauf.anmelden(Attrappe(person(VERTRIEB, ADMINS)), "max", "richtig")
        # Jetzt ist die Person nur noch bei Vertrieb.
        await ablauf.anmelden(Attrappe(person(VERTRIEB)), "max", "richtig")
        assert await _ad_gruppen_von(USER_ID) == {"Vertrieb"}

    @pytest.mark.asyncio
    async def test_handgemachte_gruppe_bleibt_unberuehrt(self, db):
        # Eine von Hand gepflegte Gruppe mit Mitgliedschaft.
        async with SessionLocal() as s:
            async with s.begin():
                gid = (
                    await s.execute(
                        sa.text(
                            "insert into public.groups (name, source) values ('Handgemacht','manual')"
                            " returning id::text"
                        )
                    )
                ).scalar_one()
                await s.execute(
                    sa.text("insert into public.user_groups (user_id, group_id) values (:u, cast(:g as uuid))"),
                    {"u": USER_ID, "g": gid},
                )
        # AD-Login mit ganz anderen Gruppen darf die Handarbeit nicht anfassen.
        await ablauf.anmelden(Attrappe(person(VERTRIEB)), "max", "richtig")
        async with SessionLocal() as s:
            drin = (
                await s.execute(
                    sa.text(
                        "select 1 from public.user_groups ug join public.groups g on g.id=ug.group_id"
                        " where ug.user_id=:u and g.name='Handgemacht'"
                    ),
                    {"u": USER_ID},
                )
            ).first()
        assert drin is not None
