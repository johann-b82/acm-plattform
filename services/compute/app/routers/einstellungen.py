"""Einstellungen, die ein Geheimnis tragen.

Was ohne Geheimnis auskommt, pflegt die Oberfläche direkt über PostgREST.
Die Personio-Zugangsdaten gehen diesen Weg nicht: verschlüsselt werden sie mit
dem Schlüssel aus der Umgebung von `compute`, und den kennt nur dieser Dienst.
Herauskommen dürfen sie überhaupt nicht — die Maske erfährt bloß, ob etwas
hinterlegt ist, seit wann und von wem.

    GET    /api/einstellungen/personio          Stand
    PUT    /api/einstellungen/personio          eintragen oder ersetzen
    DELETE /api/einstellungen/personio          wieder entfernen
    POST   /api/einstellungen/personio/pruefen  einmal bei Personio anmelden

Dazu das Firmenlogo, weil ein SVG vor dem Speichern gereinigt werden muss, und
der E-Mail-Versand über Microsoft 365, weil er ein Secret trägt:

    POST   /api/einstellungen/logo                     hochladen (PNG, JPEG, SVG)
    GET    /api/einstellungen/email                    Stand, ohne Geheimnisse
    PUT    /api/einstellungen/email                    speichern, sendet nichts
    POST   /api/einstellungen/email/test               Testmail an eine Adresse
    POST   /api/einstellungen/email/delegiert/start    Geräte-Code-Anmeldung
    POST   /api/einstellungen/email/delegiert/abfragen einmal nachfragen
    POST   /api/einstellungen/email/delegiert/trennen  Anmeldung vergessen
"""
from __future__ import annotations

from typing import Literal

import sqlalchemy as sa
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel, Field

from app import geheim
from app.auth import Claims, require_app
from app.db import SessionLocal, plattform_einstellungen
from app.dokumente import logo, logo_pruefung
from app.email import dienst as email
from app.email.graph import GraphFehler
from app.personio import zugang
from app.personio.client import PersonioAnmeldeFehler, PersonioFehler

router = APIRouter(
    prefix="/api/einstellungen",
    tags=["einstellungen"],
    dependencies=[Depends(require_app("platform", "admin"))],
)


class PersonioStand(BaseModel):
    gesetzt: bool
    quelle: str | None
    geaendert_am: str | None = None
    geaendert_von: str | None = None
    schluessel_bereit: bool


class PersonioEingabe(BaseModel):
    client_id: str = Field(min_length=1, max_length=200)
    client_secret: str = Field(min_length=1, max_length=500)


class Pruefung(BaseModel):
    erreichbar: bool
    meldung: str | None = None


def _stand(stand: zugang.Stand) -> PersonioStand:
    return PersonioStand(
        gesetzt=stand.gesetzt,
        quelle=stand.quelle,
        geaendert_am=stand.geaendert_am.isoformat() if stand.geaendert_am else None,
        geaendert_von=stand.geaendert_von,
        schluessel_bereit=stand.schluessel_bereit,
    )


@router.get("/personio", response_model=PersonioStand)
async def personio_stand() -> PersonioStand:
    return _stand(await zugang.stand())


@router.put("/personio", response_model=PersonioStand)
async def personio_setzen(
    eingabe: PersonioEingabe, claims: Claims = Depends(require_app("platform", "admin"))
) -> PersonioStand:
    try:
        await zugang.setzen(
            eingabe.client_id.strip(), eingabe.client_secret.strip(), claims.sub
        )
    except geheim.KeinSchluessel as fehler:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(fehler)) from fehler
    return _stand(await zugang.stand())


@router.delete("/personio", response_model=PersonioStand)
async def personio_loeschen() -> PersonioStand:
    await zugang.loeschen()
    return _stand(await zugang.stand())


@router.post("/personio/pruefen", response_model=Pruefung)
async def personio_pruefen() -> Pruefung:
    """Einmal anmelden — mehr nicht. Ein Mitarbeiterabruf kostet Seiten und
    läuft bei Personio schnell in die Drosselung."""
    klient = await zugang.klient()
    if klient is None:
        return Pruefung(erreichbar=False, meldung="Es sind keine Zugangsdaten hinterlegt.")
    try:
        await klient.anmelden()
    except PersonioFehler as fehler:
        # Personio antwortet auf falsche Zugangsdaten mal mit 401, mal mit 403.
        abgelehnt = isinstance(fehler, PersonioAnmeldeFehler) or fehler.status == 403
        if abgelehnt:
            return Pruefung(erreichbar=False, meldung="Personio lehnt die Zugangsdaten ab.")
        return Pruefung(erreichbar=False, meldung=str(fehler))
    finally:
        await klient.schliessen()
    return Pruefung(erreichbar=True)


# --- Firmenlogo (SET-07) -----------------------------------------------------


class LogoStand(BaseModel):
    pfad: str | None
    dateiname: str | None
    mime: str | None
    geaendert_am: str


@router.post("/logo", response_model=LogoStand)
async def logo_hochladen(
    datei: UploadFile = File(...), claims: Claims = Depends(require_app("platform", "admin"))
) -> LogoStand:
    """PNG, JPEG oder SVG bis einschließlich 5 MB. Der Typ kommt aus dem Inhalt;
    ein SVG wird gereinigt und für die Formblätter gerastert."""
    daten = await datei.read(logo_pruefung.MAX_BYTES + 1)
    try:
        stand = await logo.hochladen(daten, datei.filename or "logo", claims.sub)
    except logo_pruefung.LogoAbgelehnt as fehler:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(fehler)) from fehler
    except logo.SpeicherFehler as fehler:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(fehler)) from fehler
    return LogoStand(**stand)


# --- E-Mail (SET-16) ---------------------------------------------------------


class EmailStand(BaseModel):
    aktiv: bool
    modus: str
    tenant_id: str | None
    client_id: str | None
    absender: str | None
    absender_name: str | None
    secret_gesetzt: bool
    delegiert_verbunden: bool
    delegiert_konto: str | None
    schluessel_bereit: bool


def _leer_ist_nichts(wert: str | None) -> str | None:
    return (wert or "").strip() or None


class EmailEingabe(BaseModel):
    aktiv: bool
    modus: Literal["app", "delegiert"]
    tenant_id: str | None = Field(default=None, max_length=64)
    client_id: str | None = Field(default=None, max_length=64)
    #: Leer lässt das hinterlegte stehen.
    client_secret: str | None = Field(default=None, max_length=500)
    absender: str | None = Field(default=None, max_length=254, pattern=r"^$|^[^@\s]+@[^@\s]+$")
    absender_name: str | None = Field(default=None, max_length=120)


class Testmail(BaseModel):
    an: str = Field(max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class Versand(BaseModel):
    ok: bool
    fehler: str | None


class Geraetecode(BaseModel):
    device_code: str
    user_code: str
    verification_uri: str
    expires_in: int
    interval: int
    message: str


class GeraetecodeAbfrage(BaseModel):
    device_code: str = Field(min_length=1, max_length=2000)


class Anmeldung(BaseModel):
    status: str
    konto: str | None
    fehler: str | None


@router.get("/email", response_model=EmailStand)
async def email_stand() -> EmailStand:
    return EmailStand(**await email.stand())


@router.put("/email", response_model=EmailStand)
async def email_speichern(
    eingabe: EmailEingabe, claims: Claims = Depends(require_app("platform", "admin"))
) -> EmailStand:
    """Speichert nur. Mit Microsoft gesprochen wird erst bei der Testmail."""
    try:
        await email.speichern(
            email.Eingabe(
                aktiv=eingabe.aktiv,
                modus=eingabe.modus,
                tenant_id=_leer_ist_nichts(eingabe.tenant_id),
                client_id=_leer_ist_nichts(eingabe.client_id),
                client_secret=_leer_ist_nichts(eingabe.client_secret),
                absender=_leer_ist_nichts(eingabe.absender),
                absender_name=_leer_ist_nichts(eingabe.absender_name),
            ),
            claims.sub,
        )
    except geheim.KeinSchluessel as fehler:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(fehler)) from fehler
    return EmailStand(**await email.stand())


@router.post("/email/test", response_model=Versand)
async def email_testen(eingabe: Testmail) -> Versand:
    """Eine Probe an die eingegebene Adresse. Ein abgelehnter Versand ist eine
    Antwort mit `ok=false` und Meldung, kein Serverfehler."""
    async with SessionLocal() as sitzung:
        app_name = (await sitzung.execute(sa.select(plattform_einstellungen.c.app_name))).scalar_one()
    fehler = await email.testmail(eingabe.an, app_name)
    return Versand(ok=fehler is None, fehler=fehler)


@router.post("/email/delegiert/start", response_model=Geraetecode)
async def email_delegiert_start() -> Geraetecode:
    try:
        daten = await email.delegiert_starten()
    except (email.NichtEingerichtet, GraphFehler) as fehler:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(fehler)) from fehler
    return Geraetecode(
        device_code=daten["device_code"],
        user_code=daten["user_code"],
        verification_uri=daten.get("verification_uri") or daten.get("verification_url", ""),
        expires_in=int(daten.get("expires_in", 900)),
        interval=int(daten.get("interval", 5)),
        message=daten.get("message", ""),
    )


@router.post("/email/delegiert/abfragen", response_model=Anmeldung)
async def email_delegiert_abfragen(
    eingabe: GeraetecodeAbfrage, claims: Claims = Depends(require_app("platform", "admin"))
) -> Anmeldung:
    try:
        return Anmeldung(**await email.delegiert_abfragen(eingabe.device_code, claims.sub))
    except (email.NichtEingerichtet, GraphFehler, geheim.KeinSchluessel) as fehler:
        return Anmeldung(status="error", konto=None, fehler=str(fehler))


@router.post("/email/delegiert/trennen", response_model=EmailStand)
async def email_delegiert_trennen() -> EmailStand:
    await email.delegiert_trennen()
    return EmailStand(**await email.stand())
