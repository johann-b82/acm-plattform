"""Die Anzeigen für die Bildschirme.

Sitzungslos, aber nicht offen: jede Route verlangt einen signierten Token
(siehe `app/embed.py`). Was hinausgeht, ist so wenig wie möglich — Name,
Abteilung und Wochentag. **Kein Geburtsdatum, kein Alter.**

    GET  /api/anzeige/geburtstage?token=     wer diese Woche Geburtstag hat
    GET  /api/anzeige/neuzugaenge?token=     wer zuletzt angefangen hat
    GET  /api/anzeige/foto/{id}?token=       Bild — nur für gerade Gezeigte
    POST /api/anzeige/token                  Token erzeugen (`platform: admin`)

Die drei Leseformen brauchen keine Anmeldung und tragen deshalb eine Ratsperre
je Adresse. Beim Foto sind alle Absagen dasselbe 404 — nicht gezeigt, kein
Bild hinterlegt, Personio nicht eingerichtet. Eine unterscheidbare Antwort
machte die Route wieder zum Belegschaftsverzeichnis, das sie im Altsystem war.
"""
from __future__ import annotations

import time
from datetime import date, datetime, timedelta
from typing import Any

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel

from app.auth import require_app
from app.config import settings
from app.db import SessionLocal, personio_employees
from app.embed import TokenUngueltig, baue_token, pruefe_token
from app.personio import zugang
from app.personio.client import PersonioFehler
from app.ratsperre import Sperre

ARTEN = ("geburtstage", "neuzugaenge")

# Eine Tafel blättert alle paar Sekunden eine Kachel weiter und holt je Kachel
# ein Bild. 120 Abrufe je Minute und Adresse decken das mit Luft.
sperre_liste = Sperre("Anzeige", grenze=60)
sperre_foto = Sperre("Anzeigenfoto", grenze=120)

#: Weiter zurück als ein Jahr ist niemand mehr „neu".
NEU_WOCHEN_MAX = 52
#: Ein Bild bleibt eine Stunde im Speicher — sonst fragt jede Tafel im Haus
#: im Minutentakt bei Personio nach, und das läuft in die Drosselung.
FOTO_FRIST_S = 3600.0
FOTO_HOECHSTENS = 200

_fotos: dict[int, tuple[float, bytes, str]] = {}

router = APIRouter(prefix="/api/anzeige", tags=["anzeige"])


class Geburtstag(BaseModel):
    id: int
    vorname: str | None
    nachname: str | None
    abteilung: str | None
    #: 0 = Montag … 6 = Sonntag. Der Tag in dieser Woche, nicht das Datum.
    wochentag: int
    hat_foto: bool


class Neuzugang(BaseModel):
    id: int
    vorname: str | None
    nachname: str | None
    abteilung: str | None
    eintritt: date
    tage_dabei: int
    hat_foto: bool


class NeuerToken(BaseModel):
    token: str
    gueltig_bis: date


def _pruefe(token: str, art: str) -> None:
    try:
        pruefe_token(token, art)
    except TokenUngueltig as fehler:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(fehler)) from fehler


# --- was in den Personio-Rohdaten steht ------------------------------------


def geburtsdatum_aus(roh: Any) -> str | None:
    """Das Geburtsdatum irgendwo in den Rohdaten finden.

    Ein rekursiver Durchgang statt eines festen Pfades: Personio hängt das Feld
    je nach Fassung der Schnittstelle anders ein, und ein fester Pfad bricht
    beim nächsten Umbau still.
    """
    if isinstance(roh, dict):
        if roh.get("label") == "Geburtsdatum":
            wert = roh.get("value")
            return wert if isinstance(wert, str) and wert else None
        for wert in roh.values():
            treffer = geburtsdatum_aus(wert)
            if treffer is not None:
                return treffer
    elif isinstance(roh, list):
        for eintrag in roh:
            treffer = geburtsdatum_aus(eintrag)
            if treffer is not None:
                return treffer
    return None


def hat_foto(roh: Any) -> bool:
    if isinstance(roh, dict):
        if roh.get("label") == "Profile Picture":
            return bool(roh.get("value"))
        return any(hat_foto(w) for w in roh.values())
    if isinstance(roh, list):
        return any(hat_foto(e) for e in roh)
    return False


def als_datum(roh: str) -> date | None:
    """Personio schickt mal einen Zeitstempel, mal ein Datum."""
    try:
        return datetime.fromisoformat(roh).date()
    except ValueError:
        try:
            return date.fromisoformat(roh[:10])
        except ValueError:
            return None


def jahrestag(geboren: date, jahr: int) -> date:
    """Den Geburtstag auf ein Jahr legen. Der 29. Februar wird zum 28."""
    try:
        return geboren.replace(year=jahr)
    except ValueError:
        return geboren.replace(year=jahr, day=28)


def woche(heute: date) -> tuple[date, date]:
    montag = heute - timedelta(days=heute.weekday())
    return montag, montag + timedelta(days=6)


# --- die beiden Listen ------------------------------------------------------


async def _aktive() -> list[Any]:
    async with SessionLocal() as sitzung:
        ergebnis = await sitzung.execute(
            sa.select(
                personio_employees.c.id,
                personio_employees.c.first_name,
                personio_employees.c.last_name,
                personio_employees.c.department,
                personio_employees.c.hire_date,
                personio_employees.c.raw_json,
            ).where(personio_employees.c.status == "active")
        )
        return list(ergebnis.mappings().all())


async def geburtstage_der_woche(heute: date | None = None) -> list[Geburtstag]:
    heute = heute or date.today()
    montag, sonntag = woche(heute)
    treffer: list[Geburtstag] = []
    for zeile in await _aktive():
        roh = geburtsdatum_aus(zeile["raw_json"])
        geboren = als_datum(roh) if roh else None
        if geboren is None:
            continue
        # Eine Woche kann über den Jahreswechsel laufen; dann sind zwei
        # Jahrestage zu prüfen.
        for jahr in sorted({montag.year, sonntag.year}):
            tag = jahrestag(geboren, jahr)
            if montag <= tag <= sonntag:
                treffer.append(
                    Geburtstag(
                        id=zeile["id"],
                        vorname=zeile["first_name"],
                        nachname=zeile["last_name"],
                        abteilung=zeile["department"],
                        wochentag=tag.weekday(),
                        hat_foto=hat_foto(zeile["raw_json"]),
                    )
                )
                break
    return sorted(treffer, key=lambda g: (g.wochentag, g.nachname or ""))


async def neuzugaenge_seit(wochen: int, heute: date | None = None) -> list[Neuzugang]:
    heute = heute or date.today()
    ab = heute - timedelta(weeks=wochen)
    treffer = [
        Neuzugang(
            id=z["id"],
            vorname=z["first_name"],
            nachname=z["last_name"],
            abteilung=z["department"],
            eintritt=z["hire_date"],
            tage_dabei=(heute - z["hire_date"]).days,
            hat_foto=hat_foto(z["raw_json"]),
        )
        for z in await _aktive()
        if z["hire_date"] and ab <= z["hire_date"] <= heute
    ]
    return sorted(treffer, key=lambda n: n.eintritt, reverse=True)


# --- die Routen -------------------------------------------------------------


@router.get(
    "/geburtstage",
    response_model=list[Geburtstag],
    dependencies=[Depends(sperre_liste)],
)
async def geburtstage(token: str = Query(...)) -> list[Geburtstag]:
    _pruefe(token, "geburtstage")
    return await geburtstage_der_woche()


@router.get(
    "/neuzugaenge",
    response_model=list[Neuzugang],
    dependencies=[Depends(sperre_liste)],
)
async def neuzugaenge(
    token: str = Query(...),
    wochen: int = Query(default=12, ge=1, le=NEU_WOCHEN_MAX),
) -> list[Neuzugang]:
    _pruefe(token, "neuzugaenge")
    return await neuzugaenge_seit(wochen)


@router.get("/foto/{employee_id}", dependencies=[Depends(sperre_foto)])
async def foto(employee_id: int, token: str = Query(...)) -> Response:
    """Das Bild einer Person — nur, wenn sie gerade auf einer Tafel steht.

    Das ist der Riegel gegen das Durchzählen: im Altsystem ließ sich über die
    laufende Nummer die ganze Belegschaft abrufen.
    """
    art = _welche_anzeige(token)

    gezeigte = (
        {g.id for g in await geburtstage_der_woche()}
        if art == "geburtstage"
        else {n.id for n in await neuzugaenge_seit(NEU_WOCHEN_MAX)}
    )
    if employee_id not in gezeigte:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Kein Bild.")

    jetzt = time.monotonic()
    gemerkt = _fotos.get(employee_id)
    if gemerkt and jetzt - gemerkt[0] < FOTO_FRIST_S:
        return _bild(gemerkt[1], gemerkt[2])

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
    if len(_fotos) >= FOTO_HOECHSTENS:
        _fotos.pop(next(iter(_fotos)))
    _fotos[employee_id] = (jetzt, daten, typ)
    return _bild(daten, typ)


def _welche_anzeige(token: str) -> str:
    """Zu welcher der beiden Tafeln der Token gehört.

    Das Foto sitzt auf beiden, deshalb passt hier jede Art — die Antwort sagt
    nur, in welcher Liste die Person stehen muss.
    """
    grund = TokenUngueltig("Der Token ist unlesbar.")
    for art in ARTEN:
        try:
            pruefe_token(token, art)
            return art
        except TokenUngueltig as fehler:
            grund = fehler
    raise HTTPException(status.HTTP_403_FORBIDDEN, str(grund)) from grund


def _bild(daten: bytes, typ: str) -> Response:
    return Response(
        content=daten,
        media_type=typ,
        headers={"Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff"},
    )


@router.post(
    "/token",
    response_model=NeuerToken,
    dependencies=[Depends(require_app("platform", "admin"))],
)
async def token_erzeugen(
    art: str = Query(..., pattern="^(geburtstage|neuzugaenge)$"),
    tage: int = Query(default=365, ge=1, le=3650),
) -> NeuerToken:
    """Einen Token für einen Playlist-Eintrag erzeugen.

    Er wird nicht gespeichert: die Unterschrift trägt sich selbst. Wer ihn
    verliert, erzeugt einen neuen; wer alle sperren will, wechselt
    `EMBED_SECRET`.
    """
    try:
        token = baue_token(art, tage)
    except TokenUngueltig as fehler:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(fehler)) from fehler
    return NeuerToken(token=token, gueltig_bis=date.today() + timedelta(days=tage))
