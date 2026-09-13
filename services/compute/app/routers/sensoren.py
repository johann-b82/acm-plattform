"""Sensoren: anlegen, pflegen, messen.

Anders als die übrigen Fachmodule läuft das Anlegen und Ändern **nicht** über
PostgREST. Jede Änderung kann die SNMP-Community tragen, und die zu
verschlüsseln braucht den Schlüssel aus der Umgebung — den kennt nur dieser
Dienst. Gelesen wird dagegen direkt über PostgREST; das Spaltenrecht gibt die
Community gar nicht erst frei.

    GET    /api/sensoren            Liste (ohne Community)
    POST   /api/sensoren            anlegen
    PATCH  /api/sensoren/{id}       ändern (nur die gesendeten Felder)
    DELETE /api/sensoren/{id}       löschen, samt Zeitreihe
    POST   /api/sensoren/probe      ein Gerät ausprobieren, ohne es anzulegen
    POST   /api/sensoren/durchgehen den OID-Baum eines Geräts auflisten
    POST   /api/sensoren/messen     jetzt messen
    POST   /api/sensoren/geplant    derselbe Lauf aus pg_cron, gemeinsames Geheimnis
"""
from __future__ import annotations

import hmac
from datetime import datetime, timezone
from decimal import Decimal

import sqlalchemy as sa
from fastapi import APIRouter, Depends, Header, HTTPException, Path, status
from pydantic import BaseModel, Field, field_validator

from app import netz
from app.auth import require_app
from app.config import settings
from app.db import SessionLocal, sensoren
from app import geheim
from app.sensoren import messen, snmp

router = APIRouter(
    prefix="/api/sensoren",
    tags=["sensoren"],
    # Sehen darf, wer die Sensoren hat; einrichten die Plattform-Verwaltung.
    # Die Stufe je Route steht unten, das Tor hier lässt nur Angemeldete durch.
    dependencies=[Depends(require_app("sensors"))],
)

verwaltet = Depends(require_app("platform", "admin"))


class SensorEingabe(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    rechner: str = Field(min_length=1, max_length=255)
    port: int = Field(default=161, ge=1, le=65535)
    community: str = Field(min_length=1, max_length=255)
    temperatur_oid: str | None = Field(default=None, max_length=255)
    feuchte_oid: str | None = Field(default=None, max_length=255)
    temperatur_faktor: Decimal = Decimal(1)
    feuchte_faktor: Decimal = Decimal(1)
    # Grenzen gibt es nur noch global (`sensor_einstellungen`, SET-11). Die
    # Spalten am Gerät bleiben stehen, lassen sich hier aber nicht mehr setzen.
    aktiv: bool = True
    farbe: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")

    @field_validator("temperatur_oid", "feuchte_oid")
    @classmethod
    def _leer_ist_nichts(cls, wert: str | None) -> str | None:
        return wert.strip() or None if wert else None


class SensorAenderung(BaseModel):
    """Nur die gesendeten Felder werden geändert; `community` bleibt geheim."""

    name: str | None = Field(default=None, min_length=1, max_length=100)
    rechner: str | None = Field(default=None, min_length=1, max_length=255)
    port: int | None = Field(default=None, ge=1, le=65535)
    community: str | None = Field(default=None, min_length=1, max_length=255)
    temperatur_oid: str | None = None
    feuchte_oid: str | None = None
    temperatur_faktor: Decimal | None = None
    feuchte_faktor: Decimal | None = None
    # Grenzen gibt es nur noch global (`sensor_einstellungen`, SET-11). Die
    # Spalten am Gerät bleiben stehen, lassen sich hier aber nicht mehr setzen.
    aktiv: bool | None = None
    farbe: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")


class Sensor(BaseModel):
    id: str
    name: str


class ProbeEingabe(BaseModel):
    rechner: str
    port: int = Field(default=161, ge=1, le=65535)
    community: str
    temperatur_oid: str | None = None
    feuchte_oid: str | None = None


class ProbeErgebnis(BaseModel):
    erreichbar: bool
    temperatur: float | None = None
    feuchte: float | None = None
    meldung: str | None = None


class DurchgangEingabe(ProbeEingabe):
    wurzel: str = "1.3.6.1"


class MessErgebnis(BaseModel):
    gemessen: int
    gescheitert: int
    hinweise: list[str]


def _pruefe_kennung(temperatur_oid: str | None, feuchte_oid: str | None) -> None:
    if not temperatur_oid and not feuchte_oid:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Ohne Temperatur- oder Feuchte-Kennung gibt es nichts abzufragen.",
        )


def _ziel_pruefen(rechner: str) -> None:
    try:
        messen.pruefe_ziel(rechner)
    except netz.ZielNichtErlaubt as fehler:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(fehler)) from fehler


def _geheim(community: str) -> bytes:
    try:
        return geheim.verschluesseln(community)
    except geheim.KeinSchluessel as fehler:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(fehler)) from fehler


@router.post("", response_model=Sensor, status_code=status.HTTP_201_CREATED,
             dependencies=[verwaltet])
async def anlegen(eingabe: SensorEingabe) -> Sensor:
    _pruefe_kennung(eingabe.temperatur_oid, eingabe.feuchte_oid)
    _ziel_pruefen(eingabe.rechner)
    werte = eingabe.model_dump()
    werte["community"] = _geheim(werte.pop("community"))
    async with SessionLocal() as sitzung:
        async with sitzung.begin():
            try:
                zeile = (
                    await sitzung.execute(
                        sa.insert(sensoren).values(**werte).returning(
                            sensoren.c.id, sensoren.c.name
                        )
                    )
                ).one()
            except sa.exc.IntegrityError as fehler:
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    f'Einen Sensor „{eingabe.name}“ gibt es schon.',
                ) from fehler
    return Sensor(id=str(zeile.id), name=zeile.name)


@router.patch("/{sensor_id}", response_model=Sensor, dependencies=[verwaltet])
async def aendern(aenderung: SensorAenderung, sensor_id: str = Path(...)) -> Sensor:
    werte = aenderung.model_dump(exclude_unset=True)
    if not werte:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Nichts zu ändern.")
    if "rechner" in werte:
        _ziel_pruefen(werte["rechner"])
    if "community" in werte:
        werte["community"] = _geheim(werte["community"])
    werte["geaendert_am"] = datetime.now(timezone.utc)

    async with SessionLocal() as sitzung:
        async with sitzung.begin():
            zeile = (
                await sitzung.execute(
                    sa.update(sensoren)
                    .where(sensoren.c.id == sensor_id)
                    .values(**werte)
                    .returning(sensoren.c.id, sensoren.c.name,
                               sensoren.c.temperatur_oid, sensoren.c.feuchte_oid)
                )
            ).one_or_none()
    if zeile is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Diesen Sensor gibt es nicht.")
    _pruefe_kennung(zeile.temperatur_oid, zeile.feuchte_oid)
    return Sensor(id=str(zeile.id), name=zeile.name)


@router.delete("/{sensor_id}", status_code=status.HTTP_204_NO_CONTENT,
               dependencies=[verwaltet])
async def loeschen(sensor_id: str = Path(...)) -> None:
    async with SessionLocal() as sitzung:
        async with sitzung.begin():
            ergebnis = await sitzung.execute(
                sa.delete(sensoren).where(sensoren.c.id == sensor_id)
            )
    if ergebnis.rowcount == 0:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Diesen Sensor gibt es nicht.")


@router.post("/probe", response_model=ProbeErgebnis, dependencies=[verwaltet])
async def probe(eingabe: ProbeEingabe) -> ProbeErgebnis:
    """Ein Gerät ausprobieren, bevor es angelegt wird."""
    _pruefe_kennung(eingabe.temperatur_oid, eingabe.feuchte_oid)
    _ziel_pruefen(eingabe.rechner)
    meldungen: list[str] = []
    temperatur = feuchte = None
    if eingabe.temperatur_oid:
        temperatur, fehler = await snmp.hole(
            eingabe.rechner, eingabe.port, eingabe.community, eingabe.temperatur_oid
        )
        if fehler:
            meldungen.append(f"Temperatur: {fehler.text}")
    if eingabe.feuchte_oid:
        feuchte, fehler = await snmp.hole(
            eingabe.rechner, eingabe.port, eingabe.community, eingabe.feuchte_oid
        )
        if fehler:
            meldungen.append(f"Feuchte: {fehler.text}")
    return ProbeErgebnis(
        erreichbar=temperatur is not None or feuchte is not None,
        temperatur=temperatur,
        feuchte=feuchte,
        meldung="; ".join(meldungen) or None,
    )


@router.post("/durchgehen", dependencies=[verwaltet])
async def durchgehen(eingabe: DurchgangEingabe) -> list[dict]:
    """Den OID-Baum auflisten — so findet man die richtige Kennung."""
    _ziel_pruefen(eingabe.rechner)
    return await snmp.durchgehen(
        eingabe.rechner, eingabe.port, eingabe.community, eingabe.wurzel
    )


@router.post("/messen", response_model=MessErgebnis)
async def jetzt_messen() -> MessErgebnis:
    """Von Hand messen. Das darf, wer die Sensoren sieht — es ändert nichts an
    der Einrichtung, es holt nur einen frischen Wert."""
    ergebnis = await messen.durchgang()
    return MessErgebnis(**ergebnis.__dict__)


# Der geplante Lauf hängt nicht am Router-Gate: ein SQL-Job hat kein
# Nutzertoken. Statt dessen ein gemeinsames Geheimnis, wie beim ATR-Scan.
geplant = APIRouter(prefix="/api/sensoren", tags=["sensoren"])


@geplant.post("/geplant", response_model=MessErgebnis, include_in_schema=False)
async def messen_geplant(x_sensor_token: str = Header(default="")) -> MessErgebnis:
    if not settings.SENSOR_TOKEN:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "SENSOR_TOKEN fehlt")
    if not hmac.compare_digest(x_sensor_token, settings.SENSOR_TOKEN):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "falsches Geheimnis")
    ergebnis = await messen.durchgang()
    return MessErgebnis(**ergebnis.__dict__)
