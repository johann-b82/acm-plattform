"""Personen anlegen.

Gruppen, Mitgliedschaften und Rechte pflegt die Oberflaeche direkt ueber
PostgREST — dort entscheiden die Policies. Eine Person anzulegen geht so
nicht: dafuer braucht es die Admin-API von GoTrue und damit den
`service_role`-Schluessel, und der darf den Browser nie erreichen. Deshalb
genau dieser eine Endpunkt hier.

Es gibt bewusst keinen Einladungsversand: dafuer muesste ein SMTP-Server
konfiguriert sein. Stattdessen wird ein Passwort erzeugt und einmalig
zurueckgegeben; die Weitergabe passiert ausserhalb des Systems.
"""
from __future__ import annotations

import secrets
import string

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator

from app.auth import require_app
from app.config import settings

router = APIRouter(
    prefix="/api/verwaltung",
    tags=["verwaltung"],
    dependencies=[Depends(require_app("platform", "admin"))],
)

# Ohne mehrdeutige Zeichen (0/O, 1/l/I), weil das Passwort vorgelesen und
# abgetippt wird.
_ALPHABET = "".join(
    c for c in string.ascii_letters + string.digits if c not in "0O1lI"
)


def erzeuge_passwort(laenge: int = 20) -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(laenge))


class NutzerAnlegen(BaseModel):
    email: str

    @field_validator("email")
    @classmethod
    def _grobpruefung(cls, wert: str) -> str:
        """Nur die grobe Form.

        Die Haus-Domaene ist `.local`; strenge Pruefer lehnen sie ab, weil sie
        nicht oeffentlich zustellbar ist. Ueber die Gueltigkeit entscheidet
        GoTrue, hier faellt nur offensichtlicher Unsinn raus.
        """
        wert = wert.strip()
        lokal, trenner, domaene = wert.partition("@")
        if not (trenner and lokal and "." in domaene) or any(c.isspace() for c in wert):
            raise ValueError("keine E-Mail-Adresse")
        return wert


class NutzerAngelegt(BaseModel):
    id: str
    email: str
    passwort: str


async def gotrue_nutzer_anlegen(email: str, passwort: str) -> tuple[int, dict]:
    """Ruft die Admin-API von GoTrue auf und gibt Status und Koerper zurueck.

    Eigene Funktion, damit Tests genau diese Naht ersetzen koennen, ohne den
    HTTP-Client global zu tauschen — der wuerde auch den Testclient treffen.
    """
    kopf = {
        "apikey": settings.SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {settings.SERVICE_ROLE_KEY}",
    }
    async with httpx.AsyncClient(timeout=10) as client:
        antwort = await client.post(
            f"{settings.GOTRUE_URL.rstrip('/')}/admin/users",
            headers=kopf,
            json={"email": email, "password": passwort, "email_confirm": True},
        )
    try:
        koerper = antwort.json()
    except ValueError:
        koerper = {}
    return antwort.status_code, koerper


@router.post("/nutzer", response_model=NutzerAngelegt, status_code=201)
async def nutzer_anlegen(daten: NutzerAnlegen) -> NutzerAngelegt:
    """Legt die Person in GoTrue an und gibt das Passwort genau einmal zurueck.

    Die Person hat danach keine Rechte. Rechte bekommt sie ueber eine Gruppe.
    """
    passwort = erzeuge_passwort()
    status_code, koerper = await gotrue_nutzer_anlegen(daten.email, passwort)

    if status_code in (409, 422):
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Diese E-Mail-Adresse gibt es schon."
        )
    if status_code >= 400:
        # Kein Durchreichen des Fremdtextes: er kann den Schluessel enthalten.
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, "Anlegen bei der Anmeldung fehlgeschlagen."
        )

    return NutzerAngelegt(
        id=str(koerper["id"]), email=str(koerper["email"]), passwort=passwort
    )
