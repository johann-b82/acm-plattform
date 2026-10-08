"""ODBC-Worker: liest Apollo (CONZEPT 16) und füttert die ACM-Plattform.

Läuft auf einer minimalen Windows-VM mit dem 32-bit-CONZEPT-ODBC-Treiber —
deshalb **32-bit-Python** (pyodbc gegen den DSN `Apollo 32 Bit`). Für jede Art
wird die Apollo-Abfrage in genau das Dateiformat gebracht, das der
Plattform-Parser erwartet (`services/compute/app/parsing/*.py`), und an
`POST {BASE}/api/odbc/<art>` mit dem Header `X-ODBC-Token` geschickt. Dort läuft
derselbe Parser wie beim manuellen Upload; die KPI-Berechnung bleibt in SQL
unverändert.

Nur ausgehende Verbindungen: Apollo-TCP (ODBC) und HTTP(S) zur Plattform.

Sicherheits-/Konfidenzstufen je Art (siehe README.md, Spalte „Status"):
  ✅ bestätigt gegen Plattform/Extrakt  (umsatz, auftraege, angebote,
     lagerpreise, acht_d)
  🟡 lauffähig, Format aus dem Parser abgeleitet — vor dem Produktivbetrieb mit
     ../compare.py gegen einen echten Extrakt prüfen (auftragspositionen,
     lieferscheine, wareneingaenge, materialpreise, lagerbewegungen, pruefungen)
  ⚠️ Mapping offen — Stub, liefert bewusst nichts (kontakte, interessenten,
     liefertreue). Erst die offene Quelle/Code-Liste klären (../MAPPING.md).

Aufruf:
    py -3-32 worker.py --art umsatz [--von 2025-01-01] [--dry-run]
    py -3-32 worker.py --alle
Konfig: Umgebungsvariablen oder odbc-worker\\worker.env (siehe config.example.env).

Verweise auf ../MAPPING.md, ../ERKENNTNISSE.md, ../ABSCHLUSSBERICHT.md, ../compare.py
meinen den separaten Analyse-Workspace `apollo-datenbankstruktur`, nicht dieses Repo.
"""
from __future__ import annotations

import argparse
import datetime as dt
import io
import os
import sys
from pathlib import Path

HIER = Path(__file__).resolve().parent


# --------------------------------------------------------------------------- #
# Konfiguration
# --------------------------------------------------------------------------- #
def _env_laden() -> None:
    pfad = HIER / "worker.env"
    if not pfad.exists():
        return
    for zeile in pfad.read_text(encoding="utf-8").splitlines():
        zeile = zeile.strip()
        if zeile and not zeile.startswith("#") and "=" in zeile:
            k, v = zeile.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())


_env_laden()

BASE_URL = os.environ.get("ACM_BASE_URL", "http://192.9.201.9").rstrip("/")
ODBC_TOKEN = os.environ.get("ODBC_SYNC_TOKEN", "")
APOLLO_DSN = os.environ.get("APOLLO_DSN", "Apollo 32 Bit")
APOLLO_UID = os.environ.get("APOLLO_UID", "")
APOLLO_PWD = os.environ.get("APOLLO_PWD", "")
MANDANT = int(os.environ.get("APOLLO_MANDANT", "1"))

_CN = None


def apollo():
    """Eine wiederverwendete Verbindung je Lauf."""
    global _CN
    if _CN is None:
        import pyodbc

        # UID/PWD als getrennte Attribute, NICHT in die DSN-Zeichenkette gebaut:
        # ein Sonderzeichen im Passwort (z. B. ';') zerlegt sonst den String und
        # der Login scheitert mit „User authorization failed".
        _CN = pyodbc.connect(f"DSN={APOLLO_DSN}", uid=APOLLO_UID, pwd=APOLLO_PWD, timeout=60)
    return _CN


def _lit(v) -> str:
    """Einen Wert als SQL-Literal. Der CONZEPT-Treiber bindet zwar Datums-, aber
    KEINE Ganzzahl-`?`-Parameter (die liefern stumm 0 Zeilen). Darum setzen wir
    alle Parameter inline — es sind ausschließlich interne Konstanten
    (Mandant, Belegtyp, Fensterdatum), kein Injection-Risiko."""
    if isinstance(v, dt.date):
        return "{d '%s'}" % v.isoformat()
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        return repr(v)
    return "'" + str(v).replace("'", "''") + "'"


def q(sql: str, *params):
    """Wie cursor.execute, aber `?` werden der Reihe nach durch Literale ersetzt
    (siehe _lit) — nicht über die kaputte Parameterbindung des Treibers."""
    for p in params:
        sql = sql.replace("?", _lit(p), 1)
    cur = apollo().cursor()
    cur.execute(sql)
    return cur


# --------------------------------------------------------------------------- #
# Formathilfen (deutsches Zahlen-/Datumsformat der ERP-Exporte)
# --------------------------------------------------------------------------- #
def de_datum(d) -> str:
    return d.strftime("%d.%m.%Y") if d else ""


def de_zeit(t) -> str:
    return t.strftime("%H:%M:%S") if t else ""


def de_zahl(x) -> str:
    return "" if x is None else f"{float(x):.4f}".rstrip("0").rstrip(".").replace(".", ",") or "0"


def ganz(x) -> str:
    return "" if x is None else str(int(x))


def tab_datei(header: list[str], zeilen: list[list[str]]) -> bytes:
    puffer = io.StringIO()
    puffer.write("\t".join(header) + "\r\n")
    for z in zeilen:
        puffer.write("\t".join("" if f is None else str(f) for f in z) + "\r\n")
    return puffer.getvalue().encode("cp1252", errors="replace")


def xlsx_datei(header: list[str], zeilen: list[list[str]]) -> bytes:
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.append(header)
    for z in zeilen:
        ws.append(["" if f is None else f for f in z])
    puffer = io.BytesIO()
    wb.save(puffer)
    return puffer.getvalue()


# --------------------------------------------------------------------------- #
# Nachschlagetabellen (einmal je Lauf)
# --------------------------------------------------------------------------- #
_STM: dict | None = None


def stm_artnr() -> dict:
    """stm_id -> Artikelnummer. Für die Exporte, die in Apollo nur die stm_id haben."""
    global _STM
    if _STM is None:
        _STM = {str(sid): art for sid, art in q("SELECT stm_id, stm_artnr FROM stm_std")}
    return _STM


# Belegtyp (kpf_typ / pos_typ) -> Text in den AswKpf-Exporten.
TYP_TEXT = {1: "AUF", 2: "ANG", 5: "LS", 6: "RG", 7: "GS", 8: "WE"}

# vrg_typ-ID -> Kontaktart (über Datum/Zeit/Mitarbeiter-Join Kontakte.txt ⋈
# vrg_std am 08.10.2026 eindeutig bestimmt, siehe ../ERKENNTNISSE.md). Nicht
# zugeordnete/0-Werte bleiben leer (so auch der Export) — die KPI filtert ohnehin
# auf ERS/ORT/…, leere Kontakte zählen nicht mit.
VRG_TYP_TEXT = {
    "340521": "ERS", "335768": "TEL", "338224": "EMAIL", "338281": "MESSE",
    "338266": "ORT", "347568": "ONL", "347559": "ANFR", "347566": "REFURB",
    "347567": "EPA", "348301": "BELT", "347570": "CARG", "347569": "INHOUS",
    "347753": "EINLAD", "348314": "AIXREL",
}


# --------------------------------------------------------------------------- #
# Builder je Art: (dateiname, bytes)
# --------------------------------------------------------------------------- #
# ---- AswKpf-Belegexport (Kopf): Rechnungen/Gutschriften/Aufträge/Angebote ----
_ASWKPF = [
    "Typ", "Vorgang Nr.", "Datum", "Adr Nr.", "Name 1", "Name 2", "Name 3",
    "Ort", "Erfasst durch", "Geändert durch", "Anz Pos", "AA", "Typ 2",
    "Rab Aktion", "Wert", "eigene Währung", "Ges.Wert FW", "WAHR",
]


def _beleg_kopf(typen: tuple[int, ...], dateiname: str, von: dt.date) -> tuple[str, bytes]:
    platz = ",".join("?" * len(typen))
    sql = (
        "SELECT kpf_typ, kpf_nr, kpf_datum, kpf_adr_id, kpf_user_save, kpf_wert, kpf_wert_f "
        f"FROM kpf_std WHERE kpf_typ IN ({platz}) AND kpf_mandant = ? AND kpf_datum >= ?"
    )
    zeilen = []
    for typ, nr, datum, adr, user, wert, wert_f in q(sql, *typen, MANDANT, von):
        z = [""] * len(_ASWKPF)
        z[0] = TYP_TEXT.get(int(typ), str(typ))
        z[1] = ganz(nr)
        z[2] = de_datum(datum)
        z[3] = ganz(adr)
        z[8] = user or ""
        z[14] = de_zahl(wert)
        z[16] = de_zahl(wert_f)
        zeilen.append(z)
    return dateiname, tab_datei(_ASWKPF, zeilen)


def build_umsatz(von):      return _beleg_kopf((6, 7), "AswKpf_RG.txt", von)   # ✅
def build_auftraege(von):   return _beleg_kopf((1,), "AswKpf_AUF.txt", von)    # ✅
def build_angebote(von):    return _beleg_kopf((2,), "AswKpf_ANG.txt", von)    # ✅


# ---- 8D: Reklamationen und Audit-Befunde (rek_std) ----
_8D = ["Nr.", "Datum", "Art", "Artikel", "Adressen", "Adress Nr.", "Bezeichnung",
       "Status", "Menge", "akzeptierte Menge", "gelöscht"]


def build_acht_d(von) -> tuple[str, bytes]:  # ✅
    """Das Audit-Level steckt im Feld „Artikel" = Artikelnummer des Dummy-Artikels
    (rek_stm_id 39777 'Audit Major Level 1' / 39778 'Audit Minor Level 2')."""
    artnr = stm_artnr()
    sql = (
        "SELECT rek_nr, rek_datum, rek_art, rek_stm_id, rek_adr_id, rek_status, "
        "rek_menge, rek_menge_akz, rek_geloescht FROM rek_std "
        "WHERE rek_mandant = ? AND rek_datum >= ?"
    )
    zeilen = []
    for nr, datum, art, stm, adr, status, menge, akz, gel in q(sql, MANDANT, von):
        zeilen.append([
            ganz(nr), de_datum(datum), art or "", artnr.get(str(stm), ""), "",
            ganz(adr), "", ganz(status), de_zahl(menge), de_zahl(akz),
            "J" if gel else "",
        ])
    return "8D.txt", tab_datei(_8D, zeilen)


# ---- Lagerpreise (Preiskonditionen): Selbstkosten je Artikel aus stm_std ----
_LAGERPREISE = ["Artikelnr3", "Wert", "Preismenge", "Preiseinheit", "Bezeichnung 1"]


def build_lagerpreise(von) -> tuple[str, bytes]:  # ✅ (von wird nicht gebraucht, Stammdaten)
    sql = "SELECT stm_artnr, stm_sk_kalk, stm_bez1 FROM stm_std WHERE stm_sk_kalk <> 0"
    zeilen = [[art or "", de_zahl(sk), "1", "", bez or ""] for art, sk, bez in q(sql)]
    return "AswLagBew-Preiskonditionen.txt", tab_datei(_LAGERPREISE, zeilen)


# ---- Positions-Exporte: Aufträge / Lieferscheine / Wareneingänge ----
# 🟡 Format aus parsing/positionen.py abgeleitet — gegen echten Export prüfen.
_POS_HEADER = [
    "Typ", "Vorgang Nr.", "Pos", "UPos", "Datum", "Adr Nr.", "Name 1", "Ort",
    "Artnr", "Version", "Bezeichnung 1", "Menge", "ME", "St", "Lieferdatum",
    "Preis", "Pos Wert", "Pos Typ 2", "Fremdnr", "Auftrag", "Bestellung",
    "WGR", "EK Konto",
]


def _positionen(typ_num: int, typ_text: str, von: dt.date):
    """Positionszeilen eines Belegtyps mit Vorgangs-/Auftragsnummer (Join auf kpf)."""
    sql = (
        "SELECT k.kpf_nr, p.pos_pos, p.pos_datum, p.pos_lief_datum, p.pos_artnr, "
        "p.pos_menge, p.pos_status, p.pos_preis, p.pos_wert, p.pos_typ2, "
        "p.pos_vater_kpf_id "
        "FROM pos_std p JOIN kpf_std k ON p.pos_kpf_id = k.kpf_id "
        "WHERE p.pos_typ = ? AND k.kpf_mandant = ? AND p.pos_datum >= ?"
    )
    rows = list(q(sql, typ_num, MANDANT, von))
    # Auftragsnummer des Vaterbelegs (für Lieferscheine: Spalte „Auftrag").
    vater_ids = {str(r[10]) for r in rows if r[10]}
    vater_nr: dict[str, str] = {}
    if vater_ids:
        for kid, knr in q("SELECT kpf_id, kpf_nr FROM kpf_std WHERE kpf_mandant = ?", MANDANT):
            if str(kid) in vater_ids:
                vater_nr[str(kid)] = ganz(knr)
    zeilen = []
    for nr, pos, datum, lief, artnr, menge, status, preis, wert, typ2, vater in rows:
        z = [""] * len(_POS_HEADER)
        z[0] = typ_text
        z[1] = ganz(nr)
        z[2] = ganz(pos)
        z[3] = "0"
        z[4] = de_datum(datum)
        z[8] = artnr or ""
        z[11] = de_zahl(menge)
        z[13] = ganz(status)
        z[14] = de_datum(lief)
        z[15] = de_zahl(preis)
        z[16] = de_zahl(wert)
        z[17] = ganz(typ2)
        z[19] = vater_nr.get(str(vater), "")
        zeilen.append(z)
    return zeilen


def build_auftragspositionen(von):  # 🟡
    return "AswKpf_AUF.txt", tab_datei(_POS_HEADER, _positionen(1, "AUF", von))


def build_lieferscheine(von):  # 🟡 — Excel!
    return "AswKpf_LS.xlsx", xlsx_datei(_POS_HEADER, _positionen(5, "LS", von))


def _wareneingang_zeilen(von: dt.date):
    """WE-Positionen (typ 8). WGR bleibt der Code — der Klartext ist noch offen
    (MAPPING.md), der On-Quality-Nenner-Split braucht ihn, der Import nicht."""
    artnr = stm_artnr()
    sql = (
        "SELECT k.kpf_nr, p.pos_pos, p.pos_datum, p.pos_lief_datum, p.pos_stm_id, "
        "p.pos_artnr, p.pos_menge, p.pos_preis, p.pos_wert, p.pos_wgr "
        "FROM pos_std p JOIN kpf_std k ON p.pos_kpf_id = k.kpf_id "
        "WHERE p.pos_typ = 8 AND k.kpf_mandant = ? AND p.pos_datum >= ?"
    )
    zeilen = []
    for nr, pos, datum, lief, stm, art, menge, preis, wert, wgr in q(sql, MANDANT, von):
        z = [""] * len(_POS_HEADER)
        z[0] = "WE"
        z[1] = ganz(nr)
        z[2] = ganz(pos)
        z[3] = "0"
        z[4] = de_datum(datum)
        z[8] = art or artnr.get(str(stm), "")
        z[11] = de_zahl(menge)
        z[14] = de_datum(lief)
        z[15] = de_zahl(preis)
        z[16] = de_zahl(wert)
        z[21] = ganz(wgr)  # WGR-Code; Klartext offen
        zeilen.append(z)
    return zeilen


def build_wareneingaenge(von):  # 🟡
    return "AswKpf_WE.txt", tab_datei(_POS_HEADER, _wareneingang_zeilen(von))


def build_materialpreise(von):  # 🟡 — dieselbe WE-Datei, eigener Zielimport
    return "AswKpf_WE.txt", tab_datei(_POS_HEADER, _wareneingang_zeilen(von))


# ---- Lagerbewegungen (AswLagBew) ----
_LAGBEW = ["Artikelnr", "Bezeichnung 1", "BuchDatum", "Zeit", "Bewegungsmenge",
           "Charge", "BuchTyp", "Kommentar", "QS", "Buchungsgrund", "Benutzer"]


def build_lagerbewegungen(von) -> tuple[str, bytes]:  # 🟡
    """Aus bestand_std; Artikelnummer über stm_id. Buchtyp = bestand_vater_typ,
    Bewegungsmenge = bestand_delta. Gegen den echten AswLagBew-Export prüfen
    (Umfang/Vorzeichen je Buchtyp, siehe ../ABSCHLUSSBERICHT.md)."""
    artnr = stm_artnr()
    sql = (
        "SELECT bestand_stm_id, bestand_datum, bestand_zeit, bestand_delta, "
        "bestand_charge, bestand_vater_typ, bestand_grund FROM bestand_std "
        "WHERE bestand_mandant = ? AND bestand_datum >= ?"
    )
    zeilen = []
    for stm, datum, zeit, delta, charge, vtyp, grund in q(sql, MANDANT, von):
        zeilen.append([
            artnr.get(str(stm), ""), "", de_datum(datum), de_zeit(zeit),
            de_zahl(delta), charge or "", vtyp or "", "", "", grund or "", "",
        ])
    return "AswLagBew.txt", tab_datei(_LAGBEW, zeilen)


# ---- Qualitätsprüfung (AswQs2151) aus meld_std ----
_QS = ["Datum", "Zeit", "Benutzer", "FA", "Artikel", "Bezeichnung",
       "Buchungs-Menge", "Ausschuss-Menge", "RSC", "Produktgruppe", "Typ"]


def build_pruefungen(von) -> tuple[str, bytes]:  # 🟡
    """BDE-Meldungen (meld_std). RSC = Artikelnummer der Ressource
    (meld_rsc_id -> rsc_std.rsc_stm_id -> stm_artnr); die Plattform filtert
    selbst auf RSC=70000. Die RSC-Auflösung ist der teure Teil (rsc_std groß) —
    hier über eine einmalige rsc_id->artnr-Karte."""
    artnr = stm_artnr()
    # rsc_id -> stm_id (einmal; rsc_std ist groß → ggf. mehrere Minuten).
    rsc_stm = {str(rid): str(sid) for rid, sid in q("SELECT rsc_id, rsc_stm_id FROM rsc_std")}
    sql = (
        "SELECT meld_datum_buch, meld_zeit_buch, meld_fa, meld_stm_id, meld_menge, "
        "meld_rsc_id FROM meld_std WHERE meld_mandant = ? AND meld_datum_buch >= ?"
    )
    zeilen = []
    for datum, zeit, fa, stm, menge, rid in q(sql, MANDANT, von):
        rsc_art = artnr.get(rsc_stm.get(str(rid), ""), "")
        zeilen.append([
            de_datum(datum), de_zeit(zeit), "", ganz(fa), artnr.get(str(stm), ""),
            "", de_zahl(menge), "", rsc_art, "", "",
        ])
    return "AswQs2151.txt", tab_datei(_QS, zeilen)


# ---- Liefertreue (Vertrieb): Auftrag (typ 1) <-> Lieferschein (typ 5) ----
# 🟡 gegen extrakte/Liefertreue.txt prüfen. Nicht Einkauf, sondern die
# Verzugsquote der eigenen Auslieferung (delivery_reliability / KPI 0004).
_LIEFERTREUE = ["Auftrag", "Pos", "UPos", "Kundennummer", "Kunde", "geliefert",
                "Lieferdatum", "Wunschdatum", "Verzug (Tage)", "Menge", "ME",
                "Artikel", "Bezeichnung"]


def _arbeitstage(a, b) -> int | None:
    """Arbeitstage (Mo–Fr) von a bis b; negativ wenn b vor a. Ohne Feiertage —
    das reproduziert das Vorzeichen (= die Quote `verzug<=0`) exakt und den
    Ø-Verzug näherungsweise (nur um die Feiertage im Intervall zu hoch)."""
    if not a or not b:
        return None
    schritt = 1 if b >= a else -1
    tage, d = 0, a
    while d != b:
        d += dt.timedelta(days=schritt)
        if d.weekday() < 5:
            tage += schritt
    return tage


def build_liefertreue(von) -> tuple[str, bytes]:  # 🟡
    # Auftragsköpfe (typ 1) und -positionen; Rückblick, weil der Auftrag vor der
    # Lieferung im Fenster angelegt wurde.
    auf_von = dt.date(von.year - 2, von.month, 1)
    auf = {str(kid): (ganz(nr), str(adr)) for kid, nr, adr in q(
        "SELECT kpf_id, kpf_nr, kpf_adr_id FROM kpf_std "
        "WHERE kpf_typ = 1 AND kpf_mandant = ? AND kpf_datum >= ?", MANDANT, auf_von)}
    aufpos = {}
    for pid, lief, wun in q(
        "SELECT pos_id, pos_lief_datum, pos_lief_wunsch FROM pos_std "
        "WHERE pos_typ = 1 AND pos_mandant = ? AND pos_datum >= ?", MANDANT, auf_von):
        aufpos[str(pid)] = (lief, wun)
    adr = {str(aid): (ganz(nr), name or "") for aid, nr, name in
           q("SELECT adr_id, adr_nr, adr_name1 FROM adr_std")}
    ls_datum = {str(kid): d for kid, d in q(
        "SELECT kpf_id, kpf_datum FROM kpf_std "
        "WHERE kpf_typ = 5 AND kpf_mandant = ? AND kpf_datum >= ?", MANDANT, von)}

    zeilen = []
    sql = (
        "SELECT pos_kpf_id, pos_pos, pos_vater_kpf_id, pos_vater_pos_id, "
        "pos_artnr, pos_menge, pos_einh FROM pos_std "
        "WHERE pos_typ = 5 AND pos_mandant = ? AND pos_datum >= ?"
    )
    for ls_kpf, pos, vkpf, vpos, art, menge, einh in q(sql, MANDANT, von):
        geliefert = ls_datum.get(str(ls_kpf))
        auftrag_nr, adr_id = auf.get(str(vkpf), ("", ""))
        lief, wun = aufpos.get(str(vpos), (None, None))
        verzug = _arbeitstage(lief, geliefert)
        if verzug is None:
            verzug = 0  # wie der Export: ohne Zieldatum kein Verzug
        adr_nr, adr_name = adr.get(adr_id, ("", ""))
        zeilen.append([
            auftrag_nr, ganz(pos), "0", adr_nr, adr_name, de_datum(geliefert),
            de_datum(lief), de_datum(wun), str(verzug), de_zahl(menge),
            ganz(einh), art or "", "",
        ])
    return "dev_excel_Liefertreue_Einkauf.txt", tab_datei(_LIEFERTREUE, zeilen)


# ---- Kontakte (vrg_std): Vertriebs-Kontaktprotokoll ----
_KONTAKTE = ["Datum", "Zeit", "W-Vorlage", "Ansprechpartner", "Art", "Typ", "St",
             "Mitarbeiter", "Name 1", "Ort", "Erf. Datum", "Erf. Benutzer",
             "Textfeld", "Typ", "Vorgang Nr.", "Wert"]


def build_kontakte(von) -> tuple[str, bytes]:  # ✅
    """Erste `Typ`-Spalte = Kontaktart (ERS/ORT/ONL/… aus VRG_TYP_TEXT), zweite
    = ERP-Verknüpfung (ANG/RG aus vrg_kpf_typ)."""
    adr = {str(aid): (name or "", ort or "") for aid, name, ort in
           q("SELECT adr_id, adr_name1, adr_ort FROM adr_std")}
    sql = (
        "SELECT vrg_datum, vrg_zeit, vrg_ansprech, vrg_typ, vrg_status, "
        "vrg_mitarbeiter, vrg_adr_id, vrg_datum_save, vrg_user_save, vrg_text1, "
        "vrg_kpf_typ, vrg_kpf_nr FROM vrg_std WHERE vrg_mandant = ? AND vrg_datum >= ?"
    )
    zeilen = []
    for (datum, zeit, ansp, vtyp, status, mit, aid, erf_dat, erf_usr, text,
         kpf_typ, kpf_nr) in q(sql, MANDANT, von):
        name, ort = adr.get(str(aid), ("", ""))
        kontaktart = VRG_TYP_TEXT.get(ganz(vtyp), "")
        erp = TYP_TEXT.get(int(kpf_typ), "") if kpf_typ else ""
        zeilen.append([
            de_datum(datum), de_zeit(zeit), "", ansp or "", "", kontaktart,
            ganz(status), (mit or "").upper(), name, ort, de_datum(erf_dat),
            erf_usr or "", text or "", erp, ganz(kpf_nr), "",
        ])
    return "Kontakte.txt", tab_datei(_KONTAKTE, zeilen)


# ---- Interessenten (adr_std, adr_typ = 8) ----
_INTERESSENTEN = ["Adress-Nr.", "Name 1", "Datum Save"]


def build_interessenten(von) -> tuple[str, bytes]:  # ✅ (Stammdaten, von unbenutzt)
    """adr_typ = 8 kennzeichnet Interessenten (1443/1450 der bekannten Liste)."""
    sql = ("SELECT adr_nr, adr_name1, adr_datum_save FROM adr_std WHERE adr_typ = 8")
    zeilen = [[ganz(nr), name or "", de_datum(ds)] for nr, name, ds in q(sql)]
    return "dev_excel_INT.txt", tab_datei(_INTERESSENTEN, zeilen)


# Dieselben 14 Arten wie REGISTRY in services/compute/app/routers/uploads.py.
BUILDERS = {
    "umsatz": build_umsatz,
    "auftraege": build_auftraege,
    "angebote": build_angebote,
    "auftragspositionen": build_auftragspositionen,
    "lieferscheine": build_lieferscheine,
    "wareneingaenge": build_wareneingaenge,
    "materialpreise": build_materialpreise,
    "acht_d": build_acht_d,
    "pruefungen": build_pruefungen,
    "lagerbewegungen": build_lagerbewegungen,
    "lagerpreise": build_lagerpreise,
    "liefertreue": build_liefertreue,
    "kontakte": build_kontakte,
    "interessenten": build_interessenten,
}

# Alle 14 Arten sind verdrahtet. Reihenfolge nach Konfidenz.
VERDRAHTET = tuple(BUILDERS)


# --------------------------------------------------------------------------- #
# An die Plattform senden + melden
# --------------------------------------------------------------------------- #
WORKER_VERSION = "0.2"


def senden(art: str, dateiname: str, daten: bytes) -> dict:
    import requests

    if not ODBC_TOKEN:
        raise SystemExit("ODBC_SYNC_TOKEN ist nicht gesetzt (worker.env).")
    r = requests.post(
        f"{BASE_URL}/api/odbc/{art}",
        headers={"X-ODBC-Token": ODBC_TOKEN},
        files={"file": (dateiname, daten, "application/octet-stream")},
        timeout=600,
    )
    if r.status_code >= 400:
        raise RuntimeError(f"HTTP {r.status_code} — {r.text[:300]}")
    return r.json()


def lauf(art: str, von: dt.date, dry_run: bool) -> dict:
    """Eine Art bauen und senden. Gibt eine Lauf-Meldung fürs Monitoring zurück
    (status/zeilen/dauer_ms/fehler), auch im Fehlerfall."""
    import time

    start = time.monotonic()
    try:
        dateiname, daten = BUILDERS[art](von)
        print(f"{art}: {dateiname}, {len(daten):,} Bytes aus Apollo")
        if dry_run:
            ziel = HIER / f"_dryrun_{dateiname}"
            ziel.write_bytes(daten)
            print(f"{art}: Dry-Run -> {ziel}")
            zeilen = None
        else:
            antwort = senden(art, dateiname, daten)
            zeilen = antwort.get("rows_total")
            print(f"{art}: {antwort}")
        dauer = int((time.monotonic() - start) * 1000)
        return {"art": art, "status": "ok", "zeilen": zeilen, "dauer_ms": dauer, "fehler": None}
    except Exception as exc:
        dauer = int((time.monotonic() - start) * 1000)
        print(f"{art}: FEHLER {exc}")
        return {"art": art, "status": "fehler", "zeilen": None, "dauer_ms": dauer,
                "fehler": str(exc)[:500]}


def konfig_holen() -> dict:
    """Intervall, aktive Arten und Sofort-Sync-Zeitstempel von der Plattform."""
    import requests

    r = requests.get(
        f"{BASE_URL}/api/odbc/konfig", headers={"X-ODBC-Token": ODBC_TOKEN}, timeout=60
    )
    r.raise_for_status()
    return r.json()


def status_melden(laeufe: list[dict], sync_bestaetigt_am: str | None = None,
                  letzter_fehler: str | None = None) -> None:
    """Herzschlag + letzte Läufe an die Plattform melden (Monitoring)."""
    import socket

    import requests

    try:
        requests.post(
            f"{BASE_URL}/api/odbc/status",
            headers={"X-ODBC-Token": ODBC_TOKEN},
            json={
                "worker_version": WORKER_VERSION,
                "host": socket.gethostname(),
                "sync_bestaetigt_am": sync_bestaetigt_am,
                "letzter_fehler": letzter_fehler,
                "laeufe": laeufe,
            },
            timeout=60,
        ).raise_for_status()
    except Exception as exc:  # Monitoring darf den Lauf nie kippen
        print(f"status: konnte nicht melden — {exc}")


def _von_vorgabe() -> dt.date:
    """Ab 1.1. des Vorjahres: deckt das laufende und das letzte Jahr ab."""
    return dt.date(dt.date.today().year - 1, 1, 1)


def dienst() -> None:
    """Dauerbetrieb auf der VM: zyklisch die aktiven Arten ziehen, Konfig und
    Sofort-Sync alle 60 s abfragen, nach jedem Lauf den Status melden."""
    import time

    print(f"Dienst gestartet (v{WORKER_VERSION}) gegen {BASE_URL}")
    letzte_anfrage = None
    naechster_lauf = 0.0
    while True:
        try:
            k = konfig_holen()
        except Exception as exc:
            print(f"konfig: nicht erreichbar — {exc}")
            status_melden([], letzter_fehler=f"Konfig nicht erreichbar: {exc}"[:500])
            time.sleep(60)
            continue

        anfrage = k.get("sync_angefordert_am")
        sofort = bool(anfrage) and anfrage != letzte_anfrage
        if sofort or time.monotonic() >= naechster_lauf:
            arten = [a for a in k.get("aktive_arten", []) if a in BUILDERS]
            print(f"Lauf: {', '.join(arten) or '(keine)'}" + (" [Sofort-Sync]" if sofort else ""))
            laeufe = [lauf(a, _von_vorgabe(), dry_run=False) for a in arten]
            status_melden(laeufe, sync_bestaetigt_am=anfrage if sofort else None)
            if sofort:
                letzte_anfrage = anfrage
            naechster_lauf = time.monotonic() + max(k.get("intervall_min", 60), 5) * 60
        time.sleep(60)  # Konfig/Sofort-Sync im Minutentakt prüfen


def main() -> None:
    ap = argparse.ArgumentParser(description="ACM ODBC-Worker (Apollo -> Plattform)")
    ap.add_argument("--art", choices=list(BUILDERS))
    ap.add_argument("--alle", action="store_true", help="alle verdrahteten Arten")
    ap.add_argument("--dienst", action="store_true",
                    help="Dauerbetrieb: Konfig von der Plattform holen und zyklisch syncen")
    ap.add_argument("--von", default=None, help="Datum von (YYYY-MM-DD), Vorgabe: 1.1. Vorjahr")
    ap.add_argument("--dry-run", action="store_true", help="nur Datei schreiben, nicht senden")
    a = ap.parse_args()
    if sys.maxsize > 2**32:
        print("WARNUNG: 64-bit-Python — der 32-bit-CONZEPT-Treiber lädt nur unter 32-bit-Python.")

    if a.dienst:
        dienst()
        return

    von = dt.date.fromisoformat(a.von) if a.von else _von_vorgabe()
    if a.alle:
        laeufe = [lauf(art, von, a.dry_run) for art in VERDRAHTET]
    elif a.art:
        laeufe = [lauf(a.art, von, a.dry_run)]
    else:
        ap.error("--art <name>, --alle oder --dienst angeben")
        return

    if not a.dry_run:
        status_melden(laeufe)  # Einzel-/Alle-Lauf taucht auch im Monitoring auf
    if any(x["status"] == "fehler" for x in laeufe):
        raise SystemExit(f"{sum(x['status'] == 'fehler' for x in laeufe)} Art(en) mit Fehler.")


if __name__ == "__main__":
    main()
