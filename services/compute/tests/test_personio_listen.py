"""Die Auswahllisten für die Einstellungsmaske.

Geprüft wird das Auspacken der Personio-Antworten. Sie sind tief verschachtelt
und je nach Feld anders gebaut — genau deshalb sollen die Listen entstehen,
statt dass jemand IDs abtippt.
"""
from __future__ import annotations

from app.personio.listen import KEINE_KOMPETENZ, Art, _name, _typ_name, art_aus


class TestNamenAuspacken:
    def test_flacher_text(self):
        assert _name("Fertigung") == "Fertigung"

    def test_wert_knoten(self):
        assert _name({"value": "Fertigung"}) == "Fertigung"

    def test_referenz_mit_attributen(self):
        """So kommt eine Abteilung an einer Person an."""
        assert _name({"value": {"attributes": {"name": "Fertigung"}}}) == "Fertigung"

    def test_leeres_wird_zu_nichts(self):
        assert _name({"value": "   "}) is None
        assert _name({"value": None}) is None
        assert _name(None) is None
        assert _name(42) is None


class TestAbwesenheitsart:
    def test_gewoehnliche_form(self):
        assert art_aus({"attributes": {"id": 568234, "name": "Krankheit"}}) == Art(
            568234, "Krankheit"
        )

    def test_id_aussen(self):
        assert art_aus({"id": 77, "attributes": {"name": {"value": "Urlaub"}}}) == Art(
            77, "Urlaub"
        )

    def test_ohne_namen_faellt_weg(self):
        """Eine Art ohne Namen taugt nicht als Auswahleintrag."""
        assert art_aus({"attributes": {"id": 1}}) is None

    def test_ohne_id_faellt_weg(self):
        assert art_aus({"attributes": {"name": "Krankheit"}}) is None

    def test_id_als_text_faellt_weg(self):
        """`krank_typ_ids` vergleicht Zahlen — ein Text stünde stumm daneben."""
        assert art_aus({"attributes": {"id": "568234", "name": "Krankheit"}}) is None


class TestArtAusDemBestand:
    """Der Notnagel: was in den abgeglichenen Abwesenheiten steht."""

    def test_absence_type(self):
        roh = {"attributes": {"absence_type": {"attributes": {"name": "Krankheit"}}}}
        assert _typ_name(roh) == "Krankheit"

    def test_time_off_type(self):
        roh = {"attributes": {"time_off_type": {"attributes": {"name": "Urlaub"}}}}
        assert _typ_name(roh) == "Urlaub"

    def test_ohne_alles(self):
        assert _typ_name({"attributes": {}}) is None
        assert _typ_name(None) is None


class TestFelderfilter:
    def test_stammdaten_sind_keine_kompetenz(self):
        """Ohne den Filter stünden 60 Einträge zur Auswahl, 50 davon unsinnig."""
        for feld in ("first_name", "fix_salary", "department", "supervisor"):
            assert feld in KEINE_KOMPETENZ

    def test_eigene_felder_bleiben(self):
        for feld in ("dynamic_4711", "schweissschein", "staplerschein"):
            assert feld not in KEINE_KOMPETENZ
