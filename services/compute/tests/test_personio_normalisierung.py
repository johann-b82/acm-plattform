"""Personios Antworten sind nicht einheitlich verpackt — hier festgehalten.

Alle Formen stammen aus echten Antworten des Altprojekts (dort in den
Docstrings von `hr_sync.py` dokumentiert). Wer eine davon falsch auspackt,
bekommt keine Fehlermeldung, sondern still `None` — und eine Kennzahl, die
aus zu wenigen Zeilen gerechnet wird.
"""
from __future__ import annotations

from datetime import date, datetime, time, timezone

from app.personio.sync import (
    _abwesenheit_stunden,
    _abwesenheit_zeile,
    _anwesenheit_zeile,
    _datum,
    _freistellung_zeile,
    _mitarbeiter_zeile,
    _tief_id,
    _wert,
    _zeit,
)

JETZT = datetime(2026, 9, 10, tzinfo=timezone.utc)


class TestVerpackung:
    def test_wert_holt_aus_der_huelle(self):
        assert _wert({"a": {"label": "A", "value": 7}}, "a") == 7

    def test_wert_nimmt_flache_felder_wie_sie_sind(self):
        assert _wert({"a": 7}, "a") == 7

    def test_wert_bei_fehlendem_feld(self):
        assert _wert({}, "a") is None

    def test_tief_id_alle_drei_schachtelungen(self):
        assert _tief_id(42) == 42
        assert _tief_id({"attributes": {"id": {"value": 42}}}) == 42
        assert _tief_id({"attributes": {"id": 42}}) == 42
        assert _tief_id({"id": "42"}) == 42
        assert _tief_id(None) is None

    def test_zeit_aus_beiden_formen(self):
        assert _zeit("08:50") == time(8, 50)
        assert _zeit("08:50:00") == time(8, 50)
        # V2 liefert einen vollen Zeitstempel.
        assert _zeit("2026-01-26T08:50:00") == time(8, 50)
        assert _zeit(None) is None
        assert _zeit("Unsinn") is None

    def test_datum_aus_zeitstempel_und_datum(self):
        assert _datum("2026-01-26") == date(2026, 1, 26)
        assert _datum("2026-01-26T08:50:00Z") == date(2026, 1, 26)
        assert _datum(None) is None


class TestMitarbeiter:
    def test_abteilung_steckt_zwei_ebenen_tief(self):
        roh = {
            "attributes": {
                "id": {"value": 22933156},
                "first_name": {"value": "Anna"},
                "last_name": {"value": "Berger"},
                "status": {"value": "active"},
                "department": {"value": {"attributes": {"name": "Fertigung"}}},
                "hire_date": {"value": "2015-01-01"},
                "termination_date": {"value": None},
                "weekly_working_hours": {"value": "40.0"},
            }
        }
        z = _mitarbeiter_zeile(roh, JETZT)
        assert z["id"] == 22933156
        assert z["department"] == "Fertigung"
        assert z["hire_date"] == date(2015, 1, 1)
        assert z["termination_date"] is None
        assert z["weekly_working_hours"] == "40.0"

    def test_abteilung_auch_flach(self):
        roh = {"attributes": {"id": {"value": 1}, "department": {"value": "Einkauf"}}}
        assert _mitarbeiter_zeile(roh, JETZT)["department"] == "Einkauf"

    def test_ohne_abteilung(self):
        roh = {"attributes": {"id": {"value": 1}, "department": {"value": None}}}
        assert _mitarbeiter_zeile(roh, JETZT)["department"] is None


class TestAnwesenheit:
    def test_v2_segment(self):
        roh = {
            "id": "abc-123",
            "person": {"id": "22933156"},
            "type": "WORK",
            "attribution_date": "2026-01-26",
            "start": {"date_time": "2026-01-26T08:00:00"},
            "end": {"date_time": "2026-01-26T12:00:00"},
        }
        z = _anwesenheit_zeile(roh, JETZT)
        assert z["employee_id"] == 22933156
        assert z["datum"] == date(2026, 1, 26)
        assert (z["start_time"], z["end_time"]) == (time(8, 0), time(12, 0))
        # Pausen sind eigene BREAK-Segmente, keine Minutenangabe.
        assert z["break_minutes"] == 0


class TestAbwesenheit:
    def test_stunden_kommen_in_minuten(self):
        """`effective_duration` ist bei `hour` in Minuten. 300 sind fünf Stunden.

        Ohne die Division stünde der Wert sechzigfach zu groß in der Datenbank.
        """
        assert _abwesenheit_stunden({"measurement_unit": "hour", "effective_duration": 300}) == 5.0

    def test_tagesbasiert_bleibt_wie_geliefert(self):
        assert _abwesenheit_stunden({"measurement_unit": "day", "effective_duration": 2}) == 2.0

    def test_absence_period_wird_ausgepackt(self):
        roh = {
            "attributes": {
                "id": "uuid-1",
                "measurement_unit": "hour",
                "effective_duration": 300,
                "employee": {"attributes": {"id": {"value": 22933156}}},
                "time_off_type": {"attributes": {"time_off_type_id": 568234}},
                "start": "2026-01-26T00:00:00",
                "end": "2026-01-26T00:00:00",
            }
        }
        z = _abwesenheit_zeile(roh, JETZT)
        assert (z["id"], z["employee_id"], z["absence_type_id"]) == ("uuid-1", 22933156, 568234)
        assert z["hours"] == 5.0
        assert z["time_unit"] == "hour"

    def test_freistellung_rechnet_tage_in_stunden(self):
        roh = {
            "attributes": {
                "id": 9001,
                "employee": {"attributes": {"id": {"value": 7}}},
                "time_off_type": {"attributes": {"id": 568234}},
                "days_count": 2.5,
                "start_date": "2026-01-26",
                "end_date": "2026-01-28",
            }
        }
        z = _freistellung_zeile(roh, {7: 8.0}, JETZT)
        assert z["hours"] == 20.0          # 2,5 Tage × 8 h
        assert z["time_unit"] == "day"
        assert z["end_date"] == date(2026, 1, 28)

    def test_laufende_abwesenheit_ohne_ende(self):
        """Die Spalte ist NOT NULL; ohne Ende gilt der Beginn."""
        roh = {
            "attributes": {
                "id": 9002,
                "employee": {"attributes": {"id": {"value": 7}}},
                "days_count": 1,
                "start_date": "2026-01-26",
                "end_date": None,
            }
        }
        assert _freistellung_zeile(roh, {}, JETZT)["end_date"] == date(2026, 1, 26)

    def test_ohne_tagesarbeitszeit_gilt_acht_stunden(self):
        roh = {
            "attributes": {
                "id": 9003,
                "employee": {"attributes": {"id": {"value": 99}}},
                "days_count": 1,
                "start_date": "2026-01-26",
            }
        }
        assert _freistellung_zeile(roh, {}, JETZT)["hours"] == 8.0
