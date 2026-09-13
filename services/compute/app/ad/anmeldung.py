"""AD-Anmeldung: Passwort prüfen, GoTrue-Nutzer sicherstellen, Gruppen spiegeln.

Der Ablauf ist die „Token-Austausch"-Variante aus ADR-0004: `compute` prüft das
AD-Passwort (per LDAPS-Bind), sorgt für einen passenden GoTrue-Nutzer, spiegelt
die AD-Gruppen in `groups`/`user_groups` und setzt ein **Einmalpasswort**.
Dieses Einmalpasswort geht nur an den Server der Weboberfläche (nie an den
Browser); der meldet sich damit regulär bei Supabase an und bekommt das Cookie.

Das Recht je App hängt weiter an der Gruppe: ein Admin ordnet den
AD-Gruppen unter „Nutzer und Gruppen" App-Rechte zu. Der `apps`-Claim entsteht
dann wie bei jedem Konto aus `user_groups`/`app_grants`.
"""
from __future__ import annotations

import sqlalchemy as sa

from app.ad.ldap import AdPerson, AdVerzeichnis
from app.db import SessionLocal
from app.routers import verwaltung


class Abgelehnt(Exception):
    """Benutzer oder Passwort stimmen nicht — oder die Person hat keine E-Mail."""


def _gruppenname(dn: str) -> str:
    """„CN=Vertrieb,OU=…,DC=…" → „Vertrieb". Fällt auf den ganzen DN zurück."""
    erster = dn.split(",", 1)[0].strip()
    if "=" in erster:
        return erster.split("=", 1)[1].strip() or dn
    return dn


async def _nutzer_id(session, email: str) -> str | None:
    zeile = (
        await session.execute(
            sa.text("select id::text from auth.users where lower(email) = :e"),
            {"e": email.lower()},
        )
    ).first()
    return zeile[0] if zeile else None


async def _gotrue_sicherstellen(email: str) -> str:
    """Gibt die GoTrue-Nutzer-Id zurück; legt das Konto bei Bedarf an."""
    async with SessionLocal() as session:
        vorhanden = await _nutzer_id(session, email)
    if vorhanden:
        return vorhanden

    status_code, _ = await verwaltung.gotrue_nutzer_anlegen(email, verwaltung.erzeuge_passwort())
    # 409/422: das Konto gibt es schon (Wettlauf) — dann steht es gleich in der DB.
    if status_code >= 400 and status_code not in (409, 422):
        raise Abgelehnt("Konto konnte nicht angelegt werden.")

    async with SessionLocal() as session:
        neu = await _nutzer_id(session, email)
    if not neu:
        raise Abgelehnt("Konto konnte nicht angelegt werden.")
    return neu


async def _gruppen_spiegeln(session, user_id: str, person: AdPerson) -> None:
    """Bringt die AD-Gruppen der Person in `groups`/`user_groups` auf Stand.

    Nur `source='ad'` wird angefasst — von Hand gepflegte Gruppen und ihre
    Mitgliedschaften bleiben unberührt."""
    gewuenscht_ids: list[str] = []
    for dn in person.gruppen:
        gid = (
            await session.execute(
                sa.text("select id::text from public.groups where source='ad' and external_id = :dn"),
                {"dn": dn},
            )
        ).first()
        if gid:
            group_id = gid[0]
            await session.execute(
                sa.text("update public.groups set name = :n, synced_at = now() where id = cast(:id as uuid)"),
                {"n": _gruppenname(dn), "id": group_id},
            )
        else:
            group_id = (
                await session.execute(
                    sa.text(
                        "insert into public.groups (name, source, external_id, synced_at)"
                        " values (:n, 'ad', :dn, now()) returning id::text"
                    ),
                    {"n": _gruppenname(dn), "dn": dn},
                )
            ).scalar_one()
        gewuenscht_ids.append(group_id)

    # Mitgliedschaften angleichen: fehlende ergänzen, verwaiste AD-Mitgliedschaften
    # entfernen. Andere Quellen bleiben stehen.
    for group_id in gewuenscht_ids:
        await session.execute(
            sa.text(
                "insert into public.user_groups (user_id, group_id)"
                " values (cast(:u as uuid), cast(:g as uuid)) on conflict do nothing"
            ),
            {"u": user_id, "g": group_id},
        )
    await session.execute(
        sa.text(
            "delete from public.user_groups ug using public.groups g"
            " where ug.group_id = g.id and ug.user_id = cast(:u as uuid) and g.source='ad'"
            " and not (ug.group_id::text = any(:behalten))"
        ),
        {"u": user_id, "behalten": [f"{g}" for g in gewuenscht_ids] or ["00000000-0000-0000-0000-000000000000"]},
    )


async def anmelden(verzeichnis: AdVerzeichnis, benutzer: str, passwort: str) -> tuple[str, str]:
    """Prüft Benutzer+Passwort am AD und gibt `(email, einmalpasswort)` zurück.

    Wirft `Abgelehnt` bei falschen Zugangsdaten; `AdNichtErreichbar` (aus
    `ldap`) reicht durch, damit der Endpunkt „vorübergehend nicht erreichbar"
    von „abgelehnt" unterscheiden kann."""
    person = verzeichnis.person_lesen(benutzer.strip(), passwort)
    if person is None:
        raise Abgelehnt("Benutzer oder Passwort falsch.")
    if not person.email:
        raise Abgelehnt("Dieses AD-Konto hat keine E-Mail-Adresse.")

    user_id = await _gotrue_sicherstellen(person.email)

    async with SessionLocal() as session:
        async with session.begin():
            await _gruppen_spiegeln(session, user_id, person)

    einmalpasswort = verwaltung.erzeuge_passwort()
    status_code, _ = await verwaltung.gotrue_passwort_setzen(user_id, einmalpasswort)
    if status_code >= 400:
        raise Abgelehnt("Anmeldung konnte nicht abgeschlossen werden.")
    return person.email, einmalpasswort
