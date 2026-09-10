"""Reine Parser-Tests für die drei Exporte der Vertriebsaktivität.

Keine Datenbank. Die Beispieldateien bilden die Eigenheiten nach, die im
Altprojekt Fehler verursacht haben: zwei Kopfzeilen-Varianten, `="…"`-
Einfassungen, eine doppelte `Typ`-Spalte, eine Titelzeile vor der Kopfzeile
und deutsche Zahlen.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from app.parsing.aktivitaet import parse_angebote, parse_interessenten, parse_kontakte

# Die jüngere Kopfzeile: `Typ` steht zweimal drin — vorne die Kontaktart,
# hinten die ERP-Verknüpfung.
KOPF_NEU = (
    "Datum\tZeit\tW-Vorlage\tAnsprechpartner\tArt\tTyp\tSt\tMitarbeiter"
    "\tName 1\tOrt\tErf. Datum\tErf. Benutzer\tTextfeld\tTyp\tVorgang Nr.\tWert"
)
KOPF_ALT = "Datum\tWer\tTyp\tGruppe\tSta\tName\tKommentar\tVrgID"


def datei(kopf: str, *zeilen: str, kodierung: str = "utf-8") -> bytes:
    return ("\n".join([kopf, *zeilen]) + "\n").encode(kodierung)


def _neu(datum: str, typ: str, st: str, wer: str, name: str = "Kunde AG") -> str:
    return (
        f"{datum}\t09:30\t\t\tBesuch\t{typ}\t{st}\t{wer}"
        f"\t{name}\tBerlin\t{datum}\tADMIN\tNotiz\tANG\t4711\t0"
    )


# --- Kontakte ----------------------------------------------------------------


def test_kontakte_jüngere_kopfzeile():
    rows, fehler = parse_kontakte(datei(KOPF_NEU, _neu("03.09.2026", "ERS", "1", "mm")))
    assert fehler == []
    assert len(rows) == 1
    r = rows[0]
    assert r["contact_date"] == date(2026, 9, 3)
    assert r["employee_token"] == "MM"          # großgeschrieben
    assert r["contact_type"] == "ERS"           # die ERSTE Typ-Spalte
    assert r["status"] == 1
    assert r["customer_name"] == "Kunde AG"
    assert r["comment"] == "Notiz"
    assert r["external_id"] == "4711"


def test_kontakte_aeltere_kopfzeile():
    zeile = "03.09.2026\tmm\tORT\tA\t1\tKunde AG\tNotiz\t4711"
    rows, fehler = parse_kontakte(datei(KOPF_ALT, zeile))
    assert fehler == []
    assert rows[0]["employee_token"] == "MM"
    assert rows[0]["contact_type"] == "ORT"
    assert rows[0]["customer_group"] == "A"
    assert rows[0]["comment"] == "Notiz"


def test_kontakte_zweite_typ_spalte_landet_nicht_in_der_kontaktart():
    """Die zweite `Typ`-Spalte trägt ANG/RG. Verwechselt man sie, zählt kein
    einziger Erstkontakt mehr."""
    rows, _ = parse_kontakte(datei(KOPF_NEU, _neu("03.09.2026", "ERS", "1", "mm")))
    assert rows[0]["contact_type"] == "ERS"
    assert rows[0]["raw"].get("Typ.1") == "ANG"


def test_kontakte_einfassung_wird_entfernt():
    zeile = '="03.09.2026"\t="mm"\t="ONL"\t=""\t="1"\t="Kunde AG"\t=""\t="4711"'
    rows, fehler = parse_kontakte(datei(KOPF_ALT, zeile))
    assert fehler == []
    assert rows[0]["contact_date"] == date(2026, 9, 3)
    assert rows[0]["contact_type"] == "ONL"
    assert rows[0]["external_id"] == "4711"


def test_kontakte_ohne_mitarbeiter_ist_ein_fehler():
    rows, fehler = parse_kontakte(datei(KOPF_NEU, _neu("03.09.2026", "ERS", "1", "")))
    assert rows == []
    assert len(fehler) == 1
    assert fehler[0]["row"] == 2


def test_kontakte_unbekannter_status_wird_null():
    rows, _ = parse_kontakte(datei(KOPF_NEU, _neu("03.09.2026", "ERS", "9", "mm")))
    assert rows[0]["status"] == 0


def test_kontakte_latin1_umlaute():
    zeile = "03.09.2026\tmm\tERS\tA\t1\tMüller GmbH\tGespräch\t1"
    rows, fehler = parse_kontakte(datei(KOPF_ALT, zeile, kodierung="latin-1"))
    assert fehler == []
    assert rows[0]["customer_name"] == "Müller GmbH"


# --- Angebote ----------------------------------------------------------------


KOPF_ANG = "Typ\tVorgang Nr.\tDatum\tAdr Nr.\tName 1\tOrt\tErfasst durch\tWert"


def test_angebote_deutsche_zahl():
    rows, fehler = parse_angebote(
        datei(KOPF_ANG, "ANG\t9001\t03.09.2026\t100\tKunde AG\tBerlin\tMM\t322611,16")
    )
    assert fehler == []
    assert rows[0]["wert_eur"] == Decimal("322611.16")
    assert rows[0]["erfasser"] == "MM"
    assert rows[0]["datum"] == date(2026, 9, 3)


def test_angebote_doppelte_vorgangsnummer_letzte_gewinnt():
    rows, _ = parse_angebote(
        datei(
            KOPF_ANG,
            "ANG\t9001\t03.09.2026\t100\tKunde AG\tBerlin\tMM\t1000",
            "ANG\t9001\t04.09.2026\t100\tKunde AG\tBerlin\tMM\t2000",
        )
    )
    assert len(rows) == 1
    assert rows[0]["wert_eur"] == Decimal("2000")
    assert rows[0]["datum"] == date(2026, 9, 4)


def test_angebote_fehlende_pflichtspalte():
    rows, fehler = parse_angebote(datei("Typ\tDatum\tWert", "ANG\t03.09.2026\t100"))
    assert rows == []
    assert "Vorgang Nr." in fehler[0]["message"]


def test_angebote_unlesbarer_wert_ist_ein_fehler():
    rows, fehler = parse_angebote(
        datei(KOPF_ANG, "ANG\t9001\t03.09.2026\t100\tKunde AG\tBerlin\tMM\tkeine Zahl")
    )
    assert rows == []
    assert fehler[0]["field"] == "Wert"


# --- Interessenten -----------------------------------------------------------


TITEL_INT = "Adressen\tInteressenten"
KOPF_INT = "Adress-Nr.\tAnrede Brief\tSuchbegriff\tName 1\tDatum Save"


def test_interessenten_titelzeile_wird_uebersprungen():
    rows, fehler = parse_interessenten(
        datei(TITEL_INT, KOPF_INT, "100\tHerr\tKUNDE\tKunde AG\t03.09.2026")
    )
    assert fehler == []
    assert rows[0]["adress_nr"] == "100"
    assert rows[0]["customer_name"] == "Kunde AG"
    assert rows[0]["datum_save"] == date(2026, 9, 3)


def test_interessenten_ohne_titelzeile():
    rows, fehler = parse_interessenten(datei(KOPF_INT, "100\tHerr\tKUNDE\tKunde AG\t03.09.2026"))
    assert fehler == []
    assert len(rows) == 1


def test_interessenten_ohne_datum_bleibt_erhalten():
    """Eine Momentaufnahme der Stammdaten — das Datum kann später nachkommen."""
    rows, fehler = parse_interessenten(datei(TITEL_INT, KOPF_INT, "100\tHerr\tKUNDE\tKunde AG\t"))
    assert fehler == []
    assert rows[0]["datum_save"] is None


def test_interessenten_doppelte_adressnummer_letzte_gewinnt():
    rows, _ = parse_interessenten(
        datei(
            TITEL_INT,
            KOPF_INT,
            "100\tHerr\tKUNDE\tAlt\t01.09.2026",
            "100\tHerr\tKUNDE\tNeu\t03.09.2026",
        )
    )
    assert len(rows) == 1
    assert rows[0]["customer_name"] == "Neu"
    assert rows[0]["datum_save"] == date(2026, 9, 3)
