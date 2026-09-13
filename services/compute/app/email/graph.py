"""Microsoft Graph für den Mailversand — die einzige Stelle, die mit Microsoft spricht.

Aus lumeapps übernommen (`services/graph_client.py`), aber ohne eigenen
HTTP-Client im Objekt: jede Funktion bekommt einen `httpx.AsyncClient`. Damit
lässt sich Graph im Test durch eine Attrappe ersetzen, ohne einen Aufruf nach
draußen zu riskieren.

Zwei Wege zu einem Token:

  App-Berechtigung   Client-Credentials mit Secret; gesendet wird als
                     `/users/{absender}/sendMail`.
  Delegiert          Geräte-Code-Anmeldung einer Person; danach ein
                     Erneuerungstoken, das Microsoft rotieren kann. Gesendet
                     wird als `/me/sendMail`.
"""
from __future__ import annotations

from dataclasses import dataclass

import httpx

ANMELDUNG = "https://login.microsoftonline.com"
GRAPH = "https://graph.microsoft.com/v1.0"
SCOPE_APP = "https://graph.microsoft.com/.default"
# Mail.Send zum Senden, offline_access für das Erneuerungstoken, User.Read für
# die Adresse des angemeldeten Kontos. Eine Person darf dem selbst zustimmen.
SCOPE_DELEGIERT = "offline_access Mail.Send User.Read"


class GraphFehler(Exception):
    """Microsoft hat abgelehnt oder war nicht erreichbar. Die Meldung ist für
    die Maske gedacht und enthält nie ein Geheimnis."""


@dataclass(frozen=True)
class Token:
    zugriff: str
    #: Nur im delegierten Modus, und nur wenn Microsoft ein neues geschickt hat.
    erneuerung: str | None = None


def _meldung(antwort: httpx.Response) -> str:
    try:
        daten = antwort.json()
    except ValueError:
        return antwort.text[:200] or "(keine Antwort)"
    if isinstance(daten, dict):
        if "error_description" in daten:
            return str(daten["error_description"]).splitlines()[0][:200]
        fehler = daten.get("error")
        if isinstance(fehler, dict) and "message" in fehler:
            return str(fehler["message"])[:200]
        if isinstance(fehler, str):
            return fehler[:200]
    return str(daten)[:200]


async def _post(http: httpx.AsyncClient, url: str, **kwargs) -> httpx.Response:
    try:
        return await http.post(url, **kwargs)
    except httpx.TimeoutException as fehler:
        raise GraphFehler("Microsoft antwortet nicht (Zeitüberschreitung).") from fehler
    except httpx.RequestError as fehler:
        raise GraphFehler("Microsoft ist nicht erreichbar.") from fehler


async def token_app(http: httpx.AsyncClient, tenant: str, client_id: str, secret: str) -> Token:
    antwort = await _post(http, f"{ANMELDUNG}/{tenant}/oauth2/v2.0/token", data={
        "grant_type": "client_credentials", "client_id": client_id,
        "client_secret": secret, "scope": SCOPE_APP,
    })
    if antwort.is_error:
        raise GraphFehler(f"Anmeldung abgelehnt (HTTP {antwort.status_code}): {_meldung(antwort)}")
    return Token(zugriff=antwort.json()["access_token"])


async def token_delegiert(http: httpx.AsyncClient, tenant: str, client_id: str, erneuerung: str) -> Token:
    antwort = await _post(http, f"{ANMELDUNG}/{tenant}/oauth2/v2.0/token", data={
        "grant_type": "refresh_token", "client_id": client_id,
        "refresh_token": erneuerung, "scope": SCOPE_DELEGIERT,
    })
    if antwort.is_error:
        raise GraphFehler(
            f"Die Anmeldung ist abgelaufen oder widerrufen (HTTP {antwort.status_code}): "
            f"{_meldung(antwort)} — bitte erneut bei Microsoft anmelden."
        )
    daten = antwort.json()
    neu = daten.get("refresh_token")
    return Token(zugriff=daten["access_token"], erneuerung=neu if neu and neu != erneuerung else None)


async def senden(
    http: httpx.AsyncClient,
    token: Token,
    *,
    absender: str | None,
    absender_name: str | None,
    an: list[str],
    betreff: str,
    html: str,
) -> None:
    """`absender` None heißt delegiert: gesendet wird als die angemeldete Person."""
    nachricht: dict = {
        "subject": betreff,
        "body": {"contentType": "HTML", "content": html},
        "toRecipients": [{"emailAddress": {"address": a}} for a in an],
    }
    if absender and absender_name:
        nachricht["from"] = {"emailAddress": {"address": absender, "name": absender_name}}
    pfad = f"/users/{absender}/sendMail" if absender else "/me/sendMail"
    antwort = await _post(
        http, f"{GRAPH}{pfad}",
        headers={"Authorization": f"Bearer {token.zugriff}"},
        json={"message": nachricht, "saveToSentItems": True},
    )
    if antwort.status_code == 202:
        return
    if antwort.status_code in (401, 403):
        raise GraphFehler(
            "Versand abgelehnt — fehlende Berechtigung „Mail.Send“ oder unbekannter Absender "
            f"({_meldung(antwort)})."
        )
    raise GraphFehler(f"Versand fehlgeschlagen (HTTP {antwort.status_code}): {_meldung(antwort)}")


async def geraetecode_starten(http: httpx.AsyncClient, tenant: str, client_id: str) -> dict:
    antwort = await _post(http, f"{ANMELDUNG}/{tenant}/oauth2/v2.0/devicecode",
                          data={"client_id": client_id, "scope": SCOPE_DELEGIERT})
    if antwort.is_error:
        raise GraphFehler(f"Anmeldung ließ sich nicht starten (HTTP {antwort.status_code}): {_meldung(antwort)}")
    return antwort.json()


async def geraetecode_abfragen(
    http: httpx.AsyncClient, tenant: str, client_id: str, geraetecode: str
) -> dict:
    """Einmal fragen. `{"status": "pending"}`, `{"status": "error", "fehler": …}`
    oder `{"status": "complete", "zugriff": …, "erneuerung": …}`."""
    antwort = await _post(http, f"{ANMELDUNG}/{tenant}/oauth2/v2.0/token", data={
        "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
        "client_id": client_id, "device_code": geraetecode,
    })
    daten = antwort.json() if antwort.content else {}
    if not antwort.is_error:
        return {"status": "complete", "zugriff": daten.get("access_token"),
                "erneuerung": daten.get("refresh_token")}
    if daten.get("error") == "authorization_pending" or daten.get("error") == "slow_down":
        return {"status": "pending"}
    return {"status": "error", "fehler": _meldung(antwort)}


async def konto(http: httpx.AsyncClient, zugriff: str) -> str | None:
    try:
        antwort = await http.get(f"{GRAPH}/me", headers={"Authorization": f"Bearer {zugriff}"})
    except httpx.RequestError:
        return None
    if antwort.is_error:
        return None
    daten = antwort.json()
    return daten.get("mail") or daten.get("userPrincipalName")
