"""Personio-Abgleich anstoßen.

Der Abgleich ist der einzige Teil von HR, der in Python bleiben muss: er
spricht mit einem fremden System. Gerechnet wird danach in SQL.

Zwei Aufrufer brauchen ihn, und sie weisen sich verschieden aus — deshalb
zwei Routen statt einer Route mit zwei Türen:

  `POST /api/hr/sync`         ein HR-Admin über die Oberfläche, normales Token
  `POST /api/hr/sync/geplant` der nächtliche pg_cron-Job, gemeinsames Geheimnis

Dazu `GET /api/hr/listen`: die Auswahllisten für die Einstellungsmaske. Auch
sie spricht mit einem fremden System — die Abwesenheits*arten* werden nicht
abgeglichen und stehen in keiner Tabelle.

Der Cron-Weg braucht ein eigenes Verfahren, weil ein SQL-Job kein Nutzer-Token
besitzt und keins erzeugen kann, ohne den JWT-Schlüssel in der Datenbank zu
haben. Ohne gesetztes `HR_SYNC_TOKEN` ist diese Route zu.

Und `GET /api/hr/foto/{id}`: das Profilbild fürs Organigramm, durchgereicht
von Personio.
"""
from __future__ import annotations

import hmac
import logging

from fastapi import APIRouter, Depends, Header, HTTPException, Response, status
from pydantic import BaseModel

from app.auth import require_app
from app.config import settings
from app.personio import zugang
from app.personio.client import PersonioFehler
from app.personio.listen import sammeln
from app.personio.sync import Ergebnis, NichtEingerichtet, abgleichen

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/hr", tags=["hr"])


class ArtRead(BaseModel):
    id: int
    name: str


class ListenRead(BaseModel):
    abwesenheitsarten: list[ArtRead]
    abteilungen: list[str]
    felder: list[str]
    hinweis: str | None = None
    arten_aus_bestand: bool = False


class AbgleichErgebnis(BaseModel):
    status: str
    mitarbeiter: int
    anwesenheiten: int
    abwesenheiten: int
    entfernt: int
    dauer_sekunden: float
    fehler: str | None = None


def _antwort(e: Ergebnis) -> AbgleichErgebnis:
    return AbgleichErgebnis(
        status=e.status,
        mitarbeiter=e.mitarbeiter,
        anwesenheiten=e.anwesenheiten,
        abwesenheiten=e.abwesenheiten,
        entfernt=e.entfernt,
        dauer_sekunden=round(e.dauer_sekunden, 2),
        fehler=e.fehler,
    )


async def _laufen_lassen() -> AbgleichErgebnis:
    try:
        return _antwort(await abgleichen())
    except NichtEingerichtet as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except PersonioFehler as exc:
        # Der Fehler steht schon im Protokoll; hier nur der Statuscode.
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Personio: {exc}") from exc


def _geheimnis_pruefen(x_hr_sync_token: str | None = Header(default=None)) -> None:
    """Vergleich über `compare_digest`: ein `==` verriete über die Laufzeit,
    wie viele Zeichen stimmen."""
    if not settings.HR_SYNC_TOKEN:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "HR_SYNC_TOKEN ist nicht gesetzt"
        )
    if not x_hr_sync_token or not hmac.compare_digest(x_hr_sync_token, settings.HR_SYNC_TOKEN):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Sync-Token fehlt oder stimmt nicht")


@router.post(
    "/sync",
    response_model=AbgleichErgebnis,
    dependencies=[Depends(require_app("hr", "admin"))],
)
async def sync_von_hand() -> AbgleichErgebnis:
    """Abgleich sofort ausführen. Dauert je nach Fenster eine bis mehrere Minuten."""
    return await _laufen_lassen()


@router.post(
    "/sync/geplant",
    response_model=AbgleichErgebnis,
    dependencies=[Depends(_geheimnis_pruefen)],
    include_in_schema=False,
)
async def sync_geplant() -> AbgleichErgebnis:
    """Wird von pg_cron über pg_net gerufen. Nicht in der OpenAPI-Liste."""
    return await _laufen_lassen()


@router.get(
    "/listen",
    response_model=ListenRead,
    dependencies=[Depends(require_app("platform", "admin"))],
)
async def auswahllisten() -> ListenRead:
    """Was in den Einstellungen zur Auswahl steht, statt abgetippt zu werden.

    Antwortet auch dann mit 200, wenn Personio nicht erreichbar ist: dann sind
    die Arten der Notnagel aus dem Bestand und `hinweis` sagt warum. Ein 500
    spränge einem Admin ins Gesicht, der bloß eine Abteilung eintragen will.
    """
    listen = await sammeln()
    return ListenRead(
        abwesenheitsarten=[ArtRead(id=a.id, name=a.name) for a in listen.abwesenheitsarten],
        abteilungen=listen.abteilungen,
        felder=listen.felder,
        hinweis=listen.hinweis,
        arten_aus_bestand=listen.arten_aus_bestand,
    )


@router.get("/foto/{employee_id}", dependencies=[Depends(require_app("hr"))])
async def foto(employee_id: int) -> Response:
    """Das Personio-Profilbild einer Person, gefunden über ihre Personio-Kennung.

    Kein Bild, kein Zugang zu Personio — beides ist 404: das Organigramm zeigt
    dann die Initialen. Zwischengespeichert wird im Browser, nicht hier; der
    Dienst bleibt ohne Zustand.
    """
    klient = await zugang.klient()
    if klient is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kein Bild.")
    try:
        bild = await klient.profilbild(employee_id)
    except PersonioFehler as fehler:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Personio antwortet nicht.") from fehler
    finally:
        await klient.schliessen()
    if bild is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kein Bild.")
    daten, typ = bild
    return Response(
        content=daten,
        media_type=typ,
        headers={"Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff"},
    )
