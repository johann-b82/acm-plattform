"""Die Namenszuordnung Excel → Personio — reine Rechnung, ohne Datenbank.

Eine falsche Zuordnung wäre schlimmer als keine, weil an ihr Leistungs-
bewertungen hängen. Deshalb: genauer Name oder alle Bestandteile auf dieselbe
Person, sonst nichts.
"""
from __future__ import annotations

from app.kompetenzen.namen import baue_index, finde_person, normalisiere


class Zeile:
    def __init__(self, id_, vorname, nachname):
        self.id = id_
        self.first_name = vorname
        self.last_name = nachname


class TestZuordnung:
    def setup_method(self):
        self.exakt, self.teile = baue_index(
            [
                Zeile(1, "Anna", "Meier"),
                Zeile(2, "Fernando", "Gomes Ferreira"),
                Zeile(3, "Peter", "Meier"),
            ]
        )

    def test_genauer_name(self):
        assert finde_person("Anna Meier", self.exakt, self.teile) == 1

    def test_schreibweise_ist_egal(self):
        assert finde_person("  anna   MEIER ", self.exakt, self.teile) == 1

    def test_fehlender_namensteil_wird_gefunden(self):
        assert finde_person("Fernando Gomes", self.exakt, self.teile) == 2

    def test_mehrdeutig_heisst_keine_zuordnung(self):
        assert finde_person("Meier", self.exakt, self.teile) is None

    def test_unbekannter_name_bleibt_offen(self):
        assert finde_person("Erika Mustermann", self.exakt, self.teile) is None

    def test_ein_teil_der_nirgends_passt_verhindert_den_treffer(self):
        assert finde_person("Anna Meier Schmidt", self.exakt, self.teile) is None

    def test_normalisierung(self):
        assert normalisiere("  Anna   Meier ") == "anna meier"

    def test_doppelte_leerzeichen_im_namen(self):
        # „John  Adusei Mensah" aus der Interviewdatei hat ein Doppelleerzeichen.
        exakt, teile = baue_index([Zeile(7, "John", "Adusei Mensah")])
        assert finde_person("John  Adusei Mensah", exakt, teile) == 7
