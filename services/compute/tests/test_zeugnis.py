"""Der Zeugnis-Baukasten — Sprache aus Noten.

Geprüft wird das, was den Text ausmacht: die Zufriedenheitsformel je Note, die
geschlechtsgerechten Pronomen und dass kein Name in die Bausteine gerät (der
Platzhalter bleibt, bis der Aufrufer ihn ersetzt).
"""
from __future__ import annotations

from datetime import date

import pytest

from app.zeugnis.baukasten import baue_abschnitte, ersetze_pronomen
from app.zeugnis.begriffe import ABSCHNITTE


def abschnitte(**abweichung):
    grund = dict(
        geschlecht="w",
        geburtsdatum=date(1990, 5, 17),
        taetigkeit="CNC-Fräserin",
        abteilung="Production",
        eintritt=date(2022, 3, 1),
        austritt=date(2026, 8, 31),
        art="qualifiziert",
        anlass=None,
        fuehrungskraft=False,
        noten={"fachwissen": 1, "arbeitsweise": 1, "sozialverhalten": 2},
        schnitt=1.3,
        stichpunkte="Programmierung\nRüsten\nErstmusterprüfung",
        kompetenzen=None,
        erfolge=None,
    )
    grund.update(abweichung)
    return baue_abschnitte(**grund)


class TestAufbau:
    def test_alle_abschnitte_entstehen(self):
        ergebnis = abschnitte()
        assert set(ergebnis) == set(ABSCHNITTE)
        assert all(ergebnis[k] for k in ("einleitung", "leistungsbeurteilung"))

    def test_die_stichpunkte_werden_zur_aufzaehlung(self):
        ergebnis = abschnitte()
        assert "Programmierung" in ergebnis["taetigkeitsbeschreibung"]
        assert "Erstmusterprüfung" in ergebnis["taetigkeitsbeschreibung"]

    def test_der_zeitraum_steht_in_der_einleitung(self):
        ergebnis = abschnitte()
        assert "01.03.2022" in ergebnis["einleitung"]
        assert "31.08.2026" in ergebnis["einleitung"]

    def test_ein_zwischenzeugnis_endet_nicht(self):
        """Es wird ausgestellt, während das Arbeitsverhältnis läuft."""
        ergebnis = abschnitte(art="zwischenzeugnis", austritt=None)
        assert "verlässt unser Unternehmen" not in ergebnis["schlussformel"]

    def test_der_name_bleibt_platzhalter(self):
        """Der Baukasten kennt keinen Namen — der Aufrufer setzt ihn ein."""
        ergebnis = abschnitte()
        assert "[NAME]" in ergebnis["einleitung"]


class TestZufriedenheit:
    @pytest.mark.parametrize(
        "schnitt, formel",
        [
            (1.0, "stets zu unserer vollsten Zufriedenheit"),
            (1.4, "stets zu unserer vollsten Zufriedenheit"),
            (2.0, "stets zu unserer vollen Zufriedenheit"),
            (3.0, "zu unserer vollen Zufriedenheit"),
            (4.0, "zu unserer Zufriedenheit"),
        ],
    )
    def test_die_formel_folgt_der_note(self, schnitt, formel):
        """Die verkehrsübliche Skala — sie ist der Kern der Zeugnissprache."""
        ergebnis = abschnitte(schnitt=schnitt, noten={"arbeitserfolg": round(schnitt)})
        assert formel in ergebnis["leistungsbeurteilung"]


class TestPronomen:
    @pytest.mark.parametrize(
        "geschlecht, erwartet",
        [("m", "er"), ("w", "sie"), ("d", "die Person"), (None, "die Person")],
    )
    def test_das_richtige_pronomen(self, geschlecht, erwartet):
        assert ersetze_pronomen("Dabei zeigte [ER_SIE] Einsatz.", geschlecht) == (
            f"Dabei zeigte {erwartet} Einsatz."
        )

    def test_am_satzanfang_gross(self):
        assert ersetze_pronomen("[ER_SIE] arbeitete gründlich.", "w").startswith("Sie ")

    def test_ohne_angabe_wird_nie_misgendert(self):
        """Statt zu raten wird geschlechtsneutral formuliert."""
        text = ersetze_pronomen("Wir danken [IHM_IHR] für [SEINE_IHRE] Arbeit.", None)
        assert "der Person" in text and "ihre" in text

    def test_text_ohne_platzhalter_bleibt_unberuehrt(self):
        assert ersetze_pronomen("Ein Satz ohne alles.", "m") == "Ein Satz ohne alles."
