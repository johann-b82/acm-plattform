"""AD-Anmeldung: öffentlicher Prüf-Endpunkt und Admin-Konfiguration.

Der Browser sieht von hier nur den Status („ist AD an?") und schickt beim
Login Benutzer+Passwort. Die Antwort auf ein erfolgreiches Login ist ein
Einmalpasswort **an den Web-Server**, nicht an den Browser — der Web-Server
meldet sich damit bei Supabase an und setzt das Cookie.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.ad import anmeldung as ablauf
from app.ad import konfig as konf
from app.ad.ldap import AdNichtErreichbar, Ldap3Verzeichnis
from app.auth import Claims, require_app
from app.ratsperre import Sperre

router = APIRouter(prefix="/api/anmeldung", tags=["anmeldung"])

# Bremse gegen Passwortraten: 10 Versuche je Minute und Absender.
_bremse = Sperre("ad-login", grenze=10, fenster_s=60.0)


class AdLogin(BaseModel):
    benutzer: str
    passwort: str


class AdSitzung(BaseModel):
    email: str
    einmalpasswort: str


class AdStatus(BaseModel):
    aktiv: bool


@router.get("/ad/status", response_model=AdStatus)
async def ad_status() -> AdStatus:
    """Öffentlich: sagt der Login-Seite, ob sie AD anbieten soll — mehr nicht."""
    return AdStatus(aktiv=await konf.aktiv())


@router.post("/ad", response_model=AdSitzung, dependencies=[Depends(_bremse)])
async def ad_login(daten: AdLogin) -> AdSitzung:
    konfig = await konf.laden()
    if konfig is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "AD-Anmeldung ist nicht eingerichtet.")
    try:
        email, einmal = await ablauf.anmelden(Ldap3Verzeichnis(konfig), daten.benutzer, daten.passwort)
    except ablauf.Abgelehnt:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Benutzer oder Passwort falsch.")
    except AdNichtErreichbar:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Verzeichnisdienst nicht erreichbar.")
    return AdSitzung(email=email, einmalpasswort=einmal)


# ---------------------------------------------------------------------------
# Konfiguration — nur für die Plattform-Verwaltung.
# ---------------------------------------------------------------------------
konfig_router = APIRouter(
    prefix="/api/einstellungen/ad",
    tags=["einstellungen"],
    dependencies=[Depends(require_app("platform", "admin"))],
)


class AdKonfigAus(BaseModel):
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


class AdKonfigEin(BaseModel):
    aktiv: bool
    host: str | None = None
    port: int = 636
    upn_suffix: str | None = None
    basis_dn: str | None = None
    dienst_konto_dn: str | None = None
    gruppen_basis_dn: str | None = None
    tls_pruefen: bool = True


class DienstPasswort(BaseModel):
    passwort: str


def _aus_stand(s: konf.AdStand) -> AdKonfigAus:
    return AdKonfigAus(
        aktiv=s.aktiv, host=s.host, port=s.port, upn_suffix=s.upn_suffix,
        basis_dn=s.basis_dn, dienst_konto_dn=s.dienst_konto_dn,
        gruppen_basis_dn=s.gruppen_basis_dn, tls_pruefen=s.tls_pruefen,
        dienst_passwort_gesetzt=s.dienst_passwort_gesetzt, schluessel_bereit=s.schluessel_bereit,
    )


@konfig_router.get("", response_model=AdKonfigAus)
async def konfig_lesen() -> AdKonfigAus:
    return _aus_stand(await konf.stand())


@konfig_router.put("", response_model=AdKonfigAus)
async def konfig_schreiben(daten: AdKonfigEin) -> AdKonfigAus:
    await konf.speichern(daten.model_dump())
    return _aus_stand(await konf.stand())


@konfig_router.put("/passwort", status_code=204)
async def konfig_passwort(daten: DienstPasswort, claims: Claims = Depends(require_app("platform", "admin"))) -> None:
    if not daten.passwort:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Kein Passwort.")
    await konf.dienst_passwort_setzen(daten.passwort, claims.sub)
