"""Der signierte Token für die Bildschirmanzeigen — Befund 4.

Geprüft wird, was den Token trägt: die Unterschrift, der Ablauf, die Art. Und
die Helfer, die aus den Personio-Rohdaten den Geburtstag der Woche machen —
ohne dass das Geburtsdatum die Anzeige je erreicht.
"""
from __future__ import annotations

import base64
import json
import time
from datetime import date
from unittest.mock import patch

import pytest

from app import embed
from app.routers import embed as routen

GEHEIM = "test-embed-secret-0123456789abcdef"


@pytest.fixture(autouse=True)
def mit_geheimnis():
    with patch.object(embed.settings, "EMBED_SECRET", GEHEIM):
        yield


class TestToken:
    def test_hin_und_zurueck(self):
        anzeige = embed.pruefe_token(embed.baue_token("geburtstage"), "geburtstage")
        assert anzeige.art == "geburtstage"
        assert anzeige.gueltig_bis > time.time()

    def test_verfaelschter_rumpf_faellt_auf(self):
        """Der Kern: wer den Rumpf umschreibt, hat keine passende Unterschrift."""
        _, unterschrift = embed.baue_token("geburtstage").split(".", 1)
        gefaelscht = json.dumps(
            {"art": "neuzugaenge", "bis": int(time.time()) + 86400},
            separators=(",", ":"),
            sort_keys=True,
        ).encode()
        neuer = base64.urlsafe_b64encode(gefaelscht).decode().rstrip("=")
        with pytest.raises(embed.TokenUngueltig, match="Unterschrift"):
            embed.pruefe_token(f"{neuer}.{unterschrift}", "neuzugaenge")

    def test_abgelaufener_token(self):
        """Ein Playlist-Eintrag, den niemand mehr pflegt, hört von selbst auf."""
        alt = embed.baue_token("geburtstage", gueltig_tage=-1)
        with pytest.raises(embed.TokenUngueltig, match="abgelaufen"):
            embed.pruefe_token(alt, "geburtstage")

    def test_token_gilt_nur_fuer_seine_anzeige(self):
        token = embed.baue_token("geburtstage")
        with pytest.raises(embed.TokenUngueltig, match="andere Anzeige"):
            embed.pruefe_token(token, "neuzugaenge")

    def test_token_eines_anderen_geheimnisses(self):
        token = embed.baue_token("geburtstage")
        with patch.object(embed.settings, "EMBED_SECRET", "ein-ganz-anderes-geheimnis"):
            with pytest.raises(embed.TokenUngueltig, match="Unterschrift"):
                embed.pruefe_token(token, "geburtstage")

    def test_unsinn_ist_kein_token(self):
        for unsinn in ("", "keinpunkt", "@@@.@@@", "."):
            with pytest.raises(embed.TokenUngueltig):
                embed.pruefe_token(unsinn, "geburtstage")

    def test_ohne_geheimnis_sind_die_anzeigen_aus(self):
        with patch.object(embed.settings, "EMBED_SECRET", ""):
            with pytest.raises(embed.TokenUngueltig, match="EMBED_SECRET"):
                embed.baue_token("geburtstage")
            with pytest.raises(embed.TokenUngueltig, match="EMBED_SECRET"):
                embed.pruefe_token("egal.egal", "geburtstage")


class TestRohdaten:
    """Personio hängt die Felder je nach Fassung woanders ein."""

    ROH = {
        "attributes": {
            "dynamic_42": {"label": "Geburtsdatum", "value": "1985-06-14T00:00:00+02:00"},
            "profil": [{"label": "Profile Picture", "value": "https://…/bild.jpg"}],
        }
    }

    def test_geburtsdatum_wird_tief_gefunden(self):
        assert routen.geburtsdatum_aus(self.ROH) == "1985-06-14T00:00:00+02:00"
        assert routen.als_datum(routen.geburtsdatum_aus(self.ROH)) == date(1985, 6, 14)

    def test_datum_ohne_uhrzeit(self):
        assert routen.als_datum("1985-06-14") == date(1985, 6, 14)

    def test_unbrauchbares_datum(self):
        assert routen.als_datum("keine Ahnung") is None

    def test_foto_vorhanden(self):
        assert routen.hat_foto(self.ROH) is True

    def test_leeres_foto_zaehlt_nicht(self):
        assert routen.hat_foto({"label": "Profile Picture", "value": None}) is False

    def test_ohne_geburtsdatum(self):
        assert routen.geburtsdatum_aus({"attributes": {"x": {"label": "Abteilung"}}}) is None


class TestJahrestag:
    def test_gewoehnlich(self):
        assert routen.jahrestag(date(1985, 6, 14), 2026) == date(2026, 6, 14)

    def test_neunundzwanzigster_februar_wird_achtundzwanzigster(self):
        """Sonst fiele der Geburtstag in drei von vier Jahren aus der Anzeige."""
        assert routen.jahrestag(date(1984, 2, 29), 2026) == date(2026, 2, 28)


class TestWoche:
    def test_montag_bis_sonntag(self):
        # Der 11.09.2026 ist ein Freitag.
        assert routen.woche(date(2026, 9, 11)) == (date(2026, 9, 7), date(2026, 9, 13))

    def test_am_montag_selbst(self):
        montag, sonntag = routen.woche(date(2026, 9, 7))
        assert montag == date(2026, 9, 7)
        assert sonntag == date(2026, 9, 13)
