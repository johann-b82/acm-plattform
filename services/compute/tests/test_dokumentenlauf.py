"""Der Dokumentenlauf — der Weg, der QR und die Prüfung des Scans.

Der letzte Teil läuft durch die ganze Kette: Blatt bauen, mit LibreOffice nach
PDF wandeln, rastern, QR lesen, Felder messen. Das ist langsam, aber es ist der
einzige Test, der etwas beweist — die Feldrechtecke entstehen aus einem Modell
der Seitengeometrie, und ob das Modell stimmt, zeigt sich erst am gerenderten
Blatt.

Beim Bauen ist es zweimal danebengegangen, beide Male unsichtbar ohne diesen
Test: die Rechtecke saßen eine Zeile zu hoch, weil die Passermarken nicht
gefunden wurden, und die Ausrichtung fiel auf die QR-Ähnlichkeit zurück — die
kann eine ungleichmäßige Stauchung aber nicht auffangen.
"""
from __future__ import annotations

from datetime import date

import pytest
from PIL import ImageDraw

from app.dokumente import pruefung, qr, vorgang
from app.einarbeitung.bogen import Inhalt, baue_pdf, baue_xlsx

INHALTE = [
    Inhalt("Produktion", "Frau Meier", "Sicherheitsunterweisung an der Fräse"),
    Inhalt("Produktion", "Herr Klein", "Materialfluss und Lagerorte kennenlernen"),
]


class TestWeg:
    def test_die_stationen_in_ihrer_reihenfolge(self):
        assert vorgang.WEG == ("erstellt", "uebergeben", "zurueck", "geprueft")

    def test_immer_nur_einen_schritt(self):
        assert vorgang.darf_weiter("erstellt", "uebergeben")
        assert vorgang.darf_weiter("zurueck", "geprueft")

    def test_nicht_zwei_auf_einmal(self):
        """Ein Blatt, das nie jemand bekommen hat, lässt sich nicht prüfen."""
        assert not vorgang.darf_weiter("erstellt", "zurueck")
        assert not vorgang.darf_weiter("erstellt", "geprueft")

    def test_nicht_rueckwaerts(self):
        assert not vorgang.darf_weiter("geprueft", "zurueck")
        assert not vorgang.darf_weiter("uebergeben", "erstellt")

    def test_hinter_geprueft_kommt_nichts(self):
        with pytest.raises(vorgang.WegFehler, match="bereits geprüft"):
            vorgang.naechster("geprueft")


class TestKennung:
    def test_laenge_und_alphabet(self):
        kennung = vorgang.neue_kennung()
        assert len(kennung) == 10
        assert set(kennung) <= set("ABCDEFGHJKLMNPQRSTUVWXYZ23456789")

    def test_ohne_verwechselbare_zeichen(self):
        """Sie steht unter dem QR und wird notfalls abgetippt."""
        for zeichen in "0OI1l":
            assert zeichen not in "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

    def test_zwei_kennungen_sind_verschieden(self):
        assert len({vorgang.neue_kennung() for _ in range(200)}) == 200


class TestEndung:
    @pytest.mark.parametrize(
        "dateiname, typ, erwartet",
        [
            ("scan.pdf", "application/pdf", "pdf"),
            ("scan.PNG", "image/png", "png"),
            ("scan.jpeg", "image/jpeg", "jpg"),
            ("ohne_endung", "application/pdf", "pdf"),
            ("ohne_endung", "image/png", "png"),
            ("ohne_endung", None, "jpg"),
        ],
    )
    def test_aus_name_oder_typ(self, dateiname, typ, erwartet):
        assert vorgang.endung_aus(dateiname, typ) == erwartet


class TestTyp:
    """Der Eimer lässt nur eine feste Liste zu — die Endung ist verlässlicher
    als das, was der Browser mitschickt."""

    @pytest.mark.parametrize(
        "dateiname, typ, erwartet",
        [
            ("scan.pdf", "application/octet-stream", "application/pdf"),
            ("scan.PNG", None, "image/png"),
            ("bild.jpeg", None, "image/jpeg"),
            ("handout.pptx", None,
             "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
        ],
    )
    def test_aus_der_endung(self, dateiname, typ, erwartet):
        assert vorgang.mime_aus(dateiname, typ) == erwartet

    def test_ohne_endung_zaehlt_der_gemeldete_typ(self):
        assert vorgang.mime_aus("scan", "application/pdf") == "application/pdf"

    def test_unerwuenschtes_faellt_durch(self):
        """Sonst antwortet erst der Speicher mit 415, und das sah nach einem
        Serverproblem aus statt nach einer falschen Datei."""
        assert vorgang.mime_aus("schad.exe", "application/octet-stream") is None
        assert vorgang.mime_aus("ohne", None) is None


class TestFeldliste:
    def test_zwei_pflichtfelder_je_zeile(self):
        """Wann es stattfand und wer es abgezeichnet hat — das ist der Nachweis.
        Dazu das Feld für den Schulungsbedarf-Abschluss (ja/nein)."""
        layout: dict = {}
        baue_xlsx("Dana Neu", "CNC", date(2026, 9, 5), INHALTE,
                  doc_uid="ABC123", layout_raus=layout)
        keys = [f["key"] for f in layout["felder"]]
        zeilenfelder = [k for k in keys if k.startswith(("wann_", "erledigt_"))]
        assert len(zeilenfelder) == 2 * len(INHALTE)
        assert "schulungsbedarf" in keys
        assert layout["qr"]["doc_uid"] == "ABC123"
        assert len(layout["marken"]) == 2

    def test_ohne_kennung_keine_feldliste(self):
        """Der gewöhnliche Ausdruck bleibt, was er war."""
        layout: dict = {}
        baue_xlsx("Dana Neu", "CNC", date(2026, 9, 5), INHALTE, layout_raus=layout)
        assert layout["qr"]["doc_uid"] == ""

    def test_rechtecke_liegen_innerhalb_der_seite(self):
        layout: dict = {}
        baue_xlsx("Dana Neu", "CNC", date(2026, 9, 5), INHALTE,
                  doc_uid="ABC123", layout_raus=layout)
        for feld in layout["felder"]:
            x0, y0, x1, y1 = feld["box"]
            assert 0 <= x0 < x1 <= 1, feld["key"]
            assert 0 <= y0 < y1 <= 1, feld["key"]

    def test_jede_zeile_hat_eine_hoehe(self):
        """Ohne das driftet die Rechnung nach unten weg — nachgemessen."""
        from io import BytesIO

        from openpyxl import load_workbook

        layout: dict = {}
        daten = baue_xlsx("Dana Neu", "CNC", date(2026, 9, 5), INHALTE,
                          doc_uid="ABC123", layout_raus=layout)
        blatt = load_workbook(BytesIO(daten)).active
        letzte = max(int(k) for k in blatt.row_dimensions)
        for zeile in range(1, letzte + 1):
            assert blatt.row_dimensions[zeile].height is not None, zeile


class TestNeuBewerten:
    """Ein Feld zählt als erledigt, wenn es erkannt, bestätigt **oder** als nicht
    erforderlich markiert ist. Daraus ergeben sich fehlend und vollständig neu —
    das trägt die Pro-Feld-Bestätigung und das „nicht erforderlich"."""

    @staticmethod
    def _erg(felder):
        return {"qr_ok": True, "doc_uid": "X", "felder": felder, "vollstaendig": False, "fehlend": []}

    def test_erkannt_zaehlt_als_erledigt(self):
        e = self._erg([{"key": "a", "label": "A", "erkannt": True}])
        assert pruefung.neu_bewerten(e)["vollstaendig"] is True
        assert pruefung.neu_bewerten(e)["fehlend"] == []

    def test_bestaetigt_und_nicht_erforderlich_zaehlen_auch(self):
        e = pruefung.neu_bewerten(self._erg([
            {"key": "a", "label": "A", "erkannt": False, "bestaetigt": True},
            {"key": "b", "label": "B", "erkannt": False, "nicht_erforderlich": True},
        ]))
        assert e["vollstaendig"] is True
        assert e["fehlend"] == []

    def test_offenes_feld_bleibt_fehlend(self):
        e = pruefung.neu_bewerten(self._erg([
            {"key": "a", "label": "A", "erkannt": True},
            {"key": "b", "label": "B", "erkannt": False},
        ]))
        assert e["vollstaendig"] is False
        assert e["fehlend"] == ["B"]

    def test_ohne_felder_nicht_vollstaendig(self):
        assert pruefung.neu_bewerten(self._erg([]))["vollstaendig"] is False


def _beschreiben(blanko, layout, felder):
    """Handschrift nachstellen: ein Strich in die genannten Felder."""
    bild = blanko.copy()
    matrix, _ = pruefung._ausrichten(blanko, layout)
    seite = layout["seite"]
    stift = ImageDraw.Draw(bild)
    for feld in felder:
        x0, y0, x1, y1 = pruefung._feld_box(
            matrix, feld["box"], seite["w_pt"], seite["h_pt"]
        )
        breite, hoehe = x1 - x0, y1 - y0
        stift.line(
            [x0 + breite * 0.2, y0 + hoehe * 0.4, x1 - breite * 0.2, y0 + hoehe * 0.45],
            fill=(0, 0, 0), width=8,
        )
    return bild


class TestDurchDieGanzeKette:
    """Braucht LibreOffice und zbar — läuft im Abbild, nicht ohne."""

    @pytest.fixture(scope="class")
    async def gerendert(self):
        layout: dict = {}
        pdf = await baue_pdf(
            "Dana Neu", "CNC Fräser", date(2026, 9, 5), INHALTE,
            doc_uid="PRUEFUNG42", layout_raus=layout,
        )
        return await pruefung.rastern(pdf, ist_pdf=True), layout

    @pytest.mark.asyncio
    async def test_der_qr_ist_wieder_lesbar(self, gerendert):
        bild, _ = gerendert
        treffer = pruefung.qr_lesen(bild)
        assert treffer is not None
        assert treffer.doc_uid == "PRUEFUNG42"

    @pytest.mark.asyncio
    async def test_beide_passermarken_werden_gefunden(self, gerendert):
        """Ohne sie fällt die Ausrichtung auf den QR allein zurück — und der
        kann eine ungleichmäßige Stauchung nicht auffangen."""
        import numpy as np

        bild, _ = gerendert
        marken = pruefung.marken_im_streifen(np.asarray(bild.convert("L")))
        assert len(marken) == 2

    @pytest.mark.asyncio
    async def test_das_leere_blatt_gilt_als_nicht_ausgefuellt(self, gerendert):
        bild, layout = gerendert
        ergebnis = pruefung.felder_pruefen(bild, layout, bild)
        assert ergebnis["qr_ok"] is True
        assert not any(f["erkannt"] for f in ergebnis["felder"])
        assert ergebnis["vollstaendig"] is False

    @pytest.mark.asyncio
    async def test_ein_ausgefuelltes_blatt_gilt_als_vollstaendig(self, gerendert):
        bild, layout = gerendert
        beschrieben = _beschreiben(bild, layout, layout["felder"])
        ergebnis = pruefung.felder_pruefen(beschrieben, layout, bild)
        assert all(f["erkannt"] for f in ergebnis["felder"])
        assert ergebnis["vollstaendig"] is True

    @pytest.mark.asyncio
    async def test_halb_ausgefuellt_nennt_das_fehlende(self, gerendert):
        bild, layout = gerendert
        haelfte = layout["felder"][::2]
        beschrieben = _beschreiben(bild, layout, haelfte)
        ergebnis = pruefung.felder_pruefen(beschrieben, layout, bild)
        assert sum(1 for f in ergebnis["felder"] if f["erkannt"]) == len(haelfte)
        assert len(ergebnis["fehlend"]) == len(layout["felder"]) - len(haelfte)
        assert ergebnis["vollstaendig"] is False


class TestGeometrie:
    def test_spalten_wachsen_nach_rechts(self):
        geo = qr.Geometrie(spaltenbreiten=(3, 13, 17))
        assert qr.x_norm(geo, 1) < qr.x_norm(geo, 2) < qr.x_norm(geo, 3)

    def test_der_linke_rand_zaehlt_mit(self):
        eng = qr.Geometrie(spaltenbreiten=(10,), rand_links_px=0.0)
        weit = qr.Geometrie(spaltenbreiten=(10,), rand_links_px=48.0)
        assert qr.x_norm(weit, 1) > qr.x_norm(eng, 1)
