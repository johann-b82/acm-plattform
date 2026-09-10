"""Zielwerte: wer sie sehen darf, wer sie ändern darf, und was drinsteht.

Lesen und Schreiben liegen hier bewusst auseinander: die Zielwerte gehören zu
den Kennzahlen (jeder, der sie sieht, braucht die Einordnung), gepflegt werden
sie aber in den Einstellungen.
"""
from __future__ import annotations

import json

import pytest
import sqlalchemy as sa

from app.db import SessionLocal

NUR_KPI = {"role": "authenticated", "apps": {"kpi": "viewer"}}
EINSTELLUNGEN_LESEN = {"role": "authenticated", "apps": {"kpi": "viewer", "settings": "viewer"}}
EINSTELLUNGEN_PFLEGEN = {"role": "authenticated", "apps": {"kpi": "viewer", "settings": "editor"}}
PLATTFORM_ADMIN = {"role": "authenticated", "apps": {"platform": "admin"}}
OHNE_RECHTE: dict = {"role": "authenticated", "apps": {}}

SUB = "11111111-1111-1111-1111-111111111111"


async def als(claims: dict, sql: str, **params):
    """`sql` als Rolle `authenticated` mit diesen Ansprüchen; danach Rollback."""
    async with SessionLocal() as session:
        trans = await session.begin()
        try:
            await session.execute(sa.text("set local role authenticated"))
            await session.execute(
                sa.text("select set_config('request.jwt.claims', :c, true)"),
                {"c": json.dumps({"sub": SUB, **claims})},
            )
            ergebnis = await session.execute(sa.text(sql), params)
            return [dict(r) for r in ergebnis.mappings()] if ergebnis.returns_rows else []
        finally:
            await trans.rollback()


@pytest.fixture
def db(datenbank_da):
    if not datenbank_da:
        pytest.skip("Keine Test-Datenbank erreichbar")


class TestBestand:
    async def test_die_zielwerte_der_portierten_module_sind_da(self, db):
        """Bewusst `issubset`: jedes weitere Modul bringt eigene Ziele mit."""
        zeilen = await als(PLATTFORM_ADMIN, "select schluessel from public.zielwerte")
        vorhanden = {z["schluessel"] for z in zeilen}
        assert {
            "einkauf_otd",
            "produktion_verzug",
            "qualitaet_audit_level1",
            "qualitaet_audit_level2",
        } <= vorhanden

    async def test_anteile_stehen_als_bruch(self, db):
        """0.98, nicht 98 — die Oberfläche rechnet um, die Datenbank nicht."""
        (zeile,) = await als(
            PLATTFORM_ADMIN,
            "select wert, einheit from public.zielwerte where schluessel = 'einkauf_otd'",
        )
        assert zeile["einheit"] == "anteil"
        assert float(zeile["wert"]) == 0.98

    async def test_richtung_unterscheidet_gut_und_schlecht(self, db):
        zeilen = await als(
            PLATTFORM_ADMIN, "select schluessel, richtung from public.zielwerte order by 1"
        )
        nach = {z["schluessel"]: z["richtung"] for z in zeilen}
        # Bei der Liefertreue ist mehr besser, beim Verzug weniger.
        assert nach["einkauf_otd"] == "min"
        assert nach["produktion_verzug"] == "max"


class TestLesen:
    async def test_wer_kennzahlen_sieht_sieht_die_ziele(self, db):
        zeilen = await als(NUR_KPI, "select schluessel from public.zielwerte")
        alle = await als(PLATTFORM_ADMIN, "select schluessel from public.zielwerte")
        assert len(zeilen) == len(alle) > 0

    async def test_ohne_kpi_recht_keine_zeilen(self, db):
        zeilen = await als(OHNE_RECHTE, "select schluessel from public.zielwerte")
        assert zeilen == []


class TestAendern:
    async def test_einstellungen_bearbeiten_darf_aendern(self, db):
        zeilen = await als(
            EINSTELLUNGEN_PFLEGEN,
            "update public.zielwerte set wert = 0.95 where schluessel = 'einkauf_otd'"
            " returning wert",
        )
        assert float(zeilen[0]["wert"]) == 0.95

    async def test_nur_ansehen_darf_nicht_aendern(self, db):
        """Die Policy trifft keine Zeile — kein Fehler, aber auch keine Wirkung."""
        zeilen = await als(
            EINSTELLUNGEN_LESEN,
            "update public.zielwerte set wert = 0.5 where schluessel = 'einkauf_otd'"
            " returning wert",
        )
        assert zeilen == []

    async def test_ohne_einstellungsrecht_keine_wirkung(self, db):
        zeilen = await als(
            NUR_KPI,
            "update public.zielwerte set wert = 0.5 where schluessel = 'einkauf_otd'"
            " returning wert",
        )
        assert zeilen == []

    async def test_plattform_admin_darf(self, db):
        """`app_level` gibt Plattform-Admins überall `admin`."""
        zeilen = await als(
            PLATTFORM_ADMIN,
            "update public.zielwerte set wert = 0.99 where schluessel = 'einkauf_otd'"
            " returning wert",
        )
        assert float(zeilen[0]["wert"]) == 0.99

    async def test_neue_zeilen_kommen_nur_aus_migrationen(self, db):
        """Kein insert-Recht: ein Zielwert gehört zu einer Kennzahl, nicht zur Laune."""
        with pytest.raises(Exception, match="permission denied|row-level security"):
            await als(
                PLATTFORM_ADMIN,
                "insert into public.zielwerte (schluessel, bereich, label, wert, einheit, richtung)"
                " values ('frei_erfunden', 'x', 'X', 1, 'anzahl', 'max')",
            )


class TestStufenhelfer:
    @pytest.mark.parametrize(
        "stufe,verlangt,erwartet",
        [
            ("admin", "editor", True),
            ("editor", "editor", True),
            ("viewer", "editor", False),
            ("admin", "admin", True),
            ("editor", "admin", False),
            ("viewer", "viewer", True),
        ],
    )
    async def test_reihenfolge_der_stufen(self, db, stufe, verlangt, erwartet):
        (zeile,) = await als(
            {"role": "authenticated", "apps": {"settings": stufe}},
            "select public.app_mindestens('settings', :s) as reicht",
            s=verlangt,
        )
        assert zeile["reicht"] is erwartet

    async def test_ohne_recht_reicht_nichts(self, db):
        (zeile,) = await als(
            OHNE_RECHTE, "select public.app_mindestens('settings', 'viewer') as reicht"
        )
        assert zeile["reicht"] is False
