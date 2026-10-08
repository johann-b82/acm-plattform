"""ODBC-Sync: der Windows-Worker füllt die Tabellen aus Apollo — und wird von
der Plattform gesteuert und überwacht.

Apollo (CONZEPT 16) hat nur einen 32-bit-Windows-ODBC-Treiber; der
compute-Dienst läuft unter Linux und kann ihn nicht nutzen. Deshalb liest ein
kleiner Worker auf einer Windows-VM Apollo und POSTet die Exporte je Art an
`POST /api/odbc/<art>`. Hier läuft dann **derselbe** Parser und `importieren()`
wie beim manuellen Upload (`routers/uploads.py`) — die KPI-Berechnung in SQL
bleibt unverändert, egal woher die Zeilen kommen. `upload_batches.quelle` steht
auf `odbc`.

Die VM hat nur ausgehende Verbindungen, kann also keine Befehle annehmen.
Steuerung und Überwachung laufen deshalb spiegelbildlich (0068):
  - `GET /api/odbc/konfig` — der Worker **holt** Intervall, aktive Arten und den
    „jetzt synchronisieren"-Zeitstempel aus `odbc_worker_konfig`.
  - `POST /api/odbc/status` — der Worker **meldet** Herzschlag und je Art den
    letzten Lauf; `compute` schreibt `odbc_worker_status` + `odbc_sync_lauf`.

Authentifiziert ist alles über ein gemeinsames Geheimnis (`X-ODBC-Token`), weil
der Worker kein Nutzer-Token besitzt — ohne gesetztes `ODBC_SYNC_TOKEN` ist die
Route zu (503). Das Datenquelle-Tor (`datenquelle == 'odbc'`, sonst 409) gilt
**nur für die Daten-Route** `/{art}`: Herzschlag und Konfiguration müssen auch
im Extrakt-Betrieb fließen, damit man den Worker vor dem Umschalten sieht und
einrichten kann.

Nicht in der OpenAPI-Liste (`include_in_schema=False`): eine interne Schnittstelle.
"""
from __future__ import annotations

import hmac
from datetime import datetime, timezone

import sqlalchemy as sa
from fastapi import APIRouter, Depends, Header, HTTPException, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.config import settings
from app.db import SessionLocal, odbc_sync_lauf, odbc_worker_konfig, odbc_worker_status
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
    dependencies=[Depends(_odbc_token_pruefen)],
)


# Literale Routen (/konfig, /status) müssen vor der Catch-all-Route /{art}
# stehen — sonst schluckt /{art} ein POST /status als art="status".


# --------------------------------------------------------------------------- #
# Steuerung (Pull): der Worker holt sich seine Konfiguration
# --------------------------------------------------------------------------- #
class WorkerKonfig(BaseModel):
    intervall_min: int
    aktive_arten: list[str]
    sync_angefordert_am: datetime | None = None


@router.get("/konfig", response_model=WorkerKonfig)
async def worker_konfig() -> WorkerKonfig:
    """Intervall, aktive Arten und ein etwaiger Sofort-Sync-Auftrag.

    Bewusst ohne Datenquelle-Tor: der Worker muss seine Einstellungen auch dann
    lesen können, wenn noch auf Extrakte steht (Einrichtung, Probelauf)."""
    async with SessionLocal() as session:
        row = (
            await session.execute(
                sa.select(
                    odbc_worker_konfig.c.intervall_min,
                    odbc_worker_konfig.c.aktive_arten,
                    odbc_worker_konfig.c.sync_angefordert_am,
                )
            )
        ).one()
    return WorkerKonfig(
        intervall_min=row.intervall_min,
        aktive_arten=list(row.aktive_arten or []),
        sync_angefordert_am=row.sync_angefordert_am,
    )


# --------------------------------------------------------------------------- #
# Überwachung (Push): der Worker meldet Herzschlag und Läufe
# --------------------------------------------------------------------------- #
class LaufMeldung(BaseModel):
    art: str = Field(max_length=32)
    status: str = Field(pattern="^(ok|fehler)$")
    zeilen: int | None = None
    dauer_ms: int | None = None
    fehler: str | None = None


class StatusMeldung(BaseModel):
    worker_version: str | None = None
    host: str | None = None
    sync_bestaetigt_am: datetime | None = None
    letzter_fehler: str | None = None
    laeufe: list[LaufMeldung] = Field(default_factory=list)


@router.post("/status")
async def worker_status(meldung: StatusMeldung) -> dict[str, str]:
    """Herzschlag + letzter Lauf je Art. Schreibt `compute` (service_role);
    die Oberfläche liest daraus das Monitoring. Auch ohne Datenquelle-Tor, damit
    man den Worker vor dem Umschalten als „online" sieht."""
    jetzt = datetime.now(timezone.utc)
    async with SessionLocal() as session:
        async with session.begin():
            await session.execute(
                sa.update(odbc_worker_status)
                .where(odbc_worker_status.c.id.is_(True))
                .values(
                    gesehen_am=jetzt,
                    worker_version=meldung.worker_version,
                    host=meldung.host,
                    sync_bestaetigt_am=meldung.sync_bestaetigt_am,
                    letzter_fehler=meldung.letzter_fehler,
                    geaendert_am=jetzt,
                )
            )
            for lauf in meldung.laeufe:
                if lauf.art not in REGISTRY:
                    continue  # unbekannte Art ignorieren, Herzschlag zählt trotzdem
                werte = {
                    "art": lauf.art,
                    "gelaufen_am": jetzt,
                    "status": lauf.status,
                    "zeilen": lauf.zeilen,
                    "dauer_ms": lauf.dauer_ms,
                    "fehler": lauf.fehler,
                }
                einfuegen = pg_insert(odbc_sync_lauf).values(**werte)
                await session.execute(
                    einfuegen.on_conflict_do_update(
                        index_elements=[odbc_sync_lauf.c.art],
                        set_={k: einfuegen.excluded[k] for k in werte if k != "art"},
                    )
                )
    return {"status": "ok"}


# --------------------------------------------------------------------------- #
# Daten: eine Export-Datei je Art (nur wenn die Datenquelle auf ODBC steht)
# --------------------------------------------------------------------------- #
@router.post("/{art}", response_model=UploadErgebnis, dependencies=[Depends(_nur_bei_odbc)])
async def odbc_sync(art: str, file: UploadFile) -> UploadErgebnis:
    """Eine Export-Datei je Art aus dem Windows-Worker einlesen.

    `art` ist einer der Schlüssel aus `REGISTRY` (umsatz, lagerbewegungen, …).
    Die Datei hat dasselbe Format wie der manuelle Extrakt.
    """
    if art not in REGISTRY:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Unbekannte Art: {art}")
    return await importieren(art, file, hochgeladen_von=None, quelle="odbc")
