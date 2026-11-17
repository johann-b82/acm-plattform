"""ODBC-Worker: liest Apollo (CONZEPT 16) und füttert die ACM-Plattform.

Läuft auf einer minimalen Windows-VM mit dem CONZEPT-ODBC-Treiber (pyodbc gegen
den DSN aus `APOLLO_DSN`). Python-Architektur muss zur DSN-/Treiber-Architektur
passen — beides 64-bit (empfohlen) oder beides 32-bit. Für jede Art
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
    py worker.py --art umsatz [--von 2025-01-01] [--dry-run]   # 64-bit; 32-bit: py -3-32
    py worker.py --alle
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
APOLLO_DSN = os.environ.get("APOLLO_DSN", "Apollo 64-bit")
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


def _beleg_kopf(typen: tuple[int, ...], von: dt.date) -> list[dict]:
    platz = ",".join("?" * len(typen))
    sql = (
        "SELECT kpf_typ, kpf_nr, kpf_datum, kpf_adr_id, kpf_user_save, kpf_wert, kpf_wert_f "
        f"FROM kpf_std WHERE kpf_typ IN ({platz}) AND kpf_mandant = ? AND kpf_datum >= ?"
    )
    zeilen = []
    for typ, nr, datum, adr, user, wert, wert_f in q(sql, *typen, MANDANT, von):
        zeilen.append({
            "Typ": TYP_TEXT.get(int(typ), str(typ)),
            "Vorgang Nr.": ganz(nr),
            "Datum": de_datum(datum),
            "Adr Nr.": ganz(adr),
            "Name 1": "",
            "Name 2": "",
            "Name 3": "",
            "Ort": "",
            "Erfasst durch": user or "",
            "Geändert durch": "",
            "Anz Pos": "",
            "AA": "",
            "Typ 2": "",
            "Rab Aktion": "",
            "Wert": de_zahl(wert),
            "eigene Währung": "",
            "Ges.Wert FW": de_zahl(wert_f),
            "WAHR": "",
        })
    return zeilen


def build_umsatz(von):      return _beleg_kopf((6, 7), von)   # ✅
def build_auftraege(von):   return _beleg_kopf((1,), von)    # ✅
def build_angebote(von):    return _beleg_kopf((2,), von)    # ✅


# ---- 8D: Reklamationen und Audit-Befunde (rek_std) ----
_8D = ["Nr.", "Datum", "Art", "Artikel", "Adressen", "Adress Nr.", "Bezeichnung",
       "Status", "Menge", "akzeptierte Menge", "gelöscht"]


def build_acht_d(von) -> list[dict]:  # ✅
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
        zeilen.append({
            "Nr.": ganz(nr),
            "Datum": de_datum(datum),
            "Art": art or "",
            "Artikel": artnr.get(str(stm), ""),
            "Adressen": "",
            "Adress Nr.": ganz(adr),
            "Bezeichnung": "",
            "Status": ganz(status),
            "Menge": de_zahl(menge),
            "akzeptierte Menge": de_zahl(akz),
            "gelöscht": "J" if gel else "",
        })
    return zeilen


# ---- Lagerpreise (Preiskonditionen): Selbstkosten je Artikel aus stm_std ----
_LAGERPREISE = ["Artikelnr3", "Wert", "Preismenge", "Preiseinheit", "Bezeichnung 1"]


def build_lagerpreise(von) -> list[dict]:  # ✅ (von wird nicht gebraucht, Stammdaten)
    sql = "SELECT stm_artnr, stm_sk_kalk, stm_bez1 FROM stm_std WHERE stm_sk_kalk <> 0"
    return [
        {"Artikelnr3": art or "", "Wert": de_zahl(sk), "Preismenge": "1",
         "Preiseinheit": "", "Bezeichnung 1": bez or ""}
        for art, sk, bez in q(sql)
    ]


# ---- Hilfsfunktionen ----


def _batched(iterable, n: int):
    """`iterable` in Partien der Größe `n` aufteilen."""
    batch = []
    for item in iterable:
        batch.append(item)
        if len(batch) == n:
            yield batch
            batch = []
    if batch:
        yield batch


# ---- Positions-Exporte: Aufträge / Lieferscheine / Wareneingänge ----
# 🟡 Format aus parsing/positionen.py abgeleitet — gegen echten Export prüfen.
_POS_HEADER = [
    "Typ", "Vorgang Nr.", "Pos", "UPos", "Datum", "Adr Nr.", "Name 1", "Ort",
    "Artnr", "Version", "Bezeichnung 1", "Menge", "ME", "St", "Lieferdatum",
    "Preis", "Pos Wert", "Pos Typ 2", "Fremdnr", "Auftrag", "Bestellung",
    "WGR", "EK Konto",
]


def _positionen(typ_num: int, typ_text: str, von: dt.date):
    """Positionszeilen eines Belegtyps mit Vorgangs-/Auftragsnummer (Join auf kpf).

    Lieferscheine (typ 5): `pos_unterpos` als gespeicherte Spalte — keine
    berechnete Rangfolge. Gesperrte Artikel (`stm_sperr_date` gesetzt und >=
    `pos_datum`) werden von der Maske ausgefiltert.

    Aufträge (typ 1): keine Sperre, UPos immer „0".
    """
    sql = (
        "SELECT k.kpf_nr, p.pos_pos, p.pos_datum, p.pos_lief_datum, p.pos_artnr, "
        "p.pos_menge, p.pos_status, p.pos_preis, p.pos_wert, p.pos_typ2, "
        "p.pos_vater_kpf_id, p.pos_id, p.pos_kpf_id, k.kpf_adr_id, "
        "p.pos_stm_id, p.pos_unterpos "  # pos_unterpos direkt im Haupt-SELECT
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

    # Kopf-Adresse (Adr Nr. / Name 1 / Ort) wie in der Maske.
    adr_ids = {str(r[13]) for r in rows if r[13]}
    adr_data: dict[str, tuple[str, str, str]] = {}
    if adr_ids:
        for aid, anr, name, ort in q("SELECT adr_id, adr_nr, adr_name1, adr_ort FROM adr_std"):
            if str(aid) in adr_ids:
                adr_data[str(aid)] = (ganz(anr), name or "", ort or "")

    # Lieferscheine: gesperrte Artikel filtern (STM-Sperre >= Zeilendatum).
    # Die Maske schließt Zeilen aus, wo `stm_sperr_date` gesetzt und >=
    # `pos_datum`. Artikel ohne Sperre oder mit Sperre nach Zeilendatum
    # bleiben erhalten.
    if typ_text == "LS":
        stm_ids = {str(r[14]) for r in rows}  # pos_stm_id (Index 14)
        sperr_map: dict[str, dt.date | None] = {}
        if stm_ids:
            for sid, sdate in q(
                "SELECT stm_id, stm_sperr_date FROM stm_std WHERE stm_mandant = ?",
                MANDANT
            ):
                sperr_map[str(sid)] = sdate  # ggf None

        rows = [r for r in rows
                if not _ist_gesperrt(r[14], r[3], sperr_map)]

    # UPos: `pos_unterpos` ist eine gespeicherte Spalte in pos_std — die Maske
    # gibt sie 1:1 aus (Hauptzeilen = 0/NULL → "0").
    zeilen = []
    for nr, pos, datum, lief, artnr, menge, status, preis, wert, typ2, \
            vater, pid, kid, aid, stm_id, unterpos in rows:
        z = [""] * len(_POS_HEADER)
        z[0] = typ_text
        z[1] = ganz(nr)
        z[2] = ganz(pos)
        if typ_text == "LS":
            z[3] = ganz(unterpos)  # gespeicherte Spalte aus Haupt-SELECT
        else:
            z[3] = "0"  # Aufträge haben keine UPos
        z[4] = de_datum(datum)
        z[5], z[6], z[7] = adr_data.get(str(aid), ("", "", ""))
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


def _ist_gesperrt(stm_id, pos_datum: dt.date | None,
                   sperr_map: dict[str, dt.date | None]) -> bool:
    """True, wenn der Artikel gesperrt ist und das Sperrdatum >= Zeilendatum."""
    sdate = sperr_map.get(str(stm_id)) if stm_id else None
    if sdate is None:
        return False
    if pos_datum is None:
        return True  # kein Datum → sicher ausschließen
    return sdate >= pos_datum


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
    (Umfang/Vorzeichen je Buchtyp, siehe ../ABSCHLUSSBERICHT.md).

    Gesperrte Artikel (`stm_sperr_date` gesetzt und >= `bestand_datum`) werden
    von der Maske ausgefiltert — 255 von 261 nur-Worker-Artikeln haben ein
    Sperrdatum (Probe ls-filter2.py)."""
    artnr = stm_artnr()
    sql = (
        "SELECT bestand_stm_id, bestand_datum, bestand_zeit, bestand_delta, "
        "bestand_charge, bestand_vater_typ, bestand_grund FROM bestand_std "
        "WHERE bestand_mandant = ? AND bestand_datum >= ?"
    )
    rows = list(q(sql, MANDANT, von))

    # Sperr-Map: stm_id → stm_sperr_date (Vollscan, ~40k Zeilen).
    sperr_map: dict[str, dt.date | None] = {}
    for sid, sdate in q("SELECT stm_id, stm_sperr_date FROM stm_std"):
        sperr_map[str(sid)] = sdate

    zeilen = []
    for stm, datum, zeit, delta, charge, vtyp, grund in rows:
        if _ist_gesperrt(stm, datum, sperr_map):
            continue  # Maske filtert gesperrte Zeilen aus
        zeilen.append([
            artnr.get(str(stm), ""), "", de_datum(datum), de_zeit(zeit),
            de_zahl(delta), charge or "", vtyp or "", "", "", grund or "", "",
        ])
    return "AswLagBew.txt", tab_datei(_LAGBEW, zeilen)


# ---- Qualitätsprüfung (AswQs2151) aus meld_std ----
_QS = ["Datum", "Zeit", "Benutzer", "FA", "Artikel", "Bezeichnung",
       "Buchungs-Menge", "Ausschuss-Menge", "RSC", "Produktgruppe", "Typ"]


def build_pruefungen(von) -> tuple[str, bytes]:  # 🟡
    """BDE-Meldungen (meld_std) — Spalten gegen die echte Maske validiert
    (AswQs2151, Test-DB, Zeile 1 = FA 3330 / TROMBATORE):
    - Artikel + Bezeichnung = FA-Produkt (meld_fa → fa_std.fa_stm_id → stm_std)
    - RSC = Artikel der Meldung (meld_stm_id) — NICHT über rsc_std auflösen:
      in der Maske identisch, und der rsc_std-Vollscan wäre der 4,3-h-Treiber.
    - Benutzer = meld_user, Buchungs-Menge = meld_menge.
    Offen: Produktgruppe/Typ (Warengruppen-Hierarchie, Code-Liste in der
    Test-DB nicht auffindbar — grp_std/krs_std leer, MAPPING.md) und die
    Ausschuss-/Qualitäts-Felder.
    KEIN SQL-JOIN meld_std ⋈ fa_std: ein nur einseitig belegter JOIN hängt
    mit dem Treiber (Smoke-Test); wie in den übrigen Buildern erfolgt die
    Zuordnung über Vollscan-Dicts in Python (fa_id → fa_stm_id)."""
    # Artikelstamm einmal (Vollscan stm_std): Artikelnummer + Kurzbezeichnung.
    stm = {str(sid): (art or "", bez or "")
           for sid, art, bez in q("SELECT stm_id, stm_artnr, stm_bez1 FROM stm_std")}
    # FA -> Produkt (Vollscan fa_std, 2 Spalten) für den Python-Join.
    fa_prod = {str(fid): str(pid) for fid, pid in
               q("SELECT fa_id, fa_stm_id FROM fa_std") if pid}
    sql = (
        "SELECT meld_datum_buch, meld_zeit_buch, meld_user, meld_fa, "
        "meld_stm_id, meld_menge FROM meld_std "
        "WHERE meld_mandant = ? AND meld_datum_buch >= ?"
    )
    zeilen = []
    for datum, zeit, user, fa, stm_id, menge in q(sql, MANDANT, von):
        p_art, p_bez = stm.get(fa_prod.get(str(fa), ""), ("", ""))
        rsc_art, _ = stm.get(str(stm_id), ("", ""))
        zeilen.append([
            de_datum(datum), de_zeit(zeit), user or "", ganz(fa), p_art,
            p_bez, de_zahl(menge), "", rsc_art, "", "",
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


# ---- Kunden → Bestellungen → Fertigungsaufträge (Status/Vervollständigung) ----
_KUNDEN_HEADER = [
    "Kundennummer", "Kunde", "Bestell-Nr.", "Typ", "Datum",
    "Pos", "Artikel", "Typ", "Ursprung", "Vater-Artikel",
    "Meldung-Status", "Erledigt", "RSC-ID"
]

# Top-N-Limit für kpf_std (Vollscan ~490s für adr_id=1 → TOP N in 0.1s).
# Setzbar per Umgebungsvariable, Default=500 (für Tests klein halten).
_KUNDEN_TOP_N = int(os.environ.get("KUNDEN_TOP_N", "500"))


def build_kunden_bestellungen(
    kunde_adr_id: int,
    von: dt.date | None = None,
    *,
    top_n: int | None = None,
) -> tuple[str, bytes]:
    """Kunde → Bestellungen → Positionen → Artikel → Fertigungsstatus.

    Performance-Anpassungen (Apollo-DB bleibt unverändert):
    - TOP N für kpf_std (Vollscan ~490s → TOP 500 in Sekunden)
    - Batch-Verarbeitung über IN-Clause (max 25.000 pro Batch)
    - Python-Dict-Join statt SQL-JOIN (CONZEPT-Treiber-Quirk: einseitige JOINs
      hängen)
    - `meld_std` nur mit relevanten Daten laden (WHERE meld_fa IN (...))

    Returns: (dateiname, bytes) – Excel mit Struktur:
      Kunde | Bestellungen | Positionen | Artikel (Typ, Ursprung) | Status
    """
    top_n = top_n if top_n is not None else _KUNDEN_TOP_N

    # === 1. Kunde → Bestellungen (kpf_std) mit TOP N ===
    sql = (
        f"SELECT TOP {_lit(top_n)} kpf_nr, kpf_typ, kpf_datum FROM kpf_std "
        f"WHERE kpf_adr_id = {_lit(float(kunde_adr_id))} "
        f"AND kpf_mandant = {_lit(MANDANT)}"
    )
    if von:
        sql += f" AND kpf_datum >= {_lit(von)}"

    bestellungen = []
    for nr, typ, datum in q(sql):
        bestellungen.append({
            'kpf_nr': nr,
            'kpf_typ': typ,
            'kpf_datum': datum,
        })

    if not bestellungen:
        return "KundenBestellungen.txt", tab_datei(_KUNDEN_HEADER, [])

    # === 2. Positionen (pos_std) für alle Bestellungen ===
    kpf_nrs = [b['kpf_nr'] for b in bestellungen]

    positionen = []
    for batch in _batched(kpf_nrs, 25000):
        in_clause = ",".join(_lit(float(nr)) for nr in batch)
        sql_pos = (
            "SELECT pos_kpf_id, pos_pos, pos_artnr, pos_stm_id FROM pos_std "
            f"WHERE pos_kpf_id IN ({in_clause}) "
            f"AND pos_mandant = {_lit(MANDANT)}"
        )
        for kpf_id, pos_pos, artnr, stm_id in q(sql_pos):
            positionen.append({
                'pos_kpf_id': kpf_id,
                'pos_pos': pos_pos,
                'pos_artnr': artnr,
                'pos_stm_id': stm_id,
            })

    # === 3. Artikel (stm_std) für alle Positionen ===
    stm_ids = {p['pos_stm_id'] for p in positionen if p['pos_stm_id']}
    stm_map: dict[str, tuple] = {}  # stm_id → (stm_artnr, stm_typ, stm_ursprung, stm_vater_artnr)
    if stm_ids:
        for batch in _batched(stm_ids, 25000):
            in_clause = ",".join(_lit(float(sid)) for sid in batch)
            sql_stm = (
                "SELECT stm_id, stm_artnr, stm_typ, stm_ursprung, stm_vater_artnr "
                f"FROM stm_std WHERE stm_id IN ({in_clause}) "
                f"AND stm_mandant = {_lit(MANDANT)}"
            )
            for sid, artnr, typ, ursprung, vater in q(sql_stm):
                stm_map[str(int(float(sid)))] = (artnr or "", typ, ursprung, vater)

    # === 4. Fertigungsstatus (meld_std) – nur relevante Meldungen laden ===
    # Da meld_std zu groß ist: WHERE meld_fa IN (kpf_nrs) statt Vollscan.
    kpf_nr_floats = [float(nr) for nr in kpf_nrs]
    meld_map: dict[tuple, tuple] = {}  # (meld_fa, meld_pos) → Status-Tupel
    for batch in _batched(kpf_nr_floats, 25000):
        in_clause = ",".join(_lit(float(nr)) for nr in batch)
        sql_meld = (
            "SELECT meld_fa, meld_pos, meld_stm_id, meld_fa_status, "
            "meld_erledigt, meld_rsc_id FROM meld_std "
            f"WHERE meld_fa IN ({in_clause}) "
            f"AND meld_mandant = {_lit(MANDANT)}"
        )
        try:
            for fa, pos, stm_id, status, erledigt, rsc_id in q(sql_meld):
                meld_map[(str(int(float(fa))), str(int(float(pos))))] = (
                    status, erledigt, rsc_id
                )
        except Exception:
            # meld_std für diesen Batch zu groß → überspringen (leere Status)
            pass

    # === 5. Ergebnis zusammenbauen (Python-Dict-Join) ===
    zeilen = []

    # Kunde-Info (adr_std) – einmal pro Aufruf laden
    adr_sql = (
        f"SELECT adr_nr, adr_name1 FROM adr_std "
        f"WHERE adr_id = {_lit(float(kunde_adr_id))} "
        f"AND adr_mandant = {_lit(MANDANT)}"
    )
    adr_nr, adr_name = "", ""
    for a_nr, a_name in q(adr_sql):
        adr_nr, adr_name = ganz(a_nr), a_name or ""
        break

    # Positionen pro Bestellung gruppieren (Python-Dict-Join)
    pos_by_kpf: dict[str, list] = {}
    for p in positionen:
        kpf_key = str(int(float(p['pos_kpf_id'])))
        pos_by_kpf.setdefault(kpf_key, []).append(p)

    for b in bestellungen:
        kpf_nr = str(int(float(b['kpf_nr'])))
        b_positionen = pos_by_kpf.get(kpf_nr, [])

        for p in b_positionen:
            pos_pos = str(int(float(p['pos_pos'])))
            stm_id = str(int(float(p['pos_stm_id']))) if p['pos_stm_id'] else ""

            # Artikel-Info aus stm_map (Python-Dict-Join)
            artnr, typ, ursprung, vater = stm_map.get(stm_id, ("", "", "", ""))

            # Fertigungsstatus aus meld_map (Python-Dict-Join)
            status_info = meld_map.get((kpf_nr, pos_pos), (None, None, None))
            meld_status, erledigt, rsc_id = status_info

            zeilen.append([
                adr_nr or "",
                adr_name or "",
                ganz(b['kpf_nr']),
                TYP_TEXT.get(int(b['kpf_typ']), str(b['kpf_typ'])),
                de_datum(b['kpf_datum']),
                ganz(p['pos_pos']),
                artnr or "",
                str(typ) if typ else "",
                str(ursprung) if ursprung else "",
                vater or "",
                str(meld_status) if meld_status else "",
                "J" if erledigt else "N",
                ganz(rsc_id) if rsc_id else "",
            ])

    return "KundenBestellungen.xlsx", xlsx_datei(_KUNDEN_HEADER, zeilen)


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
    "kunden": build_kunden_bestellungen,
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
    bits = 64 if sys.maxsize > 2**32 else 32
    print(f"{bits}-bit-Python — der DSN '{APOLLO_DSN}' muss ein {bits}-bit-DSN sein "
          f"(sonst scheitert das Laden der Treiber-DLL mit 'architecture mismatch').")

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
