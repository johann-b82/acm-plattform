"""Der Dateiname eines ATR auf dem Dateiserver.

QS und Logistik suchen die Dokumente nach dem Namen, den das Altprojekt vergab
(`delivery_filename_base` in `services/atr_deliver.py`). Ein anderer Name legt
die Datei nicht falsch ab — aber niemand findet sie unter dem gewohnten.
"""
from __future__ import annotations

from app.atr.format import dateiname_basis

VOLL = {
    "programm": "A350",
    "atr_nummer": "4820",
    "ba_auftrag": "1024796",
    "bereich": "FCRC",
    "msn": "844",
    "bestellnummer": "4501124711",
    "bettvariante": "6",
}


def pos(bestellposition=None, kategorie=None) -> dict:
    return {"bestellposition": bestellposition, "kategorie": kategorie}


class TestDateiname:
    def test_das_beispiel_aus_dem_altprojekt(self):
        assert dateiname_basis(
            VOLL, [pos("19", "HEAD"), pos("20", "HEAD")]
        ) == (
            "ACM_ATR_WR_COC_A350_ATR-4820-01 BA1024796_FCRC_MSN 844_4501124711"
            " 6 BED Head Pos 190, 200"
        )

    def test_ohne_atr_nummer_kein_nummernteil(self):
        assert dateiname_basis({**VOLL, "atr_nummer": None}, []).startswith(
            "ACM_ATR_WR_COC_A350_ATR BA1024796"
        )

    def test_ohne_programm_gilt_a350(self):
        assert dateiname_basis({"programm": None}, []) == "ACM_ATR_WR_COC_A350_ATR"

    def test_leere_teile_fallen_weg(self):
        assert (
            dateiname_basis({"programm": "A380", "atr_nummer": "12", "msn": "5"}, [])
            == "ACM_ATR_WR_COC_A380_ATR-12-01_MSN 5"
        )

    def test_die_erste_kategorie_zaehlt_in_titelschreibweise(self):
        name = dateiname_basis(VOLL, [pos(), pos(kategorie="SEAT BACK"), pos(kategorie="HEAD")])
        assert name.endswith(" 6 BED Seat Back")

    def test_positionen_dreistellig_und_leere_ausgelassen(self):
        name = dateiname_basis(VOLL, [pos("1"), pos(None), pos("120")])
        assert name.endswith(" Pos 010, 120")

    def test_zu_lang_dann_ohne_positionen(self):
        """130 Zeichen samt Positionen — sonst wird der ganze Pfad auf der
        Freigabe zu lang. Die Positionen fallen dann ganz weg, nicht halb."""
        viele = [pos(str(n)) for n in range(10, 60)]
        name = dateiname_basis(VOLL, viele)
        assert "Pos" not in name
        assert name.endswith("4501124711 6 BED")

    def test_unzulaessige_zeichen_verschwinden(self):
        name = dateiname_basis({**VOLL, "bereich": 'F/C:R*C?'}, [])
        assert "_FCRC_" in name

    def test_leerzeichen_um_die_werte_werden_gestutzt(self):
        assert dateiname_basis({"programm": " A380 ", "msn": " 7 "}, []) == (
            "ACM_ATR_WR_COC_A380_ATR_MSN 7"
        )
