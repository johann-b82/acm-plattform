"""Die Einstellung des Eingangsordners gegen eine echte Datenbank.

Zwei Stufen liegen hier übereinander: sehen darf, wer ATR benutzt — eintragen,
wohin der Dienst greift, nur die Plattform-Verwaltung. Das ist keine Frage der
Oberfläche: wer das Ziel setzt, bestimmt, gegen welchen Rechner im Netz sich
`compute` anmeldet.

Dazu der Takt (SET-14): ein freies Intervall in Sekunden, 0 = aus, und nie
zwei Läufe zugleich — und das Passwort des Dienstkontos (SET-13), das über die
Maske hinein, aber nie wieder heraus kommt.
"""
from __future__ import annotations

import pytest
import pytest_asyncio
import sqlalchemy as sa
from asgi_lifespan import LifespanManager
from cryptography.fernet import Fernet
from httpx import ASGITransport, AsyncClient

from app.atr import scan as scan_modul
from app.config import settings
from app.db import SessionLocal, geheimnisse
from app.main import app
from tests._auth import USER_ID, mint

LESER = '{"sub":"%s","role":"authenticated","apps":{"atr":"viewer"}}' % USER_ID
PFLEGER = '{"sub":"%s","role":"authenticated","apps":{"atr":"editor"}}' % USER_ID
VERWALTUNG = '{"sub":"%s","role":"authenticated","apps":{"platform":"admin"}}' % USER_ID
FREMD = '{"sub":"%s","role":"authenticated","apps":{"hr":"admin"}}' % USER_ID


async def _zuruecksetzen():
    async with SessionLocal() as s:
        async with s.begin():
            await s.execute(
                sa.text(
                    "update public.atr_scan set intervall_s = 0, angestossen_am = null,"
                    " lauf_seit = null"
                )
            )
            await s.execute(sa.delete(geheimnisse).where(geheimnisse.c.schluessel == "atr_smb_passwort"))


@pytest_asyncio.fixture
async def db(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")
    await _zuruecksetzen()
    yield
    await _zuruecksetzen()


async def als(claims: str, sql: str, **params):
    async with SessionLocal() as s:
        trans = await s.begin()
        try:
            await s.execute(sa.text("set local role authenticated"))
            await s.execute(
                sa.text("select set_config('request.jwt.claims', :c, true)"), {"c": claims}
            )
            ergebnis = await s.execute(sa.text(sql), params)
            return [dict(r) for r in ergebnis.mappings()] if ergebnis.returns_rows else []
        finally:
            await trans.rollback()


async def ausfuehren(sql: str, **params):
    async with SessionLocal() as s:
        async with s.begin():
            ergebnis = await s.execute(sa.text(sql), params)
            return [dict(r) for r in ergebnis.mappings()] if ergebnis.returns_rows else []


LESEN = "select intervall_s from public.atr_scan"
SCHALTEN = "update public.atr_scan set intervall_s = 300 where id returning intervall_s"


class TestRechte:
    async def test_wer_atr_benutzt_sieht_das_ziel(self, db):
        assert len(await als(LESER, LESEN)) == 1

    async def test_ohne_atr_bleibt_die_zeile_unsichtbar(self, db):
        assert await als(FREMD, LESEN) == []

    async def test_auch_ein_pfleger_darf_nicht_umstellen(self, db):
        # Kein Fehler, sondern null Zeilen: die Regel filtert, sie wirft nicht.
        assert await als(PFLEGER, SCHALTEN) == []

    async def test_die_verwaltung_darf(self, db):
        assert await als(VERWALTUNG, SCHALTEN) == [{"intervall_s": 300}]

    async def test_den_laufstempel_setzt_nur_der_dienst(self, db):
        """Wer den Stempel setzen könnte, hielte den Scan für immer an."""
        with pytest.raises(Exception) as fehler:
            await als(VERWALTUNG, "update public.atr_scan set lauf_seit = now() where id")
        assert "permission" in str(fehler.value).lower()

    async def test_ein_negatives_intervall_gibt_es_nicht(self, db):
        with pytest.raises(Exception) as fehler:
            await ausfuehren("update public.atr_scan set intervall_s = -1")
        assert "check" in str(fehler.value).lower()

    async def test_den_anstoss_ruft_niemand_von_aussen(self, db):
        with pytest.raises(Exception) as fehler:
            await als(VERWALTUNG, "select public.atr_scan_faellig()")
        assert "permission" in str(fehler.value).lower()


FAELLIG = "select public.atr_scan_faellig() as f"


async def faellig() -> bool:
    return (await ausfuehren(FAELLIG))[0]["f"]


class TestTakt:
    """pg_cron klopft alle zehn Sekunden an; ob wirklich ein Lauf fällig ist,
    entscheidet diese Funktion — mit einem Schreibvorgang, also genau einmal,
    auch wenn zwei Anstöße zugleich kommen."""

    async def test_null_ist_aus(self, db):
        assert await faellig() is False

    async def test_nach_einem_anstoss_wartet_er_das_intervall_ab(self, db):
        await ausfuehren("update public.atr_scan set intervall_s = 60")
        assert await faellig() is True
        assert await faellig() is False

        await ausfuehren(
            "update public.atr_scan set angestossen_am = now() - interval '61 seconds'"
        )
        assert await faellig() is True

    async def test_ein_halber_takt_spielraum(self, db):
        """Der Takt ist zehn Sekunden; ohne Spielraum würde aus 60 Sekunden
        durch Laufzeitschwankung jedes Mal 70."""
        await ausfuehren(
            "update public.atr_scan set intervall_s = 60,"
            " angestossen_am = now() - interval '57 seconds'"
        )
        assert await faellig() is True
        await ausfuehren(
            "update public.atr_scan set angestossen_am = now() - interval '50 seconds'"
        )
        assert await faellig() is False

    async def test_waehrend_eines_laufs_kein_zweiter(self, db):
        await ausfuehren("update public.atr_scan set intervall_s = 10, lauf_seit = now()")
        assert await faellig() is False

    async def test_ein_verwaister_lauf_haelt_nicht_ewig_auf(self, db):
        await ausfuehren(
            "update public.atr_scan set intervall_s = 10,"
            " lauf_seit = now() - interval '2 hours'"
        )
        assert await faellig() is True


class TestBelegung:
    """Nie zwei Läufe zugleich — auch nicht von Hand neben dem geplanten, und
    auch nicht, wenn `compute` mehrfach läuft."""

    async def test_nur_einer_bekommt_den_ordner(self, db):
        assert await scan_modul.belegen() is True
        assert await scan_modul.belegen() is False
        await scan_modul.freigeben()
        assert await scan_modul.belegen() is True
        await scan_modul.freigeben()


@pytest.fixture
def schluessel(monkeypatch):
    monkeypatch.setattr(settings, "GEHEIM_SCHLUESSEL", Fernet.generate_key().decode())
    monkeypatch.setattr(settings, "SENSOR_SCHLUESSEL", "")


class TestPasswort:
    async def test_die_datenbank_geht_vor_der_umgebung(self, db, schluessel, monkeypatch):
        monkeypatch.setattr(settings, "ATR_SMB_PASSWORT", "aus-der-umgebung")
        assert await scan_modul.passwort() == "aus-der-umgebung"

        await scan_modul.passwort_setzen("aus-der-maske", None)
        assert await scan_modul.passwort() == "aus-der-maske"

        abgelegt = (await ausfuehren(
            "select geheimtext from public.geheimnisse where schluessel = 'atr_smb_passwort'"
        ))[0]["geheimtext"]
        assert b"aus-der-maske" not in bytes(abgelegt)

    async def test_ohne_beides_gibt_es_keins(self, db, schluessel, monkeypatch):
        monkeypatch.setattr(settings, "ATR_SMB_PASSWORT", "")
        assert await scan_modul.passwort() is None
        stand = await scan_modul.passwort_stand()
        assert (stand.gesetzt, stand.quelle) == (False, None)

    async def test_der_stand_verraet_das_passwort_nicht(self, db, schluessel):
        await scan_modul.passwort_setzen("streng-geheim", None)
        stand = await scan_modul.passwort_stand()
        assert (stand.gesetzt, stand.quelle) == (True, "datenbank")
        assert "streng-geheim" not in repr(stand)


@pytest_asyncio.fixture
async def client():
    async with LifespanManager(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            yield ac


#: Eine eigene Person: `geheimnisse.geaendert_von` verweist auf `auth.users`,
#: und ob die Kennung der anderen Tests dort steht, hinge an der Reihenfolge.
VERWALTER_ID = "22222222-2222-2222-2222-222222222222"


@pytest_asyncio.fixture
async def verwalter(db):
    await ausfuehren(
        "insert into auth.users (id) values (cast(:i as uuid)) on conflict do nothing",
        i=VERWALTER_ID,
    )
    yield {"Authorization": f"Bearer {mint({'platform': 'admin'}, sub=VERWALTER_ID)}"}
    await _zuruecksetzen()
    await ausfuehren("delete from auth.users where id = cast(:i as uuid)", i=VERWALTER_ID)


class TestPasswortRoute:
    async def test_nur_die_verwaltung(self, db, schluessel, client):
        kopf = {"Authorization": f"Bearer {mint({'atr': 'editor'})}"}
        assert (await client.get("/api/atr/scan/passwort", headers=kopf)).status_code == 403
        antwort = await client.put(
            "/api/atr/scan/passwort", headers=kopf, json={"passwort": "x"}
        )
        assert antwort.status_code == 403

    async def test_hinein_ja_heraus_nie(self, verwalter, schluessel, client):
        kopf = verwalter
        antwort = await client.put(
            "/api/atr/scan/passwort", headers=kopf, json={"passwort": "streng-geheim"}
        )
        assert antwort.status_code == 200
        assert "streng-geheim" not in antwort.text
        assert antwort.json()["gesetzt"] is True

        gelesen = await client.get("/api/atr/scan/passwort", headers=kopf)
        assert gelesen.json()["quelle"] == "datenbank"
        assert "streng-geheim" not in gelesen.text

    async def test_leer_ueberschreibt_nicht(self, verwalter, schluessel, client):
        kopf = verwalter
        await client.put("/api/atr/scan/passwort", headers=kopf, json={"passwort": "bleibt"})
        antwort = await client.put("/api/atr/scan/passwort", headers=kopf, json={"passwort": ""})
        assert antwort.status_code == 422
        assert await scan_modul.passwort() == "bleibt"
