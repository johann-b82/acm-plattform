"""Abbildungen der Datenübernahme aus lumeapps.

Der ganze Lauf wurde gegen eine echte Alt-Datenbank gefahren; hier stehen die
beiden Abbildungen, die sich still verschieben können, wenn jemand am
Altprojekt oder am neuen Schema dreht.
"""
from datetime import datetime, timezone

from app.uebernahme.vertrieb import KIND_ABBILDUNG, aufbereiten


def batch(**ueberschreiben) -> dict:
    grund = {
        "id": 7,
        "filename": "AswKpf_RG.txt",
        "uploaded_at": datetime(2026, 1, 15, tzinfo=timezone.utc),
        "kind": "revenues",
        "row_count": 3,
        "error_count": 0,
        "status": "success",
    }
    grund.update(ueberschreiben)
    return grund


class TestSorte:
    def test_revenues_heisst_jetzt_umsatz(self):
        (zeile,), uebersprungen = aufbereiten([batch(kind="revenues")])
        assert zeile["kind"] == "umsatz"
        assert uebersprungen == []

    def test_auftraege_bleibt(self):
        (zeile,), _ = aufbereiten([batch(kind="auftraege")])
        assert zeile["kind"] == "auftraege"

    def test_sorten_ohne_zuhause_werden_gemeldet_nicht_uebernommen(self):
        """Kontakte, Qualität, Material … kommen mit ihrem Modul, nicht jetzt."""
        zeilen, uebersprungen = aufbereiten(
            [batch(kind="contacts"), batch(kind="quality"), batch(kind="revenues")]
        )
        assert len(zeilen) == 1
        assert sorted(uebersprungen) == ["contacts", "quality"]

    def test_abbildung_deckt_genau_die_beiden_portierten_sorten_ab(self):
        assert set(KIND_ABBILDUNG) == {"revenues", "auftraege"}


class TestStatus:
    def test_bekannte_status_bleiben(self):
        for status in ("success", "partial", "failed"):
            (zeile,), _ = aufbereiten([batch(status=status)])
            assert zeile["status"] == status

    def test_unbekannter_status_wird_failed(self):
        """Die alte Tabelle hatte keine Beschraenkung — lieber deutlich als still."""
        (zeile,), _ = aufbereiten([batch(status="irgendwas")])
        assert zeile["status"] == "failed"


class TestUebernommeneFelder:
    def test_alte_id_wird_nur_zur_zuordnung_mitgefuehrt(self):
        (zeile,), _ = aufbereiten([batch(id=42)])
        assert zeile["alt_id"] == 42
        # Nicht "id": die neue Tabelle vergibt ihre Schluessel selbst.
        assert "id" not in zeile

    def test_hochgeladen_von_bleibt_leer(self):
        """Die alte Tabelle weiss nicht, wer hochgeladen hat."""
        (zeile,), _ = aufbereiten([batch()])
        assert zeile["uploaded_by"] is None
