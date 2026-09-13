"""E-Mail über Microsoft 365 (SET-16): Konfiguration, Testmail, delegierte Anmeldung.

Graph wird nie erreicht — jede Anfrage geht an eine Attrappe (httpx
MockTransport), die mitschreibt. Geprüft wird vor allem, was schiefgehen darf
und niemand bemerkt: ein Geheimnis im Klartext, ein Geheimnis in einer
Antwort, eine Mail beim bloßen Speichern.
"""
from __future__ import annotations

import json

import httpx
import pytest
import pytest_asyncio
import sqlalchemy as sa
from asgi_lifespan import LifespanManager
from cryptography.fernet import Fernet
from httpx import ASGITransport, AsyncClient

from app.config import settings
from app.db import SessionLocal, email_einstellungen, geheimnisse
from app.email import dienst
from app.main import app
from tests._auth import USER_ID, mint, mint_admin

pytestmark = pytest.mark.asyncio

ADMIN = {"Authorization": f"Bearer {mint_admin()}"}
GEHEIM = "sehr-geheimes-client-secret"


class Attrappe:
    """Antwortet wie Microsoft; schreibt jede Anfrage mit."""

    def __init__(self) -> None:
        self.anfragen: list[httpx.Request] = []
        self.send_status = 202
        self.geraet_status = "pending"

    def __call__(self, anfrage: httpx.Request) -> httpx.Response:
        self.anfragen.append(anfrage)
        pfad = anfrage.url.path
        if anfrage.url.host == "login.microsoftonline.com" and pfad.endswith("/devicecode"):
            return httpx.Response(200, json={
                "device_code": "geraet-123", "user_code": "ABCD-EFGH",
                "verification_uri": "https://microsoft.com/devicelogin",
                "expires_in": 900, "interval": 5, "message": "Code eingeben",
            })
        if anfrage.url.host == "login.microsoftonline.com" and pfad.endswith("/token"):
            form = dict(httpx.QueryParams(anfrage.content.decode()))
            if form.get("grant_type") == "urn:ietf:params:oauth:grant-type:device_code":
                if self.geraet_status == "pending":
                    return httpx.Response(400, json={"error": "authorization_pending"})
                return httpx.Response(200, json={
                    "access_token": "zugriff-delegiert", "refresh_token": "erneuerung-1",
                    "expires_in": 3600,
                })
            if form.get("grant_type") == "refresh_token":
                return httpx.Response(200, json={
                    "access_token": "zugriff-delegiert", "refresh_token": "erneuerung-2",
                    "expires_in": 3600,
                })
            if form.get("client_secret") != GEHEIM:
                return httpx.Response(401, json={"error": "invalid_client",
                                                 "error_description": "Falsches Secret"})
            return httpx.Response(200, json={"access_token": "zugriff-app", "expires_in": 3600})
        if anfrage.url.host == "graph.microsoft.com" and pfad == "/v1.0/me":
            return httpx.Response(200, json={"mail": "person@acm.example"})
        if anfrage.url.host == "graph.microsoft.com" and pfad.endswith("/sendMail"):
            if self.send_status != 202:
                return httpx.Response(self.send_status, json={"error": {"message": "Zugriff verweigert"}})
            return httpx.Response(202)
        return httpx.Response(404)

    def an_graph(self) -> list[httpx.Request]:
        return [a for a in self.anfragen if a.url.host == "graph.microsoft.com"]


@pytest.fixture
def attrappe(monkeypatch):
    ms = Attrappe()
    monkeypatch.setattr(
        dienst, "neuer_http", lambda: httpx.AsyncClient(transport=httpx.MockTransport(ms))
    )
    return ms


@pytest.fixture
def schluessel(monkeypatch):
    monkeypatch.setattr(settings, "GEHEIM_SCHLUESSEL", Fernet.generate_key().decode())
    monkeypatch.setattr(settings, "SENSOR_SCHLUESSEL", "")


@pytest_asyncio.fixture
async def leer(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")

    async def _weg():
        async with SessionLocal() as s:
            async with s.begin():
                await s.execute(sa.delete(geheimnisse).where(geheimnisse.c.schluessel.like("email_%")))
                await s.execute(sa.update(email_einstellungen).values(
                    aktiv=False, modus="app", tenant_id=None, client_id=None, absender=None,
                    absender_name=None, delegiert_konto=None, geaendert_von=None,
                ))

    # Der speichernde Admin (mint_admin nutzt USER_ID) braucht eine Zeile in
    # auth.users — Geheimnisse und Einstellungen verweisen auf ihn.
    async with SessionLocal() as s:
        async with s.begin():
            await s.execute(sa.text(
                "insert into auth.users (id, email) values (cast(:i as uuid), :m)"
                " on conflict (id) do nothing"
            ), {"i": USER_ID, "m": "admin@example.com"})
    await _weg()
    yield
    await _weg()


@pytest_asyncio.fixture
async def client():
    async with LifespanManager(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            yield ac


APP_EINGABE = {
    "aktiv": True,
    "modus": "app",
    "tenant_id": "tenant-1",
    "client_id": "client-1",
    "client_secret": GEHEIM,
    "absender": "kpi@acm.example",
    "absender_name": "ACM-Plattform",
}


async def test_nur_plattform_verwaltung(client, leer):
    for pfad in ("/api/einstellungen/email",):
        r = await client.get(pfad, headers={"Authorization": f"Bearer {mint({'hr': 'admin'})}"})
        assert r.status_code == 403
    r = await client.post("/api/einstellungen/email/test", json={"an": "x@acm.example"},
                          headers={"Authorization": f"Bearer {mint({'hr': 'admin'})}"})
    assert r.status_code == 403


async def test_speichern_verschluesselt_und_gibt_nichts_heraus(client, leer, schluessel, attrappe):
    r = await client.put("/api/einstellungen/email", json=APP_EINGABE, headers=ADMIN)
    assert r.status_code == 200, r.text
    assert GEHEIM not in r.text
    stand = r.json()
    assert stand["secret_gesetzt"] is True
    assert stand["absender"] == "kpi@acm.example"

    async with SessionLocal() as s:
        abgelegt = (await s.execute(
            sa.select(geheimnisse.c.geheimtext).where(geheimnisse.c.schluessel == "email_client_secret")
        )).scalar_one()
    assert GEHEIM.encode() not in bytes(abgelegt)

    r = await client.get("/api/einstellungen/email", headers=ADMIN)
    assert GEHEIM not in r.text
    # Weder Öffnen noch Speichern schickt etwas an Microsoft.
    assert attrappe.anfragen == []


async def test_leeres_secret_behaelt_das_alte(client, leer, schluessel, attrappe):
    await client.put("/api/einstellungen/email", json=APP_EINGABE, headers=ADMIN)
    ohne = {**APP_EINGABE, "client_secret": "", "absender_name": "Neu"}
    r = await client.put("/api/einstellungen/email", json=ohne, headers=ADMIN)
    assert r.json()["secret_gesetzt"] is True
    assert r.json()["absender_name"] == "Neu"
    r = await client.post("/api/einstellungen/email/test", json={"an": "empf@acm.example"}, headers=ADMIN)
    assert r.json() == {"ok": True, "fehler": None}


async def test_testmail_geht_an_den_eingegebenen_empfaenger(client, leer, schluessel, attrappe):
    await client.put("/api/einstellungen/email", json=APP_EINGABE, headers=ADMIN)
    r = await client.post("/api/einstellungen/email/test", json={"an": "empf@acm.example"}, headers=ADMIN)
    assert r.json() == {"ok": True, "fehler": None}
    [senden] = [a for a in attrappe.an_graph() if a.url.path.endswith("/sendMail")]
    assert senden.url.path == "/v1.0/users/kpi@acm.example/sendMail"
    assert senden.headers["Authorization"] == "Bearer zugriff-app"
    nachricht = json.loads(senden.content)["message"]
    assert nachricht["toRecipients"] == [{"emailAddress": {"address": "empf@acm.example"}}]
    assert nachricht["from"]["emailAddress"]["name"] == "ACM-Plattform"


async def test_ausgeschaltet_keine_testmail(client, leer, schluessel, attrappe):
    await client.put("/api/einstellungen/email", json={**APP_EINGABE, "aktiv": False}, headers=ADMIN)
    r = await client.post("/api/einstellungen/email/test", json={"an": "empf@acm.example"}, headers=ADMIN)
    assert r.json()["ok"] is False
    assert attrappe.anfragen == []


async def test_abgelehnter_versand_kommt_als_meldung(client, leer, schluessel, attrappe):
    await client.put("/api/einstellungen/email", json=APP_EINGABE, headers=ADMIN)
    attrappe.send_status = 403
    r = await client.post("/api/einstellungen/email/test", json={"an": "empf@acm.example"}, headers=ADMIN)
    antwort = r.json()
    assert antwort["ok"] is False
    assert "Mail.Send" in antwort["fehler"]


async def test_falsches_secret_kommt_als_meldung(client, leer, schluessel, attrappe):
    await client.put("/api/einstellungen/email", json={**APP_EINGABE, "client_secret": "falsch"},
                     headers=ADMIN)
    r = await client.post("/api/einstellungen/email/test", json={"an": "empf@acm.example"}, headers=ADMIN)
    assert r.json()["ok"] is False
    assert "Falsches Secret" in r.json()["fehler"]
    assert "falsch" not in r.json()["fehler"].replace("Falsches", "")


async def test_empfaenger_muss_adresse_sein(client, leer, schluessel, attrappe):
    await client.put("/api/einstellungen/email", json=APP_EINGABE, headers=ADMIN)
    r = await client.post("/api/einstellungen/email/test", json={"an": "keine-adresse"}, headers=ADMIN)
    assert r.status_code == 422


async def test_delegierte_anmeldung(client, leer, schluessel, attrappe):
    eingabe = {**APP_EINGABE, "modus": "delegiert", "client_secret": ""}
    await client.put("/api/einstellungen/email", json=eingabe, headers=ADMIN)

    start = await client.post("/api/einstellungen/email/delegiert/start", headers=ADMIN)
    assert start.status_code == 200, start.text
    assert start.json()["user_code"] == "ABCD-EFGH"
    geraet = start.json()["device_code"]

    warten = await client.post("/api/einstellungen/email/delegiert/abfragen",
                               json={"device_code": geraet}, headers=ADMIN)
    assert warten.json()["status"] == "pending"

    attrappe.geraet_status = "fertig"
    fertig = await client.post("/api/einstellungen/email/delegiert/abfragen",
                               json={"device_code": geraet}, headers=ADMIN)
    assert fertig.json() == {"status": "complete", "konto": "person@acm.example", "fehler": None}

    stand = (await client.get("/api/einstellungen/email", headers=ADMIN)).json()
    assert stand["delegiert_konto"] == "person@acm.example"
    assert stand["delegiert_verbunden"] is True
    assert "erneuerung" not in json.dumps(stand)

    r = await client.post("/api/einstellungen/email/test", json={"an": "empf@acm.example"}, headers=ADMIN)
    assert r.json()["ok"] is True
    [senden] = [a for a in attrappe.an_graph() if a.url.path.endswith("/sendMail")]
    assert senden.url.path == "/v1.0/me/sendMail"

    # Das rotierte Erneuerungstoken ist gespeichert — verschlüsselt.
    async with SessionLocal() as s:
        abgelegt = (await s.execute(
            sa.select(geheimnisse.c.geheimtext).where(geheimnisse.c.schluessel == "email_refresh_token")
        )).scalar_one()
    assert b"erneuerung" not in bytes(abgelegt)

    getrennt = await client.post("/api/einstellungen/email/delegiert/trennen", headers=ADMIN)
    assert getrennt.json()["delegiert_verbunden"] is False
