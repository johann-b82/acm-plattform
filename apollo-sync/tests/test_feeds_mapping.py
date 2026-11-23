"""Column rules of the feeds, each traced against the Apollo lists of October 2026
(KPIs/2026/Rohdaten/Oktober_26, see docs/FEEDS.md). Small hand-made records, one rule per test.
At the end every file is read back with the platform parsers (services/compute)."""
from __future__ import annotations

import datetime as dt
import io
import sys
from pathlib import Path

import pytest

from apollo_sync.feeds import Feeds, arbeitstage, tab_datei

D = dt.date
HEUTE = D(2026, 11, 23)
VON = D(2025, 1, 1)


class Src:
    """rows(table, columns) over lists of dicts; a missing column is None (like a default)."""

    def __init__(self, **tables):
        self.t = tables

    def rows(self, table, columns):
        return [tuple(r.get(c) for c in columns) for r in self.t.get(table, [])]


NVS = [  # key table: German = language 2; Mandant-specific rows win over Mandant 0
    dict(nvs_id=335014, nvs_typ=250, nvs_sprache=2, nvs_nr=1, nvs_kenn="STD", nvs_mandant=0),
    dict(nvs_id=335014, nvs_typ=250, nvs_sprache=1, nvs_nr=1, nvs_kenn="XX", nvs_mandant=0),
    dict(nvs_id=241327, nvs_typ=7, nvs_sprache=2, nvs_nr=0, nvs_kenn="EUR", nvs_mandant=0),
    dict(nvs_id=241339, nvs_typ=7, nvs_sprache=2, nvs_nr=11, nvs_kenn="DOLLAR", nvs_mandant=0),
    dict(nvs_id=241340, nvs_typ=7, nvs_sprache=2, nvs_nr=11, nvs_kenn="USD", nvs_mandant=1),
    dict(nvs_id=335067, nvs_typ=13, nvs_sprache=2, nvs_nr=1, nvs_kenn="STK", nvs_mandant=0),
    dict(nvs_id=337201, nvs_typ=13, nvs_sprache=2, nvs_nr=35, nvs_kenn="LFM", nvs_mandant=0),
    dict(nvs_id=338037, nvs_typ=14, nvs_sprache=2, nvs_nr=338037, nvs_kenn="DIENST", nvs_mandant=0),
    dict(nvs_id=340521, nvs_typ=69, nvs_sprache=2, nvs_nr=340521, nvs_kenn="ERS", nvs_mandant=0),
]
ADR = [dict(adr_id=5918, adr_nr=20352, adr_name1="Kunde AG", adr_name2="Einkauf", adr_name3="",
            adr_ort="Wessling", adr_plz="82234", adr_typ=1, adr_mandant=1),
       dict(adr_id=7, adr_nr=81105, adr_name1="Lieferant GmbH", adr_ort="Hechingen", adr_plz="72469",
            adr_typ=2, adr_mandant=1)]
STM = [dict(stm_id=1, stm_artnr="L 2124", stm_bez1="Cotton knit", stm_bez2="No. 40", stm_konto_ek=5400,
            stm_mandant=1),
       dict(stm_id=2, stm_artnr="L 3604", stm_bez1="gesperrt", stm_konto_ek=5400, stm_mandant=1,
            stm_sperr_date=D(2021, 4, 14))]


def _lines(datei: bytes) -> list[list[str]]:
    return [z.split("\t") for z in datei.decode("cp1252").split("\r\n") if z]


def _row(datei: bytes, n: int = 1) -> dict[str, str]:
    lines = _lines(datei)
    return dict(zip(lines[0], lines[n]))


# ------------------------------------------------------------------ document headers
def test_kopf_names_users_codes_and_position_count():
    kpf = [dict(kpf_id=10, kpf_typ=1, kpf_nr=1025387, kpf_datum=D(2026, 10, 5), kpf_adr_id=5918,
                kpf_user_save="RATAN", kpf_user_edit="ZETTLER", kpf_art=1, kpf_art2=0, kpf_rabatt_aktion=0,
                kpf_waehrung=11, kpf_wert=6100.0, kpf_wert_f=6447.7, kpf_mandant=1),
           dict(kpf_id=11, kpf_typ=7, kpf_nr=3033999, kpf_datum=D(2026, 10, 6), kpf_adr_id=5918,
                kpf_waehrung=0, kpf_wert=-50.0, kpf_mandant=1)]
    pos = [dict(pos_id=i, pos_kpf_id=10, pos_typ=1, pos_pos=p, pos_unterpos=u, pos_datum=D(2026, 10, 5))
           for i, (p, u) in enumerate([(1, 0), (2, 0), (2, 1)], 1)]
    f = Feeds(Src(kpf_std=kpf, pos_std=pos, adr_std=ADR, nvs_std=NVS), heute=HEUTE)
    r = _row(f.auftraege(VON)[1])
    assert r == {"Typ": "AUF", "Vorgang Nr.": "1025387", "Datum": "05.10.2026", "Adr Nr.": "20352",
                 "Name 1": "Kunde AG", "Name 2": "Einkauf", "Name 3": "", "Ort": "Wessling",
                 "Erfasst durch": "RATAN", "Geändert durch": "ZETTLER", "Anz Pos": "3", "AA": "STD",
                 "Typ 2": "", "Rab Aktion": "", "Wert": "6100", "eigene Währung": "EUR",
                 "Ges.Wert FW": "6447,7", "WAHR": "USD"}
    gs = _row(f.umsatz(VON)[1])
    assert (gs["Typ"], gs["Wert"], gs["WAHR"], gs["Anz Pos"]) == ("GS", "-50", "EUR", "0")


# ------------------------------------------------------------------ positions
def _pos_feeds(**extra):
    kpf = [dict(kpf_id=10, kpf_typ=1, kpf_nr=1025403, kpf_datum=D(2026, 10, 1), kpf_adr_id=5918, kpf_mandant=1,
                kpf_wert=2640.05),
           dict(kpf_id=20, kpf_typ=5, kpf_nr=20190627, kpf_datum=D(2026, 10, 20), kpf_adr_id=5918, kpf_mandant=1,
                kpf_sperre=False, kpf_sperrkz=0),
           dict(kpf_id=30, kpf_typ=3, kpf_nr=4018052, kpf_datum=D(2026, 8, 20), kpf_adr_id=7, kpf_mandant=1),
           dict(kpf_id=40, kpf_typ=8, kpf_nr=36492, kpf_datum=D(2026, 9, 1), kpf_adr_id=7, kpf_mandant=1,
                kpf_waehrung=0)]
    pos = [
        dict(pos_id=1, pos_kpf_id=10, pos_typ=1, pos_pos=2, pos_unterpos=0, pos_datum=D(2026, 10, 1),
             pos_lief_datum=D(2026, 6, 19), pos_artnr="7317", pos_bez1="Curtain Bunk", pos_menge=1.0, pos_einh=1,
             pos_status=0, pos_preis=1107.15, pos_wert=1047.45, pos_typ2=337650, pos_artnr_kd="MLA03-01",
             pos_menge_rest=1.0, pos_stm_id=1),
        dict(pos_id=2, pos_kpf_id=10, pos_typ=1, pos_pos=2, pos_unterpos=4, pos_datum=D(2026, 10, 1),
             pos_artnr="7318", pos_menge=2.0, pos_einh=35, pos_stm_id=1),
        dict(pos_id=3, pos_kpf_id=20, pos_typ=5, pos_pos=39, pos_unterpos=0, pos_datum=D(2026, 10, 20),
             pos_lief_datum=D(2026, 10, 20), pos_artnr="11389", pos_menge=1.0, pos_einh=1, pos_stm_id=1,
             pos_vater_kpf_id=10, pos_vater_pos_id=1),
        dict(pos_id=4, pos_kpf_id=20, pos_typ=5, pos_pos=40, pos_datum=D(2026, 10, 20),
             pos_lief_datum=D(2026, 10, 20), pos_stm_id=2),                       # block date older: listed
        dict(pos_id=5, pos_kpf_id=30, pos_typ=3, pos_pos=1, pos_datum=D(2026, 8, 20),
             pos_lief_datum=D(2026, 8, 28), pos_stm_id=1),
        dict(pos_id=6, pos_kpf_id=40, pos_typ=8, pos_pos=1, pos_unterpos=0, pos_datum=D(2026, 9, 1),
             pos_lief_datum=D(2026, 9, 1), pos_artnr="L 2124", pos_bez1="Hakenband", pos_menge=500.0, pos_einh=35,
             pos_wert=705.0, pos_wgr=338037, pos_stm_id=1, pos_vater_kpf_id=30, pos_vater_pos_id=5),
        dict(pos_id=7, pos_kpf_id=40, pos_typ=8, pos_pos=2, pos_datum=D(2026, 9, 1), pos_stm_id=2),  # blocked
        dict(pos_id=8, pos_kpf_id=40, pos_typ=8, pos_pos=3, pos_datum=D(2026, 9, 1), pos_stm_id=1,
             pos_artnr="X"),                                                      # no order
    ]
    return Feeds(Src(kpf_std=kpf, pos_std=pos, adr_std=ADR, nvs_std=NVS, stm_std=STM, **extra), heute=HEUTE)


def test_order_lines_keep_subpositions_and_decode_codes():
    lines = _lines(_pos_feeds().auftragspositionen(VON)[1])
    rows = [dict(zip(lines[0], z)) for z in lines[1:]]
    assert [(r["Pos"], r["UPos"]) for r in rows] == [("2", "0"), ("2", "4")]   # no duplicate key
    r = rows[0]
    assert (r["Adr Nr."], r["Name 1"], r["Ort"], r["Bezeichnung 1"], r["ME"], r["St"], r["Lieferdatum"],
            r["Pos Wert"], r["Pos Typ 2"], r["Fremdnr"], r["Sperre manuell"], r["Restmenge"]) == (
        "20352", "Kunde AG", "Wessling", "Curtain Bunk", "STK", "0", "19.06.2026", "1047,45", "AB",
        "MLA03-01", "N", "1")
    assert rows[1]["ME"] == "LFM"


def test_delivery_note_lines_link_order_and_hide_blocked_by_date():
    openpyxl = pytest.importorskip("openpyxl")
    name, data = _pos_feeds().lieferscheine(VON)
    ws = openpyxl.load_workbook(io.BytesIO(data)).active
    rows = [[c.value for c in r] for r in ws.iter_rows()]
    assert rows[0][-2:] == ["Auftrag", "Pos"]
    assert [r[2] for r in rows[1:]] == ["39", "40"]            # block date before delivery: listed
    assert rows[1][-2:] == ["1025403", "2"]


def test_goods_receipt_lines_order_wgr_account_and_block():
    lines = _lines(_pos_feeds().wareneingaenge(VON)[1])
    rows = [dict(zip(lines[0], z)) for z in lines[1:]]
    assert [r["Pos"] for r in rows] == ["1", "3"]               # article with a block date hidden
    assert lines[0].count("Datum") == 2                         # Datum, then the order date (Datum.1)
    r = rows[0]
    assert (r["Adr Nr."], r["Name 1"], r["Bestellung"], r["WGR"], r["EK Konto"], r["ME"]) == (
        "81105", "Lieferant GmbH", "4018052", "DIENST", "5400", "LFM")
    assert lines[1][lines[0].index("WGR") - 1] == "20.08.2026"   # order date
    assert rows[1]["Bestellung"] == "0"


def test_purchasing_reliability_rules():
    f = _pos_feeds()
    lines = _lines(f.liefertreue(VON)[1])
    rows = [dict(zip(lines[0], z)) for z in lines[1:]]
    assert [(r["LS-Nr"], r["LS-Pos"]) for r in rows] == [("36492", "1"), ("36492", "3")]
    r = rows[0]
    assert (r["Auftrag"], r["Pos"], r["Kunde"], r["Kundennummer"], r["PLZ"], r["Lieferdatum"], r["geliefert"],
            r["Verzug (Tage)"], r["ME"], r["Währung"]) == (
        "4018052", "1", "Lieferant GmbH", "81105", "72469", "28.08.2026", "01.09.2026", "2", "LFM", "EUR")
    assert (rows[1]["Auftrag"], rows[1]["Pos"], rows[1]["Verzug (Tage)"], rows[1]["Lieferdatum"]) == ("0", "0", "0", "")


def test_purchasing_reliability_requested_date_wins_and_window_is_current_year():
    f = _pos_feeds()
    f.src.t["pos_std"][4]["pos_lief_wunsch"] = D(2026, 8, 25)
    f.src.t["kpf_std"].append(dict(kpf_id=41, kpf_typ=8, kpf_nr=36116, kpf_datum=D(2025, 11, 11), kpf_adr_id=7,
                                   kpf_mandant=1))
    f.src.t["pos_std"].append(dict(pos_id=9, pos_kpf_id=41, pos_typ=8, pos_pos=1, pos_datum=D(2025, 11, 11),
                                   pos_stm_id=1, pos_vater_kpf_id=30, pos_vater_pos_id=5))
    rows = _lines(f.liefertreue(VON)[1])[1:]
    assert [z[4] for z in rows] == ["36492", "36492"]           # the 2025 receipt is outside the window
    assert rows[0][7:11] == ["25.08.2026", "25.08.2026", "01.09.2026", "5"]


def test_working_days():
    assert arbeitstage(D(2025, 10, 30), D(2026, 1, 5)) == 47      # from the October 2026 list
    assert arbeitstage(D(2026, 9, 4), D(2026, 9, 4)) == 0
    assert arbeitstage(D(2026, 9, 7), D(2026, 9, 4)) == -1        # early delivery counts negative
    assert arbeitstage(None, D(2026, 9, 4)) is None


# ------------------------------------------------------------------ 8D, contacts, prospects
def test_8d_columns():
    rek = [dict(rek_nr=954, rek_datum=D(2025, 1, 20), rek_art="KUN RE", rek_stm_id=1, rek_adr_id=5918,
                rek_kpf_id=20, rek_status=4, rek_menge=1.0, rek_menge_akz=0.0, rek_geloescht=False,
                rek_mandant=1, rek_aussteller="KOHLER", rek_accept=True, rek_abgelehnt=False,
                rek_Problembeschreib="Zeile 1\r\nZeile 2", rek_kz_a01="M1")]
    kpf = [dict(kpf_id=20, kpf_typ=5, kpf_nr=20183401, kpf_mandant=1)]
    f = Feeds(Src(rek_std=rek, kpf_std=kpf, adr_std=ADR, stm_std=STM), heute=HEUTE)
    r = _row(f.acht_d(VON)[1])
    assert (r["Aussteller"], r["Adress Nr."], r["Adressen"], r["Artikel"], r["Bezeichnung"], r["Menge"],
            r["akzeptierte Menge"], r["Vorgang"], r["Status"], r["akzeptiert"], r["abgelehnt"], r["gelöscht"],
            r["Problembeschreibung"], r["Merkmal 1"]) == (
        "KOHLER", "20352", "Kunde AG", "L 2124", "Cotton knit No. 40", "1", "", "20183401",
        "isignal_flag_green", "J", "N", "N", "Zeile 1  Zeile 2", "M1")


def test_contacts_type_memo_and_erp_link():
    vrg = [dict(vrg_datum=D(2026, 1, 2), vrg_zeit="09:36:10.00", vrg_typ=340521, vrg_status=1,
                vrg_mitarbeiter="schmidt", vrg_adr_id=5918, vrg_memo="DA40 Gurte\trewebbing",
                vrg_kpf_typ=3, vrg_kpf_nr=4017418, vrg_mandant=1)]
    f = Feeds(Src(vrg_std=vrg, adr_std=ADR, nvs_std=NVS), heute=HEUTE)
    z = _lines(f.kontakte(VON)[1])[1]
    assert (z[5], z[6], z[7], z[8], z[12], z[13], z[14]) == (
        "ERS", "1", "SCHMIDT", "Kunde AG", "DA40 Gurte rewebbing", "BES", "4017418")


def test_prospects_without_deleted_and_other_mandant():
    adr = [dict(adr_nr=20001, adr_name1="A", adr_typ=8, adr_mandant=1),
           dict(adr_nr=20002, adr_name1="B", adr_typ=8, adr_mandant=1, adr_geloescht=True),
           dict(adr_nr=20003, adr_name1="C", adr_typ=8, adr_mandant=2),
           dict(adr_nr=10005, adr_name1="Kunde", adr_typ=1, adr_mandant=1)]
    rows = _lines(Feeds(Src(adr_std=adr), heute=HEUTE).interessenten(VON)[1])
    assert [z[0] for z in rows[1:]] == ["20001"]


# ------------------------------------------------------------------ file format
def test_cells_keep_columns_and_texts():
    data = tab_datei(["a", "b", "c"], [["Mirus\tseating", '"Die in Personio"', 'x "y" z']])
    z = data.decode("cp1252").split("\r\n")[1].split("\t")
    assert len(z) == 3 and z[0] == "Mirus seating"
    pd = pytest.importorskip("pandas")
    df = pd.read_csv(io.BytesIO(data), sep="\t", dtype=str, keep_default_na=False, encoding="cp1252")
    assert list(df.iloc[0]) == ["Mirus seating", '"Die in Personio"', 'x "y" z']


PLATFORM = Path(__file__).resolve().parents[2] / "services" / "compute"


def test_platform_parsers_read_every_file():
    pytest.importorskip("pandas")
    pytest.importorskip("openpyxl")
    if not PLATFORM.exists():
        pytest.skip("services/compute not checked out")
    sys.path.insert(0, str(PLATFORM))
    try:
        from app.parsing import aktivitaet, einkauf, material, materialpreise, positionen, qualitaet, vertrieb
    except ImportError as exc:                     # platform dependencies not installed here
        pytest.skip(f"platform parsers not importable: {exc}")
    f = _pos_feeds(rek_std=[dict(rek_nr=1, rek_datum=D(2026, 10, 1), rek_mandant=1, rek_stm_id=1)])
    f.src.t["kpf_std"].append(dict(kpf_id=50, kpf_typ=6, kpf_nr=3033597, kpf_datum=D(2026, 9, 2),
                                   kpf_adr_id=5918, kpf_wert=926.5, kpf_mandant=1))
    checks = {
        "umsatz": vertrieb.parse_umsatz, "auftraege": vertrieb.parse_auftraege,
        "auftragspositionen": positionen.parse_auftrag_positionen, "lieferscheine": positionen.parse_lieferscheine,
        "wareneingaenge": positionen.parse_wareneingaenge, "materialpreise": materialpreise.parse_materialpreise,
        "acht_d": qualitaet.parse_8d, "liefertreue": einkauf.parse_liefertreue,
    }
    for art, parse in checks.items():
        rows, fehler = parse(f.builders()[art](VON)[1])
        assert rows and not fehler, (art, fehler)
    ws = positionen.parse_wareneingaenge(f.wareneingaenge(VON)[1])[0]
    assert {(r["order_nr"], r["material_group"]) for r in ws} >= {("4018052", "DIENST")}
    ls = positionen.parse_lieferscheine(f.lieferscheine(VON)[1])[0]
    assert {r["order_nr"] for r in ls} == {"1025403", None} and all(r["delivery_date"] for r in ls)
    for parse, data in ((material.parse_lagerbewegungen, f.lagerbewegungen(VON)[1]),
                        (aktivitaet.parse_kontakte, f.kontakte(VON)[1]),
                        (aktivitaet.parse_interessenten, f.interessenten(VON)[1])):
        assert parse(data)[1] == [] or parse(data)[0] == []
