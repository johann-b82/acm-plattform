"""Personen aus `directus_users` übernehmen.

Passwörter sind nicht portierbar: Directus und GoTrue speichern sie mit
verschiedenen Verfahren, und ein Hash lässt sich nicht umrechnen. Jede Person
bekommt deshalb ein neues, zufälliges Passwort. Der Lauf gibt die Liste als
CSV auf die Ausgabe — genau einmal, danach hilft nur Zurücksetzen.

Rechte kommen nicht mit. Die alte Welt kannte drei Rollen für die ganze
Anwendung, die neue vergibt sie je App über Gruppen. Was sich sinnvoll
abbilden lässt, ist die Gruppenzugehörigkeit:

    Administrator -> Plattform-Admins

Alles andere wird bewusst nicht geraten und in der Verwaltung gesetzt.
"""
from __future__ import annotations

import csv
import io
from dataclasses import dataclass, field

import sqlalchemy as sa

from app.db import SessionLocal
from app.routers.verwaltung import erzeuge_passwort, gotrue_nutzer_anlegen

ROLLE_ZU_GRUPPE = {"Administrator": "Plattform-Admins"}


@dataclass
class Bericht:
    angelegt: list[tuple[str, str]] = field(default_factory=list)  # (email, passwort)
    schon_da: list[str] = field(default_factory=list)
    uebersprungen: list[str] = field(default_factory=list)
    gescheitert: list[tuple[str, str]] = field(default_factory=list)

    def csv(self) -> str:
        puffer = io.StringIO()
        schreiber = csv.writer(puffer, delimiter=";")
        schreiber.writerow(["email", "passwort"])
        for email, passwort in self.angelegt:
            schreiber.writerow([email, passwort])
        return puffer.getvalue()

    def zeilen(self) -> list[str]:
        z = [
            f"Angelegt: {len(self.angelegt)}",
            f"Gab es schon: {len(self.schon_da)}",
        ]
        if self.uebersprungen:
            z.append(f"Übersprungen (keine E-Mail oder gesperrt): {len(self.uebersprungen)}")
        if self.gescheitert:
            z.append(f"Gescheitert: {len(self.gescheitert)}")
            z += [f"  {email}: {grund}" for email, grund in self.gescheitert]
        return z


async def uebernehmen(quelle: sa.engine.Engine, trocken: bool = False) -> Bericht:
    bericht = Bericht()

    with quelle.connect() as conn:
        alte = [
            dict(r)
            for r in conn.execute(
                sa.text(
                    "select u.email, u.status, r.name as rolle"
                    "  from directus_users u"
                    "  left join directus_roles r on r.id = u.role"
                    " order by u.email"
                )
            ).mappings()
        ]

    for person in alte:
        email = (person["email"] or "").strip().lower()
        # Gesperrte oder eingeladene Konten kommen nicht mit: wer nicht aktiv
        # war, soll nicht durch die Übernahme wieder Zugang bekommen.
        if not email or person["status"] != "active":
            bericht.uebersprungen.append(email or "(ohne E-Mail)")
            continue
        if trocken:
            bericht.angelegt.append((email, "(trocken)"))
            continue

        gruppe = ROLLE_ZU_GRUPPE.get(person["rolle"] or "")
        passwort = erzeuge_passwort()
        status_code, koerper = await gotrue_nutzer_anlegen(email, passwort)

        if status_code in (409, 422):
            # Zweiter Lauf: die Person gibt es schon. Das Passwort bleibt, wie
            # es ist — aber die Gruppe wird trotzdem gesetzt, sonst bliebe sie
            # nach einem abgebrochenen ersten Lauf für immer ohne Rechte.
            bericht.schon_da.append(email)
            if gruppe:
                vorhandene_id = await _id_zu_email(email)
                if vorhandene_id:
                    await _in_gruppe(vorhandene_id, gruppe)
            continue
        if status_code >= 400:
            bericht.gescheitert.append((email, f"HTTP {status_code}"))
            continue

        bericht.angelegt.append((email, passwort))
        if gruppe:
            await _in_gruppe(str(koerper["id"]), gruppe)

    return bericht


async def _in_gruppe(nutzer_id: str, gruppe: str) -> None:
    # `cast(:nid as uuid)` statt `:nid::uuid`: SQLAlchemy liest die zwei
    # Doppelpunkte als weiteren Platzhalter und bricht ab.
    async with SessionLocal() as session:
        async with session.begin():
            await session.execute(
                sa.text(
                    "insert into public.user_groups (user_id, group_id)"
                    " select cast(:nid as uuid), id from public.groups where name = :name"
                    " on conflict do nothing"
                ),
                {"nid": nutzer_id, "name": gruppe},
            )


async def _id_zu_email(email: str) -> str | None:
    async with SessionLocal() as session:
        gefunden = await session.scalar(
            sa.text("select id from auth.users where lower(email) = :mail"),
            {"mail": email},
        )
    return str(gefunden) if gefunden else None
