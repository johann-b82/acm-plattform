"""Der Mailversand der Plattform: Konfiguration, Testmail, delegierte Anmeldung.

Die Einstellungen stehen in `email_einstellungen` (ohne Rechte für
`authenticated`), die beiden Geheimnisse — Client-Secret und das
Erneuerungstoken der delegierten Anmeldung — verschlüsselt in `geheimnisse`.
Herauskommen tut nur, *ob* sie gesetzt sind.

Gesendet wird nur auf ausdrücklichen Aufruf. Öffnen und Speichern der Maske
sprechen nicht mit Microsoft. `senden` ist zugleich der Eingang für andere
Module, die später Mails verschicken wollen.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

import httpx
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app import geheim
from app.db import SessionLocal, email_einstellungen, geheimnisse
from app.email import graph

SECRET = "email_client_secret"
ERNEUERUNG = "email_refresh_token"


def neuer_http() -> httpx.AsyncClient:
    """Eigene Funktion, damit der Test eine Attrappe unterschieben kann."""
    return httpx.AsyncClient(timeout=30.0)


class NichtEingerichtet(Exception):
    """Ausgeschaltet oder unvollständig — die Meldung sagt, was fehlt."""


@dataclass(frozen=True)
class Eingabe:
    aktiv: bool
    modus: str
    tenant_id: str | None
    client_id: str | None
    client_secret: str | None
    absender: str | None
    absender_name: str | None


async def _zeile(sitzung) -> dict:
    return dict((await sitzung.execute(sa.select(email_einstellungen))).mappings().one())


async def _geheimnisse(sitzung) -> dict[str, bytes]:
    zeilen = (await sitzung.execute(
        sa.select(geheimnisse.c.schluessel, geheimnisse.c.geheimtext)
        .where(geheimnisse.c.schluessel.in_([SECRET, ERNEUERUNG]))
    )).all()
    return {z.schluessel: bytes(z.geheimtext) for z in zeilen}


async def _geheimnis_setzen(sitzung, schluessel: str, wert: str, benutzer: str | None) -> None:
    jetzt = datetime.now(timezone.utc)
    zeile = {"schluessel": schluessel, "geheimtext": geheim.verschluesseln(wert),
             "geaendert_am": jetzt, "geaendert_von": benutzer}
    await sitzung.execute(
        pg_insert(geheimnisse).values(**zeile).on_conflict_do_update(
            index_elements=[geheimnisse.c.schluessel],
            set_={k: v for k, v in zeile.items() if k != "schluessel"},
        )
    )


async def stand() -> dict:
    async with SessionLocal() as sitzung:
        zeile = await _zeile(sitzung)
        abgelegt = await _geheimnisse(sitzung)
    return {
        "aktiv": zeile["aktiv"],
        "modus": zeile["modus"],
        "tenant_id": zeile["tenant_id"],
        "client_id": zeile["client_id"],
        "absender": zeile["absender"],
        "absender_name": zeile["absender_name"],
        "secret_gesetzt": SECRET in abgelegt,
        "delegiert_verbunden": ERNEUERUNG in abgelegt,
        "delegiert_konto": zeile["delegiert_konto"] if ERNEUERUNG in abgelegt else None,
        "schluessel_bereit": geheim.einsatzbereit(),
    }


async def speichern(eingabe: Eingabe, benutzer: str | None) -> None:
    """Ein leeres Secret lässt das hinterlegte stehen."""
    async with SessionLocal() as sitzung:
        async with sitzung.begin():
            if eingabe.client_secret:
                await _geheimnis_setzen(sitzung, SECRET, eingabe.client_secret, benutzer)
            await sitzung.execute(sa.update(email_einstellungen).values(
                aktiv=eingabe.aktiv, modus=eingabe.modus, tenant_id=eingabe.tenant_id,
                client_id=eingabe.client_id, absender=eingabe.absender,
                absender_name=eingabe.absender_name,
                geaendert_am=datetime.now(timezone.utc), geaendert_von=benutzer,
            ))


async def senden(an: list[str], betreff: str, html: str) -> None:
    """Eine Mail über den eingestellten Weg. Wirft `NichtEingerichtet` oder
    `graph.GraphFehler`."""
    async with SessionLocal() as sitzung:
        zeile = await _zeile(sitzung)
        abgelegt = await _geheimnisse(sitzung)
    if not zeile["aktiv"]:
        raise NichtEingerichtet("Der E-Mail-Versand ist nicht aktiviert.")
    if not (zeile["tenant_id"] and zeile["client_id"]):
        raise NichtEingerichtet("Tenant-ID und Client-ID fehlen.")

    async with neuer_http() as http:
        if zeile["modus"] == "delegiert":
            if ERNEUERUNG not in abgelegt:
                raise NichtEingerichtet("Es ist kein Konto bei Microsoft angemeldet.")
            token = await graph.token_delegiert(
                http, zeile["tenant_id"], zeile["client_id"], geheim.entschluesseln(abgelegt[ERNEUERUNG])
            )
            if token.erneuerung:
                # Microsoft hat rotiert: ohne das neue Token ginge die nächste Mail nicht.
                async with SessionLocal() as sitzung:
                    async with sitzung.begin():
                        await _geheimnis_setzen(sitzung, ERNEUERUNG, token.erneuerung, None)
            await graph.senden(http, token, absender=None, absender_name=None,
                               an=an, betreff=betreff, html=html)
        else:
            if SECRET not in abgelegt or not zeile["absender"]:
                raise NichtEingerichtet("Client-Secret und Absenderadresse fehlen.")
            token = await graph.token_app(
                http, zeile["tenant_id"], zeile["client_id"], geheim.entschluesseln(abgelegt[SECRET])
            )
            await graph.senden(http, token, absender=zeile["absender"],
                               absender_name=zeile["absender_name"], an=an, betreff=betreff, html=html)


async def testmail(an: str, app_name: str) -> str | None:
    """Die Probe aus der Maske. Gibt die Fehlermeldung zurück oder None."""
    try:
        await senden(
            [an],
            f"{app_name} — Test-E-Mail",
            f"<p>Dies ist eine Test-E-Mail aus {app_name}.</p>"
            "<p>Wenn sie ankommt, ist der Versand über Microsoft 365 richtig eingerichtet.</p>",
        )
    except (NichtEingerichtet, graph.GraphFehler, geheim.KeinSchluessel, geheim.NichtLesbar) as fehler:
        return str(fehler)
    return None


async def _anmeldedaten() -> tuple[str, str]:
    async with SessionLocal() as sitzung:
        zeile = await _zeile(sitzung)
    if not (zeile["tenant_id"] and zeile["client_id"]):
        raise NichtEingerichtet("Tenant-ID und Client-ID müssen zuerst gespeichert werden.")
    return zeile["tenant_id"], zeile["client_id"]


async def delegiert_starten() -> dict:
    tenant, client_id = await _anmeldedaten()
    async with neuer_http() as http:
        return await graph.geraetecode_starten(http, tenant, client_id)


async def delegiert_abfragen(geraetecode: str, benutzer: str | None) -> dict:
    tenant, client_id = await _anmeldedaten()
    async with neuer_http() as http:
        ergebnis = await graph.geraetecode_abfragen(http, tenant, client_id, geraetecode)
        if ergebnis["status"] != "complete":
            return {"status": ergebnis["status"], "konto": None, "fehler": ergebnis.get("fehler")}
        if not ergebnis.get("erneuerung"):
            return {"status": "error", "konto": None,
                    "fehler": "Microsoft hat kein Erneuerungstoken geschickt (offline_access?)."}
        adresse = await graph.konto(http, ergebnis["zugriff"])
    async with SessionLocal() as sitzung:
        async with sitzung.begin():
            await _geheimnis_setzen(sitzung, ERNEUERUNG, ergebnis["erneuerung"], benutzer)
            await sitzung.execute(sa.update(email_einstellungen).values(
                delegiert_konto=adresse, modus="delegiert",
                geaendert_am=datetime.now(timezone.utc), geaendert_von=benutzer,
            ))
    return {"status": "complete", "konto": adresse, "fehler": None}


async def delegiert_trennen() -> None:
    async with SessionLocal() as sitzung:
        async with sitzung.begin():
            await sitzung.execute(sa.delete(geheimnisse).where(geheimnisse.c.schluessel == ERNEUERUNG))
            await sitzung.execute(sa.update(email_einstellungen).values(delegiert_konto=None))
