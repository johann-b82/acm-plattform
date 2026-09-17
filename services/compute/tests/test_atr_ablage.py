"""Das Ablegen eines fertigen ATR auf dem Dateiserver.

Geprüft wird das, was bei einem Fehler niemandem auffiele: die Programmweiche
trifft das richtige Verzeichnis, und Jahres- wie Kalenderwochenordner werden
eingesetzt. Dass die Vorbelegung in der Datenbank wörtlich den Pfaden des
Altprojekts entspricht, prüft `test_atr_ablage_db.py`.

Ein falscher Pfad legt das Dokument still an einen Ort, an dem niemand
nachsieht — der Lauf meldet Erfolg, und die QS wartet.
"""
from __future__ import annotations

from datetime import date
from unittest.mock import patch

import pytest

from app.atr import ziele as z
from app.atr.dateiserver import DateiserverFehler, Ziel


#: Die Pfade des Altprojekts, so wie `0058_atr_ablageziele` sie vorbelegt.
VORGABEN = {
    "ziel_mappe_a350": (
        r"1300 - Qualität\1320_QS\132002_WA-Prüfung\132002_02_TR_Spec_QAA"
        r"\DIEHL\A350\ATR_Acceptance Test Report\ACM_ATR_A350_.....{jahr}"
    ),
    "ziel_mappe_a380": (
        r"1300 - Qualität\1320_QS\132002_WA-Prüfung\132002_02_TR_Spec_QAA"
        r"\DIEHL\A380\ATR_Acceptance Test Report\ACM_ATR_A 380_.....{jahr}"
    ),
    "ziel_logistik": r"1200 - Logistik\Versand\ATR`S_Weight Reports_Firma Diehl_Portal",
    "ziel_weight_report": (
        r"1300 - Qualität\1320_QS\132002_WA-Prüfung\132002_02_TR_Spec_QAA"
        r"\DIEHL\Weight Report für Firma Diehl ( verschicken )\{jahr}\KW {kw}"
    ),
}


def ziel() -> Ziel:
    return Ziel(
        rechner="acm_file.acm.local", freigabe="Dateiablage", domaene="ACM",
        benutzer="dienst", passwort="geheim", eingang="ATR/Input",
        ausgang="ATR/Output", archiv="ATR/Archiv",
    )


class TestProgrammweiche:
    """Im Altprojekt entscheidet `"380" in ac_programme` — nicht ein Vergleich
    auf die genaue Schreibweise. Die Quelle schreibt es uneinheitlich."""

    @pytest.mark.parametrize(
        "programm", ["A380", "A 380", "a380", "A380-800", "380"]
    )
    def test_alles_mit_380_ist_a380(self, programm):
        assert z.ist_a380(programm) is True

    @pytest.mark.parametrize("programm", ["A350", "A350-900", "", None, "A320"])
    def test_alles_andere_ist_a350(self, programm):
        assert z.ist_a380(programm) is False


class TestZiele:
    """Drei Ziele, und nur das erste hängt am Programm."""

    def test_immer_drei_ziele(self):
        assert len(z.ziele("A350", VORGABEN)) == 3
        assert len(z.ziele("A380", VORGABEN)) == 3

    def test_eine_mappe_und_zwei_pdf(self):
        arten = [zz.art for zz in z.ziele("A350", VORGABEN)]
        assert arten == ["mappe", "pdf", "pdf"]

    def test_die_pdf_ziele_kennen_kein_programm(self):
        a350 = [zz.vorlage for zz in z.ziele("A350", VORGABEN) if zz.art == "pdf"]
        a380 = [zz.vorlage for zz in z.ziele("A380", VORGABEN) if zz.art == "pdf"]
        assert a350 == a380

    def test_pfad_der_mappe_a350(self):
        mappe = z.ziele("A350", VORGABEN)[0]
        assert z.pfad(mappe, date(2026, 9, 17)) == (
            "1300 - Qualität\\1320_QS\\132002_WA-Prüfung\\132002_02_TR_Spec_QAA"
            "\\DIEHL\\A350\\ATR_Acceptance Test Report\\ACM_ATR_A350_.....2026"
        )

    def test_pfad_der_mappe_a380_hat_das_leerzeichen(self):
        """Der A380-Jahresordner heißt „ACM_ATR_A 380_....." — mit Leerzeichen.
        Ohne es landet die Mappe in einem neuen, leeren Ordner daneben."""
        mappe = z.ziele("A380", VORGABEN)[0]
        assert z.pfad(mappe, date(2026, 9, 17)) == (
            "1300 - Qualität\\1320_QS\\132002_WA-Prüfung\\132002_02_TR_Spec_QAA"
            "\\DIEHL\\A380\\ATR_Acceptance Test Report\\ACM_ATR_A 380_.....2026"
        )

    def test_pfad_logistik(self):
        logistik = z.ziele("A350", VORGABEN)[1]
        # Der Backtick im Ordnernamen steht so auf dem Server.
        assert z.pfad(logistik, date(2026, 9, 17)) == (
            "1200 - Logistik\\Versand\\ATR`S_Weight Reports_Firma Diehl_Portal"
        )

    def test_pfad_weight_report_mit_jahr_und_kw(self):
        wr = z.ziele("A350", VORGABEN)[2]
        assert z.pfad(wr, date(2026, 9, 17)) == (
            "1300 - Qualität\\1320_QS\\132002_WA-Prüfung\\132002_02_TR_Spec_QAA"
            "\\DIEHL\\Weight Report für Firma Diehl ( verschicken )\\2026\\KW 38"
        )

    def test_die_ordner_kommen_aus_der_einstellung(self):
        eigene = {**VORGABEN, "ziel_mappe_a380": r"QS\A380\{jahr}", "ziel_logistik": "L"}
        assert [zz.vorlage for zz in z.ziele("A380", eigene)] == [
            r"QS\A380\{jahr}", "L", VORGABEN["ziel_weight_report"],
        ]

    def test_andere_klammern_bleiben_stehen(self):
        """Ersetzt wird wörtlich — ein Pfad ist kein Formatstring und darf
        nicht mit `KeyError` scheitern."""
        eigen = z.ServerZiel(art="pdf", vorlage=r"A\{x}\{jahr}", bezeichnung="t")
        assert z.pfad(eigen, date(2026, 9, 17)) == r"A\{x}\2026"

    def test_kalenderwoche_ist_zweistellig(self):
        """`KW 7` und `KW 07` sind zwei verschiedene Ordner."""
        wr = z.ziele("A350", VORGABEN)[2]
        assert z.pfad(wr, date(2026, 2, 10)).endswith("\\2026\\KW 07")

    def test_jahr_kommt_aus_dem_kalender_nicht_aus_der_iso_woche(self):
        """Der 1. Januar 2027 liegt in der ISO-Woche 53 des Jahres 2026. Der
        Ordner steht trotzdem unter 2027 — so macht es das Altprojekt, und so
        sind die Ordner auf dem Server abgelegt."""
        wr = z.ziele("A350", VORGABEN)[2]
        assert z.pfad(wr, date(2027, 1, 1)).endswith("\\2027\\KW 53")


class TestSchreiben:
    """`schreibe` legt fehlende Ordner an — der KW-Ordner existiert beim
    ersten ATR einer Woche noch nicht."""

    def test_legt_den_ordner_an_und_schreibt(self):
        from app.atr import dateiserver

        geschrieben: dict = {}

        class Datei:
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def write(self, daten): geschrieben["daten"] = daten

        with patch.object(dateiserver, "_anmelden"), \
             patch.object(dateiserver.smbclient, "makedirs") as makedirs, \
             patch.object(dateiserver.smbclient, "listdir", return_value=[]), \
             patch.object(dateiserver.smbclient, "open_file", return_value=Datei()):
            name = dateiserver.schreibe(ziel(), "A\\B", "x.pdf", b"inhalt")

        assert name == "x.pdf"
        assert geschrieben["daten"] == b"inhalt"
        makedirs.assert_called_once()
        assert makedirs.call_args[0][0].endswith("\\A\\B")

    def test_dublette_bekommt_eine_nummer(self):
        """Überschreiben wäre falsch: was einmal ausgeliefert wurde, bleibt."""
        from app.atr import dateiserver

        class Datei:
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def write(self, daten): pass

        with patch.object(dateiserver, "_anmelden"), \
             patch.object(dateiserver.smbclient, "makedirs"), \
             patch.object(
                 dateiserver.smbclient, "listdir",
                 return_value=["x.pdf", "x (1).pdf"],
             ), \
             patch.object(dateiserver.smbclient, "open_file", return_value=Datei()):
            assert dateiserver.schreibe(ziel(), "A", "x.pdf", b"i") == "x (2).pdf"

    def test_punkt_punkt_im_pfad_faellt_durch(self):
        """Befund 17: der Riegel sitzt im Erbauer, den jeder Aufruf passiert."""
        from app.atr import dateiserver

        with patch.object(dateiserver, "_anmelden"):
            with pytest.raises(DateiserverFehler, match="Unzulässiger Pfadbestandteil"):
                dateiserver.schreibe(ziel(), "A\\..\\..\\Woanders", "x.pdf", b"i")

    def test_ausgang_geht_denselben_weg(self):
        """`schreibe_ausgang` ist nur noch ein Aufruf von `schreibe` — damit es
        eine Stelle gibt, die Ordner anlegt und Dubletten behandelt."""
        from app.atr import dateiserver

        with patch.object(dateiserver, "schreibe", return_value="y.xlsx") as s:
            assert dateiserver.schreibe_ausgang(ziel(), "y.xlsx", b"i") == "y.xlsx"
        assert s.call_args[0][1] == "ATR/Output"
