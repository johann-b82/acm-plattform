"""HTTP-Client für die Personio-API.

Aus lumeapps übernommen (`services/personio_client.py`), aber
zusammengezogen: dort steht dieselbe Fehlerbehandlung — 401, 429 mit
`Retry-After`, Zeitüberschreitung, sonstiger Fehler — in vier Abrufmethoden
nebeneinander. Hier steht sie einmal in `_get`.

Zwei Seitenformen, weil Personio zwei APIs hat:

  V1 (`/company/…`)      Offset und Limit, Ende erkannt an einer kurzen Seite.
  V2 (`/v2/…`)           Cursor, der nächste Link steht in `_meta.links.next`.

Der Bearer-Token ist für beide derselbe.
"""
from __future__ import annotations

import asyncio
import time
from datetime import date
from typing import Any

import httpx

BASIS_V1 = "https://api.personio.de/v1"
BASIS_V2 = "https://api.personio.de/v2"

# Personio-Token laufen nach 24 Stunden ab; wir erneuern deutlich früher.
TOKEN_LAUFZEIT_S = 23 * 3600
TOKEN_PUFFER_S = 300

# V2 lehnt größere Seiten mit 422 ab.
SEITE_V1 = 50
SEITE_V2 = 50


class PersonioFehler(Exception):
    """Oberklasse. `status` ist der HTTP-Code, wenn es einen gab."""

    def __init__(self, text: str, status: int | None = None) -> None:
        super().__init__(text)
        self.status = status


class PersonioAnmeldeFehler(PersonioFehler):
    """401 — Zugangsdaten stimmen nicht."""


class PersonioDrosselung(PersonioFehler):
    """429 — auch nach den Wiederholungen noch gedrosselt."""

    def __init__(self, text: str, retry_after: int = 60) -> None:
        super().__init__(text, status=429)
        self.retry_after = retry_after


class PersonioNetzFehler(PersonioFehler):
    """Zeitüberschreitung oder Verbindungsfehler."""


class PersonioClient:
    """Ein Client je Abgleich. Am Ende `schliessen()` aufrufen."""

    def __init__(self, client_id: str, client_secret: str) -> None:
        self._id = client_id
        self._secret = client_secret
        self._token: str | None = None
        self._laeuft_ab: float = 0.0
        self._http = httpx.AsyncClient(timeout=30.0)

    async def schliessen(self) -> None:
        await self._http.aclose()

    # --- Anmeldung ----------------------------------------------------------

    async def _gueltiger_token(self) -> str:
        if self._token is None or time.monotonic() > self._laeuft_ab - TOKEN_PUFFER_S:
            await self._anmelden()
        assert self._token is not None
        return self._token

    async def _anmelden(self) -> None:
        try:
            antwort = await self._http.post(
                f"{BASIS_V1}/auth",
                json={"client_id": self._id, "client_secret": self._secret},
            )
        except httpx.TimeoutException as exc:
            raise PersonioNetzFehler(f"Personio antwortet nicht: {exc}") from exc
        except httpx.RequestError as exc:
            raise PersonioNetzFehler(f"Personio nicht erreichbar: {exc}") from exc

        if antwort.status_code == 401:
            raise PersonioAnmeldeFehler("Zugangsdaten abgelehnt", status=401)
        if antwort.is_error:
            raise PersonioFehler(
                f"Anmeldung fehlgeschlagen ({antwort.status_code})", status=antwort.status_code
            )

        self._token = antwort.json()["data"]["token"]
        self._laeuft_ab = time.monotonic() + TOKEN_LAUFZEIT_S

    # --- ein Abruf, eine Fehlerbehandlung -----------------------------------

    async def _get(
        self,
        url: str,
        *,
        params: dict | None = None,
        versuche: int = 3,
    ) -> httpx.Response:
        """GET mit Wiederholung bei 429. Alles andere fliegt sofort.

        Die Wartezeit ist das Größere aus `Retry-After` und `2^Versuch × 30 s`,
        gedeckelt bei gut einer Minute — Personio schickt bei Massenabrufen
        gelegentlich sehr große Werte, und ein Abgleich soll nicht stundenlang
        schlafen.
        """
        for versuch in range(versuche + 1):
            kopf = {"Authorization": f"Bearer {await self._gueltiger_token()}"}
            try:
                antwort = await self._http.get(url, headers=kopf, params=params)
            except httpx.TimeoutException as exc:
                raise PersonioNetzFehler(f"Personio antwortet nicht: {exc}") from exc
            except httpx.RequestError as exc:
                raise PersonioNetzFehler(f"Personio nicht erreichbar: {exc}") from exc

            if antwort.status_code == 401:
                raise PersonioAnmeldeFehler("Zugangsdaten abgelehnt", status=401)
            if antwort.status_code == 429:
                warten = int(antwort.headers.get("Retry-After", "30"))
                if versuch == versuche:
                    raise PersonioDrosselung(
                        f"Nach {versuche} Wiederholungen weiter gedrosselt", retry_after=warten
                    )
                await asyncio.sleep(min(max(warten, 2**versuch * 30), 65))
                continue
            if antwort.is_error:
                raise PersonioFehler(
                    f"Personio meldet {antwort.status_code}", status=antwort.status_code
                )
            return antwort

        raise PersonioFehler("unerreichbar: Wiederholungsschleife ohne Antwort")

    # --- die zwei Seitenformen ----------------------------------------------

    async def _seiten_v1(self, pfad: str, params: dict | None = None) -> list[dict]:
        """Offset und Limit. Eine kurze Seite ist die letzte."""
        gesammelt: list[dict] = []
        offset = 0
        while True:
            antwort = await self._get(
                f"{BASIS_V1}{pfad}",
                params={**(params or {}), "limit": SEITE_V1, "offset": offset},
            )
            teil = antwort.json().get("data", [])
            gesammelt.extend(teil)
            if len(teil) < SEITE_V1:
                return gesammelt
            offset += SEITE_V1

    async def _seiten_v2(self, pfad: str, params: dict | None = None) -> list[dict]:
        """Cursor. Der nächste Link trägt Filter und Position bereits."""
        gesammelt: list[dict] = []
        url: str | None = f"{BASIS_V2}{pfad}"
        naechste_params: dict | None = {**(params or {}), "limit": SEITE_V2}
        while url:
            antwort = await self._get(url, params=naechste_params)
            koerper = antwort.json()
            gesammelt.extend(koerper.get("_data", []))
            weiter = ((koerper.get("_meta") or {}).get("links") or {}).get("next")
            url = weiter.get("href") if weiter else None
            naechste_params = None
            if url:
                # Unter dem Rate-Limit bleiben; die Anwesenheiten sind der
                # mit Abstand längste Abruf.
                await asyncio.sleep(0.3)
        return gesammelt

    # --- die vier Abrufe ----------------------------------------------------

    async def mitarbeiter(self) -> list[dict]:
        """`/company/employees` — Stammdaten samt Arbeitszeitmodell."""
        return await self._seiten_v1("/company/employees")

    async def anwesenheiten(self, seit: date | None = None) -> list[dict]:
        """`/v2/attendance-periods` — Segmente, je Zeile ein Abschnitt.

        V1 antwortet bei mehrtägigen Perioden mit 422, deshalb V2. Der
        Aufrufer filtert auf `type == "WORK"`; `BREAK`-Segmente sind eigene
        Zeilen und keine Pausenminuten.
        """
        params: dict[str, Any] = {}
        if seit is not None:
            params["attribution_date.gte"] = seit.isoformat()
        return await self._seiten_v2("/attendance-periods", params)

    async def abwesenheiten(self) -> list[dict]:
        """`/company/absence-periods` — stundenbasiert (Freizeitausgleich)."""
        return await self._seiten_v1("/company/absence-periods")

    async def abwesenheitsarten(self) -> list[dict]:
        """`/company/time-off-types` — die Arten, nicht die Abwesenheiten.

        Nicht `/company/absence-types`: der Pfad antwortet mit 404. Die Arten
        werden nicht abgeglichen, sie stehen in keiner Tabelle — gebraucht
        werden sie nur, um in den Einstellungen eine Auswahlliste anzubieten.
        """
        return await self._seiten_v1("/company/time-off-types")

    async def profilbild(self, employee_id: int) -> tuple[bytes, str] | None:
        """`/company/employees/{id}/profile-picture` — Bytes und MIME-Typ.

        `None`, wenn Personio 404 antwortet: die Person hat kein Bild. Das ist
        kein Fehler, und der Aufrufer soll dafür nicht 502 melden müssen.
        """
        try:
            antwort = await self._get(
                f"{BASIS_V1}/company/employees/{employee_id}/profile-picture",
                versuche=0,
            )
        except PersonioFehler as fehler:
            if fehler.status == 404:
                return None
            raise
        typ = antwort.headers.get("content-type", "image/jpeg").split(";")[0].strip()
        return antwort.content, typ

    async def freistellungen(self) -> list[dict]:
        """`/company/time-offs` — tagesbasiert (Urlaub, Krankheit).

        Getrennt von `abwesenheiten`, weil Personio für unsere Zugangsdaten
        über `absence-periods` nicht alle Arten herausgibt.
        """
        return await self._seiten_v1("/company/time-offs")
