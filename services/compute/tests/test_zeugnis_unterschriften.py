"""Wer unter dem Zeugnis steht.

Die linke Unterschrift hängt an der Person, nicht am Haus: wer in der Näherei
arbeitet, bekommt die Unterschrift der Näherei. Sie kommt deshalb aus Personios
Organisationsstruktur — und muss zurückfallen, wenn die nichts hergibt.
"""
from __future__ import annotations

from datetime import date

import pytest
import pytest_asyncio
import sqlalchemy as sa

from app.db import SessionLocal
from app.zeugnis.unterschriften import (
    beide,
    fachlich,
    name_aus,
    personalseitig,
    position_aus,
    vorgesetzten_knoten,
)

CHEF = 990201
PERSON = 990202
OHNE_CHEF = 990203
HR = 990204

PROFIL = {
    "unterzeichner1_name": "Werner Werkleiter",
    "unterzeichner1_titel": "Werkleitung",
    "unterzeichner2_name": "Petra Personal",
    "unterzeichner2_titel": "Personalleitung",
    "hr_employee_id": None,
}


def roh(position: str | None = None, chef: dict | None = None) -> dict:
    attrs: dict = {}
    if position:
        attrs["position"] = {"value": position}
    if chef is not None:
        attrs["supervisor"] = {"value": {"attributes": chef}}
    return {"attributes": attrs}


@pytest_asyncio.fixture
async def db(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")
    kennungen = (CHEF, PERSON, OHNE_CHEF, HR)

    async def leeren():
        async with SessionLocal() as s:
            async with s.begin():
                await s.execute(
                    sa.text("delete from public.personio_employees where id = any(:i)"),
                    {"i": list(kennungen)},
                )

    await leeren()
    async with SessionLocal() as s:
        async with s.begin():
            for kennung, vor, nach, rohdaten in (
                (CHEF, "Carla", "Chefin", roh(position="Leitung Näherei")),
                (
                    PERSON,
                    "Dana",
                    "Neu",
                    roh(
                        position="Näherin",
                        chef={"id": {"value": CHEF}, "first_name": {"value": "Carla"},
                              "last_name": {"value": "Chefin"}},
                    ),
                ),
                (OHNE_CHEF, "Otto", "Ohne", roh(position="Näher")),
                (HR, "Petra", "Personal", roh(position="Leitung Personalwesen")),
            ):
                await s.execute(
                    sa.text(
                        "insert into public.personio_employees"
                        " (id, first_name, last_name, department, status, hire_date,"
                        "  synced_at, raw_json)"
                        " values (:i, :v, :n, 'Näherei', 'active', :d, now(), :r)"
                    ),
                    {"i": kennung, "v": vor, "n": nach, "d": date(2020, 1, 1),
                     "r": __import__("json").dumps(rohdaten)},
                )
    yield
    await leeren()


class TestAuspacken:
    def test_position(self):
        assert position_aus(roh(position="Näherin")) == "Näherin"

    def test_position_fehlt(self):
        assert position_aus(roh()) is None
        assert position_aus(None) is None

    def test_name_aus_vor_und_nachname(self):
        assert name_aus({"first_name": {"value": "Carla"},
                         "last_name": {"value": "Chefin"}}) == "Carla Chefin"

    def test_rufname_geht_vor(self):
        """Was im Haus auf dem Türschild steht, gehört unter die Unterschrift."""
        knoten = {
            "preferred_name": {"value": "C. Chefin"},
            "first_name": {"value": "Carla"},
            "last_name": {"value": "Chefin"},
        }
        assert name_aus(knoten) == "C. Chefin"

    def test_leerer_rufname_zaehlt_nicht(self):
        knoten = {
            "preferred_name": {"value": "   "},
            "first_name": {"value": "Carla"},
            "last_name": {"value": "Chefin"},
        }
        assert name_aus(knoten) == "Carla Chefin"

    def test_ohne_namen(self):
        assert name_aus({}) is None
        assert name_aus(None) is None

    def test_vorgesetztenknoten(self):
        knoten = vorgesetzten_knoten(roh(chef={"id": {"value": 7}}))
        assert knoten == {"id": {"value": 7}}

    def test_kein_vorgesetzter(self):
        assert vorgesetzten_knoten(roh()) is None


class TestFachlicheUnterschrift:
    @pytest.mark.asyncio
    async def test_vorgesetzte_aus_personio(self, db):
        async with SessionLocal() as s:
            u = await fachlich(s, PERSON, PROFIL)
        assert u.name == "Carla Chefin"
        assert u.titel == "Leitung Näherei"
        assert u.quelle == "personio"

    @pytest.mark.asyncio
    async def test_ohne_vorgesetzten_greift_das_profil(self, db):
        async with SessionLocal() as s:
            u = await fachlich(s, OHNE_CHEF, PROFIL)
        assert u.name == "Werner Werkleiter"
        assert u.quelle == "profil"

    @pytest.mark.asyncio
    async def test_externe_person_hat_keine_kennung(self, db):
        """Extern gepflegte Personen stehen nicht in Personio."""
        async with SessionLocal() as s:
            u = await fachlich(s, None, PROFIL)
        assert u.name == "Werner Werkleiter"
        assert u.quelle == "profil"

    @pytest.mark.asyncio
    async def test_ohne_profil_bleibt_sie_leer(self, db):
        """Lieber leer als falsch — eine erfundene Unterschrift wäre schlimmer."""
        async with SessionLocal() as s:
            u = await fachlich(s, OHNE_CHEF, {})
        assert u.leer
        assert u.quelle == "keine"


class TestPersonalseitigeUnterschrift:
    @pytest.mark.asyncio
    async def test_person_aus_dem_profil(self, db):
        async with SessionLocal() as s:
            u = await personalseitig(s, {**PROFIL, "hr_employee_id": HR})
        assert u.name == "Petra Personal"
        assert u.titel == "Leitung Personalwesen"
        assert u.quelle == "personio"

    @pytest.mark.asyncio
    async def test_ohne_gewaehlte_person_der_freitext(self, db):
        async with SessionLocal() as s:
            u = await personalseitig(s, PROFIL)
        assert u.name == "Petra Personal"
        assert u.quelle == "profil"

    @pytest.mark.asyncio
    async def test_geloeschte_person_faellt_zurueck(self, db):
        """Der Fremdschlüssel steht auf `set null` — aber sicher ist sicher."""
        async with SessionLocal() as s:
            u = await personalseitig(s, {**PROFIL, "hr_employee_id": 999999})
        assert u.name == "Petra Personal"
        assert u.quelle == "profil"


class TestBeide:
    @pytest.mark.asyncio
    async def test_zwei_verschiedene_quellen(self, db):
        async with SessionLocal() as s:
            links, rechts = await beide(s, PERSON, PROFIL)
        assert (links.name, links.quelle) == ("Carla Chefin", "personio")
        assert (rechts.name, rechts.quelle) == ("Petra Personal", "profil")
