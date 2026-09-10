"""Personio-Abgleich anstoßen.

Der Abgleich ist der einzige Teil von HR, der in Python bleiben muss: er
spricht mit einem fremden System. Gerechnet wird danach in SQL.

Zwei Aufrufer brauchen ihn, und sie weisen sich verschieden aus — deshalb
zwei Routen statt einer Route mit zwei Türen:

  `POST /api/hr/sync`         ein HR-Admin über die Oberfläche, normales Token
  `POST /api/hr/sync/geplant` der nächtliche pg_cron-Job, gemeinsames Geheimnis

Der Cron-Weg braucht ein eigenes Verfahren, weil ein SQL-Job kein Nutzer-Token
besitzt und keins erzeugen kann, ohne den JWT-Schlüssel in der Datenbank zu
haben. Ohne gesetztes `HR_SYNC_TOKEN` ist diese Route zu.
"""
from __future__ import annotations

import hmac
import logging

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel

from app.auth import require_app
from app.config import settings
from app.personio.client import PersonioFehler
from app.personio.sync import Ergebnis, NichtEingerichtet, abgleichen

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/hr", tags=["hr"])


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
