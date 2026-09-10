"""Parser des Diehl-Lieferscheins.

Der Parser ist in zwei Teile getrennt: `pdftotext` holt den Text, und die
Auswertung ist rein. Deshalb steht hier Text und kein PDF — geprüft wird, was
schiefgehen kann, nämlich die Erkennung der Felder.

Der Text unten ist der Aufbau, den `pdftotext -layout` liefert: Spalten durch
Leerzeichen, die Kopfzeile über den Positionen. Was diese Prüfungen **nicht**
belegen können: dass ein echter Lieferschein von heute genauso aussieht.
"""
from __future__ import annotations

from app.parsing.atr_lieferschein import lies_lieferschein

SCHEIN = """
                                              Lieferschein
                                              Nr.  704511          Datum  14.08.2026

  Pos  Artikel   Menge  Einheit  Bezeichnung
   10  4711          2  Stk
       Halter links Kabine                       Freigabe durch AV
       Ihre Nr. VR-1234-56
       Auftrag Nr. 880231 / 12
       Bestelldaten 4500123/CCRC/MSN0815/2-Bett/A350
       Bauteil-Index: B
       Seriennr. A08UAEL3376, A08UAEL3377

   20  4712          1  Stk
       Traverse
       Ihre Nr. VR-2000-11
       Auftrag Nr. 880231 / 3
       Bestelldaten 4500123/CCRC/MSN0815/2-Bett/A350
"""


class TestKopf:
    def test_nummer_und_datum(self):
        s = lies_lieferschein(SCHEIN)
        assert s.lieferschein_nr == "704511"
        assert s.datum == "14.08.2026"


class TestPositionen:
    def test_erkennt_beide_positionen(self):
        s = lies_lieferschein(SCHEIN)
        assert [p.pos for p in s.positionen] == [10, 20]
        assert [p.menge for p in s.positionen] == [2, 1]
        assert [p.lieferantennummer for p in s.positionen] == ["4711", "4712"]

    def test_schneidet_die_randnotiz_ab(self):
        """`pdftotext -layout` klebt die rechte Spalte an die Bezeichnung."""
        s = lies_lieferschein(SCHEIN)
        assert s.positionen[0].bezeichnung == "Halter links Kabine"

    def test_teilenummer_und_auftrag(self):
        s = lies_lieferschein(SCHEIN)
        p = s.positionen[0]
        assert p.teilenummer == "VR-1234-56"
        assert p.ba_auftrag == "880231"
        assert p.bestellposition == "12"

    def test_seriennummern_je_stueck(self):
        s = lies_lieferschein(SCHEIN)
        assert s.positionen[0].seriennummern == ["A08UAEL3376", "A08UAEL3377"]
        assert s.positionen[1].seriennummern == []

    def test_bauteilindex(self):
        s = lies_lieferschein(SCHEIN)
        assert s.positionen[0].index == "B"


class TestBestelldaten:
    def test_zerlegt_die_merkmale(self):
        s = lies_lieferschein(SCHEIN)
        p = s.positionen[0]
        assert p.bestellnummer == "4500123"
        assert p.bereich == "CCRC"
        assert p.msn == "0815"
        assert p.bettvariante == "2"
        assert p.programm == "A350"

    def test_reihenfolge_der_merkmale_ist_egal(self):
        text = SCHEIN.replace(
            "Bestelldaten 4500123/CCRC/MSN0815/2-Bett/A350",
            "Bestelldaten 4500123/A380/2-Bett/FCRC/MSN0815",
        )
        p = lies_lieferschein(text).positionen[0]
        assert p.programm == "A380"
        assert p.bereich == "FCRC"
        assert p.bettvariante == "2"

    def test_unbekanntes_merkmal_stoert_nicht(self):
        text = SCHEIN.replace(
            "Bestelldaten 4500123/CCRC/MSN0815/2-Bett/A350",
            "Bestelldaten 4500123/CCRC/XYZ/2-Bett/A350",
        )
        p = lies_lieferschein(text).positionen[0]
        assert p.programm == "A350"
        assert p.bestellnummer == "4500123"


class TestHinweise:
    def test_doppelter_lieferschein_wird_einmal_gezaehlt(self):
        """Zwei Kopien in einer PDF liefern jede Position doppelt."""
        s = lies_lieferschein(SCHEIN + SCHEIN)
        assert [p.pos for p in s.positionen] == [10, 20]
        assert any("Doppelter Lieferschein" in h for h in s.hinweise)

    def test_fehlende_felder_werden_gemeldet(self):
        text = SCHEIN.replace("       Ihre Nr. VR-1234-56\n", "")
        s = lies_lieferschein(text)
        assert any("Position 10: Ihre Nr. fehlt" in h for h in s.hinweise)

    def test_ohne_positionen_ein_hinweis(self):
        s = lies_lieferschein("Lieferschein\nNr.  1  Datum  01.01.2026\n")
        assert s.positionen == []
        assert "Keine Positionen erkannt." in s.hinweise

    def test_leerer_text_stuerzt_nicht_ab(self):
        s = lies_lieferschein("")
        assert s.lieferschein_nr is None
        assert s.positionen == []
