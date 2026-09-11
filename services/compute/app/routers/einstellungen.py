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
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app import geheim
from app.auth import Claims, require_app
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
