"""Die AD-Konfiguration lesen und schreiben (Tabelle + Dienstkonto-Geheimnis).

Die Zeile `ad_konfiguration` sagt, gegen welches AD geprüft wird; das
Dienstkonto-Passwort liegt Fernet-verschlüsselt in `geheimnisse` unter
`ad_dienst`. Nur `compute` liest beides zusammen — die Einstellungsseite
erfährt vom Passwort bloß, ob eines hinterlegt ist.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app import geheim
from app.ad.ldap import AdKonfig
from app.db import SessionLocal, ad_konfiguration, geheimnisse

DIENST_GEHEIMNIS = "ad_dienst"


@dataclass(frozen=True)
class AdStand:
    """Was die Einstellungsseite sieht — ohne das Passwort selbst."""

    aktiv: bool
    host: str | None
    port: int
    upn_suffix: str | None
    basis_dn: str | None
    dienst_konto_dn: str | None
    gruppen_basis_dn: str | None
    tls_pruefen: bool
    dienst_passwort_gesetzt: bool
    schluessel_bereit: bool
    geaendert_am: datetime | None


async def _dienst_passwort() -> str | None:
    async with SessionLocal() as s:
        zeile = (
            await s.execute(
                sa.select(geheimnisse.c.geheimtext).where(geheimnisse.c.schluessel == DIENST_GEHEIMNIS)
            )
        ).first()
    if not zeile:
        return None
    try:
        return geheim.entschluesseln(zeile[0])
    except (geheim.KeinSchluessel, geheim.NichtLesbar):
        return None


async def laden() -> AdKonfig | None:
    """Die einsatzbereite Konfiguration für den Bind — `None`, wenn AD aus ist
    oder Pflichtangaben fehlen."""
    async with SessionLocal() as s:
        zeile = (await s.execute(sa.select(ad_konfiguration))).mappings().first()
    if not zeile or not zeile["aktiv"] or not zeile["host"] or not zeile["basis_dn"]:
        return None
    # Ohne Dienstkonto muss der UPN-Suffix da sein, sonst lässt sich kein
    # Bind-Name bauen.
    if not zeile["dienst_konto_dn"] and not zeile["upn_suffix"]:
        return None
    return AdKonfig(
        host=zeile["host"],
        port=zeile["port"],
        basis_dn=zeile["basis_dn"],
        upn_suffix=zeile["upn_suffix"],
        dienst_konto_dn=zeile["dienst_konto_dn"],
        dienst_passwort=await _dienst_passwort(),
        gruppen_basis_dn=zeile["gruppen_basis_dn"],
        tls_pruefen=zeile["tls_pruefen"],
    )


async def aktiv() -> bool:
    return (await laden()) is not None


async def stand() -> AdStand:
    async with SessionLocal() as s:
        zeile = (await s.execute(sa.select(ad_konfiguration))).mappings().first()
    passwort_da = (await _dienst_passwort()) is not None
    return AdStand(
        aktiv=bool(zeile["aktiv"]) if zeile else False,
        host=zeile["host"] if zeile else None,
        port=zeile["port"] if zeile else 636,
        upn_suffix=zeile["upn_suffix"] if zeile else None,
        basis_dn=zeile["basis_dn"] if zeile else None,
        dienst_konto_dn=zeile["dienst_konto_dn"] if zeile else None,
        gruppen_basis_dn=zeile["gruppen_basis_dn"] if zeile else None,
        tls_pruefen=zeile["tls_pruefen"] if zeile else True,
        dienst_passwort_gesetzt=passwort_da,
        schluessel_bereit=geheim.einsatzbereit(),
        geaendert_am=zeile["geaendert_am"] if zeile else None,
    )


async def speichern(felder: dict) -> None:
    """Die Nicht-Geheimnis-Felder setzen. Unbekannte Schlüssel ignoriert."""
    erlaubt = {
        "aktiv", "host", "port", "upn_suffix", "basis_dn",
        "dienst_konto_dn", "gruppen_basis_dn", "tls_pruefen",
    }
    werte = {k: v for k, v in felder.items() if k in erlaubt}
    if not werte:
        return
    werte["geaendert_am"] = datetime.now(timezone.utc)
    async with SessionLocal() as s:
        async with s.begin():
            await s.execute(sa.update(ad_konfiguration).where(ad_konfiguration.c.id.is_(True)).values(**werte))


async def dienst_passwort_setzen(klartext: str, benutzer_id: str | None) -> None:
    zeile = {
        "schluessel": DIENST_GEHEIMNIS,
        "geheimtext": geheim.verschluesseln(klartext),
        "geaendert_am": datetime.now(timezone.utc),
        "geaendert_von": benutzer_id,
    }
    async with SessionLocal() as s:
        async with s.begin():
            await s.execute(
                pg_insert(geheimnisse)
                .values(**zeile)
                .on_conflict_do_update(
                    index_elements=[geheimnisse.c.schluessel],
                    set_={k: v for k, v in zeile.items() if k != "schluessel"},
                )
            )
