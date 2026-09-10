"""Parser des Liefertreue-Exports — reine Funktionen, keine Datenbank."""
from datetime import date
from decimal import Decimal

from app.parsing.einkauf import lies_zeitraum, parse_liefertreue

KOPF = "Auftrag\tPos\tUPos\tKundennummer\tKunde\tgeliefert\tLieferdatum\tVerzug (Tage)\tMenge\tME\tArtikel\tBezeichnung"
TITEL = "Auswertung: Liefertreue (von 01.01.2026 bis 30.04.2026)"


def datei(*zeilen: str, titel: str | None = None, kodierung: str = "utf-8") -> bytes:
    alle = ([titel] if titel else []) + [KOPF, *zeilen]
    return ("\n".join(alle) + "\n").encode(kodierung)


class TestKopfzeile:
    def test_titelzeile_wird_uebersprungen(self):
        rows, fehler = parse_liefertreue(
            datei("A-1\t10\t0\t500\tMüller\t15.01.2026\t10.01.2026\t5\t3\tStk\tX-1\tSchraube", titel=TITEL)
        )
        assert fehler == []
        assert rows[0]["auftrag"] == "A-1"

    def test_ohne_titelzeile(self):
        rows, fehler = parse_liefertreue(
            datei("A-1\t10\t0\t500\tMüller\t15.01.2026\t10.01.2026\t5\t3\tStk\tX-1\tSchraube")
        )
        assert fehler == []
        assert len(rows) == 1

    def test_fehlende_pflichtspalte(self):
        rows, fehler = parse_liefertreue(b"Auftrag\tPos\n" + b"A-1\t10\n")
        assert rows == []
        assert fehler[0]["field"] == "header" and "Verzug" in fehler[0]["message"]


class TestZeitraum:
    def test_wird_gelesen(self):
        assert lies_zeitraum(datei(titel=TITEL)) == (date(2026, 1, 1), date(2026, 4, 30))

    def test_fehlt(self):
        assert lies_zeitraum(datei()) is None


class TestZeilen:
    def test_felder_werden_uebernommen(self):
        (row,), fehler = parse_liefertreue(
            datei("A-1\t10\t2\t500\tMüller GmbH\t15.01.2026\t10.01.2026\t5\t3,5\tStk\tX-1\tSchraube")
        )
        assert fehler == []
        assert row["auftrag"] == "A-1"
        assert (row["pos"], row["upos"]) == (10, 2)
        assert row["supplier_name"] == "Müller GmbH"
        assert row["delivered_date"] == date(2026, 1, 15)
        assert row["target_date"] == date(2026, 1, 10)
        assert row["verzug_tage"] == 5
        assert row["quantity"] == Decimal("3.5")
        assert row["article_name"] == "Schraube"

    def test_iso_zeitstempel_wird_gelesen(self):
        """Der Export mischt deutsches Datum und ISO-Zeitstempel."""
        (row,), _ = parse_liefertreue(
            datei("A-1\t10\t0\t500\tM\t2026-01-15 00:00:00\t2026-01-10\t5\t1\tStk\tX\tY")
        )
        assert row["delivered_date"] == date(2026, 1, 15)
        assert row["target_date"] == date(2026, 1, 10)

    def test_fehlende_unterposition_wird_null(self):
        (row,), _ = parse_liefertreue(datei("A-1\t10\t\t500\tM\t15.01.2026\t10.01.2026\t0\t1\tStk\tX\tY"))
        assert row["upos"] == 0

    def test_negativer_verzug_bleibt_negativ(self):
        """Frühe Lieferung. Das Vorzeichen entscheidet über pünktlich."""
        (row,), _ = parse_liefertreue(datei("A-1\t10\t0\t500\tM\t08.01.2026\t10.01.2026\t-2\t1\tStk\tX\tY"))
        assert row["verzug_tage"] == -2

    def test_leerer_verzug_bleibt_leer(self):
        """Nicht 0: eine Position ohne Verzugswert ist nicht pünktlich."""
        (row,), _ = parse_liefertreue(datei("A-1\t10\t0\t500\tM\t15.01.2026\t10.01.2026\t\t1\tStk\tX\tY"))
        assert row["verzug_tage"] is None

    def test_ganzzahl_mit_nachkomma(self):
        """Der Export schreibt Positionen gelegentlich als 10.0."""
        (row,), _ = parse_liefertreue(datei("A-1\t10.0\t0\t500\tM\t15.01.2026\t10.01.2026\t3\t1\tStk\tX\tY"))
        assert row["pos"] == 10


class TestFehlerzeilen:
    def test_ohne_auftrag(self):
        rows, fehler = parse_liefertreue(datei("\t10\t0\t500\tM\t15.01.2026\t10.01.2026\t3\t1\tStk\tX\tY"))
        assert rows == []
        assert fehler[0]["field"] == "Auftrag"

    def test_ohne_position(self):
        rows, fehler = parse_liefertreue(datei("A-1\t\t0\t500\tM\t15.01.2026\t10.01.2026\t3\t1\tStk\tX\tY"))
        assert rows == []
        assert fehler[0]["field"] == "Pos"

    def test_doppelte_position_ist_ein_fehler(self):
        """Anders als im Vertrieb: dieselbe Position zweimal ist nicht erklärbar."""
        rows, fehler = parse_liefertreue(
            datei(
                "A-1\t10\t0\t500\tM\t15.01.2026\t10.01.2026\t3\t1\tStk\tX\tY",
                "A-1\t10\t0\t500\tM\t16.01.2026\t10.01.2026\t6\t1\tStk\tX\tY",
            )
        )
        assert len(rows) == 1
        assert rows[0]["verzug_tage"] == 3
        assert "doppelt" in fehler[0]["message"]

    def test_leerzeilen_werden_uebersprungen(self):
        rows, fehler = parse_liefertreue(
            datei("A-1\t10\t0\t500\tM\t15.01.2026\t10.01.2026\t3\t1\tStk\tX\tY", "\t\t\t\t\t\t\t\t\t\t\t")
        )
        assert len(rows) == 1 and fehler == []


def test_cp1252_wird_gelesen():
    """Die Exporte kommen von einem Windows-System."""
    (row,), fehler = parse_liefertreue(
        datei("A-1\t10\t0\t500\tMüller & Söhne\t15.01.2026\t10.01.2026\t3\t1\tStk\tX\tY", kodierung="cp1252")
    )
    assert fehler == []
    assert row["supplier_name"] == "Müller & Söhne"
