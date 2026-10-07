"""ODBC-Sync: der Windows-Worker füllt die Tabellen aus Apollo.

Apollo (CONZEPT 16) hat nur einen 32-bit-Windows-ODBC-Treiber; der
compute-Dienst läuft unter Linux und kann ihn nicht nutzen. Deshalb liest ein
kleiner Worker auf einer Windows-VM Apollo und POSTet die Exporte je Art an
`POST /api/odbc/<art>`. Hier läuft dann **derselbe** Parser und `importieren()`
wie beim manuellen Upload (`routers/uploads.py`) — die KPI-Berechnung in SQL
bleibt unverändert, egal woher die Zeilen kommen. `upload_batches.quelle` steht
auf `odbc`.

Zwei Türen wie beim Personio-Abgleich, nur umgekehrt verteilt:
  - Authentifizierung über ein gemeinsames Geheimnis (`X-ODBC-Token`), weil der
    Worker kein Nutzer-Token besitzt. Ohne gesetztes `ODBC_SYNC_TOKEN` ist die
    Route zu (503).
  - Angenommen wird nur, wenn der Umschalter `datenquelle` auf `odbc` steht
    (sonst 409) — so ist immer genau eine Quelle aktiv, und ein versehentlicher
    Worker-Lauf im Extrakt-Betrieb füllt nichts.

Nicht in der OpenAPI-Liste (`include_in_schema=False`): eine interne Schnittstelle.
"""
from __future__ import annotations

import hmac

from fastapi import APIRouter, Depends, Header, HTTPException, UploadFile, status

from app.config import settings
from app.routers.uploads import REGISTRY, UploadErgebnis, datenquelle_lesen, importieren


def _odbc_token_pruefen(x_odbc_token: str | None = Header(default=None)) -> None:
    """Vergleich über `compare_digest`: ein `==` verriete über die Laufzeit,
    wie viele Zeichen stimmen."""
    if not settings.ODBC_SYNC_TOKEN:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "ODBC_SYNC_TOKEN ist nicht gesetzt"
        )
    if not x_odbc_token or not hmac.compare_digest(x_odbc_token, settings.ODBC_SYNC_TOKEN):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "ODBC-Token fehlt oder stimmt nicht")


async def _nur_bei_odbc() -> None:
    if (await datenquelle_lesen()) != "odbc":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Datenquelle steht nicht auf ODBC. Umschalten in den Einstellungen.",
        )


router = APIRouter(
    prefix="/api/odbc",
    tags=["odbc"],
    include_in_schema=False,
    dependencies=[Depends(_odbc_token_pruefen), Depends(_nur_bei_odbc)],
)


@router.post("/{art}", response_model=UploadErgebnis)
async def odbc_sync(art: str, file: UploadFile) -> UploadErgebnis:
    """Eine Export-Datei je Art aus dem Windows-Worker einlesen.

    `art` ist eine der Schlüssel aus `REGISTRY` (umsatz, lagerbewegungen, …).
    Die Datei hat dasselbe Format wie der manuelle Extrakt.
    """
    if art not in REGISTRY:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Unbekannte Art: {art}")
    return await importieren(art, file, hochgeladen_von=None, quelle="odbc")
