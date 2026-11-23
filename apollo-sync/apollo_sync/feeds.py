"""The 14 platform feeds ("Arten") in the layout of the Apollo list exports.

Reference: the Apollo exports the platform was fed with by hand (October 2026,
`KPIs/2026/Rohdaten/Oktober_26`). Every column the platform parsers read
(`services/compute/app/parsing/*.py`) was traced row by row to its Apollo source
(see apollo-sync/docs/FEEDS.md). The first port copied odbc-worker/worker.py, which was
never live: it left names, descriptions, units and codes empty, wrote internal IDs instead
of numbers and codes, lost sub-positions and built the purchasing delivery reliability from
sales orders. This module replaces that.

Code fields (unit, material group, order type, currency, contact type …) are record IDs or
sequence numbers in Apollo's key table `nvs_std`; the data dictionary `dic_std` names the key
type per field (pos.einh 13, pos.wgr 14, kpf.waehrung 7, kpf.art 250, kpf.art2 48,
kpf.rabatt_aktion 74, vrg.typ 69). German texts are language 2.

`kunden` (worker `build_kunden_bestellungen`) is not ported: it is a per-customer targeted
query, not a feed — the platform has no `kunden` import (REGISTRY in routers/uploads.py).
"""
from __future__ import annotations

import datetime as dt
import io
import os
from collections import Counter
from collections.abc import Callable

MANDANT = int(os.environ.get("APOLLO_MANDANT", "1"))
SPRACHE_DE = 2                       # nvs_sprache of the German texts


# ----------------------------------------------------------------- formatting
def de_datum(d) -> str:
    return d.strftime("%d.%m.%Y") if d else ""


def de_zeit(t) -> str:
    """Driver delivered datetime.time (whole seconds); the wire time is 'HH:MM:SS.hh'."""
    if not t:
        return ""
    if isinstance(t, str):
        return t[:8]
    return t.strftime("%H:%M:%S")


def de_zahl(x) -> str:
    return "" if x is None else f"{float(x):.4f}".rstrip("0").rstrip(".").replace(".", ",") or "0"


def de_zahl_leer(x) -> str:
    """Like de_zahl, but 0 stays empty (the 8D list shows no 0 quantities)."""
    return "" if not x else de_zahl(x)


def ganz(x) -> str:
    return "" if x is None else str(int(x))


def jn(x) -> str:
    return "J" if x else "N"


def text(s) -> str:
    """One cell: line breaks and tabs become spaces, as in the Apollo export (a memo line
    break CR LF shows as two spaces). Without this a tab inside a name shifts every following
    column and the platform cannot read the file."""
    if not s:
        return ""
    return str(s).replace("\r", " ").replace("\n", " ").replace("\t", " ")


def _zelle(f) -> str:
    """A cell with a quote is quoted and its quotes doubled, so the platform (pandas) reads
    back exactly the text stored in Apollo. The Apollo export is not consistent here: it
    sometimes keeps, sometimes drops the quotes of a memo stored as `"…"` (8D October 2026:
    8 texts differ, all of them quoted in Apollo itself)."""
    s = text("" if f is None else f)
    if '"' in s:
        s = '"' + s.replace('"', '""') + '"'
    return s


def tab_datei(header: list[str], zeilen: list[list[str]]) -> bytes:
    puffer = io.StringIO()
    puffer.write("\t".join(header) + "\r\n")
    for z in zeilen:
        puffer.write("\t".join(_zelle(f) for f in z) + "\r\n")
    return puffer.getvalue().encode("cp1252", errors="replace")


def xlsx_datei(header: list[str], zeilen: list[list[str]]) -> bytes:
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.append(header)
    for z in zeilen:
        ws.append([text(f) for f in z])
    puffer = io.BytesIO()
    wb.save(puffer)
    return puffer.getvalue()


def _ge(value, bound) -> bool:
    """SQL `value >= bound` (NULL never matches)."""
    return value is not None and value >= bound


def _id(x) -> int | None:
    """Join key of a record ID (doubles on the wire, 0 = no link)."""
    return int(x) if x else None


def arbeitstage(a: dt.date | None, b: dt.date | None) -> int | None:
    """Working days (Mon–Fri) from a to b, negative when b is earlier. Apollo's delivery
    reliability list counts the delay this way (730 of 734 positions in October 2026)."""
    if not a or not b:
        return None
    schritt = 1 if b >= a else -1
    tage, d = 0, a
    while d != b:
        d += dt.timedelta(days=schritt)
        if d.weekday() < 5:
            tage += schritt
    return tage


TYP_TEXT = {1: "AUF", 2: "ANG", 3: "BES", 5: "LS", 6: "RG", 7: "GS", 8: "WE"}

# pos_typ2 points to no table the server lists (no key table holds these IDs). Mapping by
# correlation with the extracts (ERKENNTNISSE.md): 337647 AV-P, 337648 AV-F, 337650 AB,
# 338094 OWB, 340358 AV-S. The platform does not use "Pos Typ 2" for any KPI
# (SERIENGESCHAEFT_POS_TYP_2 is empty); unknown IDs stay empty.
POS_TYP2_TEXT = {337647: "AV-P", 337648: "AV-F", 337650: "AB", 338094: "OWB", 340358: "AV-S"}

STATUS_8D = {0: "isignal_flag_red", 1: "isignal_flag_yellow", 2: "isignal_flag_blue",
             3: "isignal_flag_white", 4: "isignal_flag_green"}

# Key types (dic_std.dic_typ) of the code fields.
NVS_ME, NVS_WAEHRUNG, NVS_AA, NVS_TYP2, NVS_RAB_AKTION = 13, 7, 250, 48, 74


class Feeds:
    """All feeds over one source (live CachedSource or SQLite mirror)."""

    def __init__(self, source, mandant: int = MANDANT, heute: dt.date | None = None):
        self.src = source
        self.mandant = mandant
        self.heute = heute or dt.date.today()
        self._cache: dict[str, object] = {}

    # ---- lookups (each read once per run) --------------------------------------------
    def _einmal(self, name: str, bauen: Callable):
        if name not in self._cache:
            self._cache[name] = bauen()
        return self._cache[name]

    def _nvs(self) -> tuple[dict, dict]:
        """German code per record ID, and per (key type, Mandant, sequence number)."""
        def bauen():
            per_id, per_nr = {}, {}
            for nid, typ, sprache, nr, kenn, md in self.src.rows(
                    "nvs_std", ["nvs_id", "nvs_typ", "nvs_sprache", "nvs_nr", "nvs_kenn", "nvs_mandant"]):
                if sprache != SPRACHE_DE:
                    continue
                if nid:
                    per_id.setdefault(int(nid), kenn or "")
                if typ is not None and nr is not None:
                    per_nr.setdefault((int(typ), int(md or 0), int(nr)), kenn or "")
            return per_id, per_nr
        return self._einmal("nvs", bauen)

    def kenn_id(self, nvs_id) -> str:
        return self._nvs()[0].get(int(nvs_id), "") if nvs_id else ""

    def kenn_nr(self, typ: int, nr) -> str:
        if nr is None:
            return ""
        per_nr = self._nvs()[1]
        return per_nr.get((typ, self.mandant, int(nr)), per_nr.get((typ, 0, int(nr)), ""))

    def _adr(self) -> dict:
        """adr_id -> (number, name 1, name 2, name 3, city, postcode)."""
        return self._einmal("adr", lambda: {
            int(aid): (ganz(nr), n1 or "", n2 or "", n3 or "", ort or "", plz or "")
            for aid, nr, n1, n2, n3, ort, plz in self.src.rows(
                "adr_std", ["adr_id", "adr_nr", "adr_name1", "adr_name2", "adr_name3", "adr_ort", "adr_plz"])
            if aid})

    def adresse(self, adr_id) -> tuple[str, str, str, str, str, str]:
        return self._adr().get(_id(adr_id), ("", "", "", "", "", ""))

    def _stm(self) -> dict:
        """stm_id -> (article number, description 1, description 2, purchasing account)."""
        return self._einmal("stm", lambda: {
            int(sid): (art or "", b1 or "", b2 or "", konto)
            for sid, art, b1, b2, konto in self.src.rows(
                "stm_std", ["stm_id", "stm_artnr", "stm_bez1", "stm_bez2", "stm_konto_ek"])
            if sid})

    def artikel(self, stm_id) -> tuple[str, str, str, object]:
        return self._stm().get(_id(stm_id), ("", "", "", None))

    def _lookups(self, *namen: str) -> None:
        """Read the lookups a feed uses before its loop, so `needs()` (which runs every feed on
        an empty source) sees every table and column the feed can touch."""
        for n in namen:
            getattr(self, n)()

    def _kpf(self) -> dict:
        """kpf_id -> (number, type, date, address, Mandant, manual block, credit-limit block,
        currency) for the Mandant's documents. One map for all joins: kpf_std has 1.26 M rows,
        every further map over it costs ~100 MB."""
        return self._einmal("kpf", lambda: {
            int(kid): (nr, typ, datum, adr, md, sperre, sperrkz, waehrung)
            for kid, nr, typ, datum, adr, md, sperre, sperrkz, waehrung in self.src.rows(
                "kpf_std", ["kpf_id", "kpf_nr", "kpf_typ", "kpf_datum", "kpf_adr_id", "kpf_mandant",
                            "kpf_sperre", "kpf_sperrkz", "kpf_waehrung"])
            if kid and md == self.mandant})

    def _pos(self):
        """All position rows (pos_std is floored at Feeds.row_floor while streaming). A view on
        the cached rows, not a copy."""
        return self.src.rows("pos_std", self._POS_SPALTEN)

    _POS_SPALTEN = ["pos_id", "pos_kpf_id", "pos_typ", "pos_pos", "pos_unterpos", "pos_datum",
                    "pos_lief_datum", "pos_lief_wunsch", "pos_artnr", "pos_version", "pos_bez1",
                    "pos_menge", "pos_einh", "pos_status", "pos_preis", "pos_wert", "pos_typ2",
                    "pos_artnr_kd", "pos_menge_rest", "pos_vater_kpf_id", "pos_vater_pos_id",
                    "pos_stm_id", "pos_wgr"]
    _P = {c: i for i, c in enumerate(_POS_SPALTEN)}

    def _pos_pos(self) -> dict:
        """pos_id -> (position number, delivery date, requested date) of the order lines that
        delivery-note and receipt lines point to (only those, not all positions)."""
        P = self._P

        def bauen():
            eltern = {_id(r[P["pos_vater_pos_id"]]) for r in self._pos() if r[P["pos_typ"]] in (5, 8)}
            eltern.discard(None)
            return {int(r[P["pos_id"]]): (r[P["pos_pos"]], r[P["pos_lief_datum"]], r[P["pos_lief_wunsch"]])
                    for r in self._pos() if r[P["pos_id"]] and int(r[P["pos_id"]]) in eltern}
        return self._einmal("pos_pos", bauen)

    def _anz_pos(self) -> Counter:
        P = self._P
        return self._einmal("anz_pos", lambda: Counter(_id(r[P["pos_kpf_id"]]) for r in self._pos()))

    # ---- AswKpf document lists (header) ----------------------------------------------
    _ASWKPF = ["Typ", "Vorgang Nr.", "Datum", "Adr Nr.", "Name 1", "Name 2", "Name 3",
               "Ort", "Erfasst durch", "Geändert durch", "Anz Pos", "AA", "Typ 2",
               "Rab Aktion", "Wert", "eigene Währung", "Ges.Wert FW", "WAHR"]

    def _beleg_kopf(self, typen: tuple[int, ...], dateiname: str, von: dt.date):
        self._lookups("_adr", "_nvs")
        anz = self._anz_pos()
        zeilen = []
        for (kid, typ, nr, datum, adr, u_save, u_edit, art, art2, rab, waehr, wert, wert_f,
             md) in self.src.rows("kpf_std", ["kpf_id", "kpf_typ", "kpf_nr", "kpf_datum", "kpf_adr_id",
                                              "kpf_user_save", "kpf_user_edit", "kpf_art", "kpf_art2",
                                              "kpf_rabatt_aktion", "kpf_waehrung", "kpf_wert",
                                              "kpf_wert_f", "kpf_mandant"]):
            if typ not in typen or md != self.mandant or not _ge(datum, von):
                continue
            a_nr, n1, n2, n3, ort, _plz = self.adresse(adr)
            zeilen.append([
                TYP_TEXT.get(int(typ), str(typ)), ganz(nr), de_datum(datum), a_nr, n1, n2, n3, ort,
                u_save or "", u_edit or "", str(anz.get(_id(kid), 0)),
                self.kenn_nr(NVS_AA, art), self.kenn_nr(NVS_TYP2, art2) if art2 else "",
                self.kenn_nr(NVS_RAB_AKTION, rab) if rab else "",
                de_zahl(wert), "EUR", de_zahl(wert_f), self.kenn_nr(NVS_WAEHRUNG, waehr),
            ])
        return dateiname, tab_datei(self._ASWKPF, zeilen)

    def umsatz(self, von):     return self._beleg_kopf((6, 7), "AswKpf_RG.txt", von)
    def auftraege(self, von):  return self._beleg_kopf((1,), "AswKpf_AUF.txt", von)
    def angebote(self, von):   return self._beleg_kopf((2,), "AswKpf_ANG.txt", von)

    # ---- 8D --------------------------------------------------------------------------
    _8D = ["Nr.", "Datum", "Aussteller", "Teamleiter", "Teammitglieder", "Adress Nr.", "Adressen",
           "Artikel", "Bezeichnung", "Charge", "Menge", "akzeptierte Menge", "Vorgang", "Status",
           "Nr. extern", "akzeptiert", "abgelehnt", "akzeptiert am", "Bemerkung",
           *[f"Merkmal {i}" for i in range(1, 11)],
           "gelöscht", "Art", "Problembeschreibung", "Sofortmaßnahme", "Ursache",
           "Abschluss- datum am", "Abschluss durch"]

    def acht_d(self, von):
        self._lookups("_adr", "_stm")
        kpf = self._kpf()
        zeilen = []
        for (nr, datum, art, stm, adr, kid, status, menge, akz, gel, md, aussteller, leiter,
             team, ext, accept, accept_d, bemerk, abgelehnt, problem, sofort, ursache, abschl_d,
             abschl_v, *merkmale) in self.src.rows(
                "rek_std", ["rek_nr", "rek_datum", "rek_art", "rek_stm_id", "rek_adr_id", "rek_kpf_id",
                            "rek_status", "rek_menge", "rek_menge_akz", "rek_geloescht", "rek_mandant",
                            "rek_aussteller", "rek_teamleiter", "rek_teammitglieder", "rek_ext_nummer",
                            "rek_accept", "rek_accept_date", "rek_accept_bemerk", "rek_abgelehnt",
                            "rek_Problembeschreib", "rek_sofortmassnahme", "rek_fehlerursache",
                            "rek_abschluss_d", "rek_abschluss_v",
                            *[f"rek_kz_a{i:02d}" for i in range(1, 11)]]):
            if md != self.mandant or not _ge(datum, von):
                continue
            a_nr, name, *_ = self.adresse(adr)
            artnr, bez1, bez2, _konto = self.artikel(stm)
            vorgang = kpf.get(_id(kid))
            zeilen.append([
                ganz(nr), de_datum(datum), aussteller or "", leiter or "", team or "", a_nr, name,
                artnr, " ".join(b for b in (bez1, bez2) if b), "", de_zahl_leer(menge),
                de_zahl_leer(akz), ganz(vorgang[0]) if vorgang else "",
                STATUS_8D.get(int(status or 0), ""), ext or "", jn(accept), jn(abgelehnt),
                de_datum(accept_d), bemerk or "", *[m or "" for m in merkmale], jn(gel), art or "",
                problem or "", sofort or "", ursache or "", de_datum(abschl_d), abschl_v or "",
            ])
        return "8D.txt", tab_datei(self._8D, zeilen)

    # ---- Lagerpreise -----------------------------------------------------------------
    _LAGERPREISE = ["Artikelnr3", "Wert", "Preismenge", "Preiseinheit", "Bezeichnung 1"]

    def lagerpreise(self, von):  # master data, von unused (no reference export to compare)
        zeilen = [[art or "", de_zahl(sk), "1", "", bez or ""]
                  for art, sk, bez in self.src.rows("stm_std", ["stm_artnr", "stm_sk_kalk", "stm_bez1"])
                  if sk is not None and sk != 0]
        return "AswLagBew-Preiskonditionen.txt", tab_datei(self._LAGERPREISE, zeilen)

    # ---- Positionen (AUF / LS / WE) --------------------------------------------------
    _POS_HEADER = ["Typ", "Vorgang Nr.", "Pos", "UPos", "Datum", "Adr Nr.", "Name 1", "Ort",
                   "Artnr", "Version", "Bezeichnung 1", "Menge", "ME", "St", "Lieferdatum",
                   "Preis", "Pos Wert", "Pos Typ 2", "Fremdnr", "Sperre manuell", "Sperre K-Limit",
                   "Restmenge"]
    _LS_ZUSATZ = ["Auftrag", "Pos"]
    _WE_ZUSATZ = ["Bestellung", "Datum", "WGR", "EK Konto"]

    @staticmethod
    def _ist_gesperrt(stm_id, datum, sperr_map: dict) -> bool:
        """Article blocked and block date >= row date (as the ERP mask filters)."""
        sdate = sperr_map.get(_id(stm_id)) if stm_id else None
        if sdate is None:
            return False
        if datum is None:
            return True
        return sdate >= datum

    def _sperr_map(self, nur_mandant: bool) -> dict:
        return {int(sid): sdate for sid, sdate, md in
                self.src.rows("stm_std", ["stm_id", "stm_sperr_date", "stm_mandant"])
                if sid and (not nur_mandant or md == self.mandant)}

    def _positionen(self, typ_num: int, typ_text: str, von: dt.date) -> list[list[str]]:
        P = self._P
        self._lookups("_adr", "_stm", "_nvs")
        kpf, pos_pos = self._kpf(), self._pos_pos()
        # Blocked articles (stm_sperr_date set), as the Apollo lists filter them:
        # - delivery notes hide a line when the block date is on/after its delivery date
        #   (production worker rule; lines with an older block date are listed: 3 of 3);
        # - goods receipts hide every line of an article that has a block date at all
        #   (2 of 2 in Sept/Oct 2026, both with block dates from 2021);
        # - order lines are not filtered.
        sperr = self._sperr_map(nur_mandant=True) if typ_text in ("LS", "WE") else {}
        zeilen = []
        for r in self._pos():
            if r[P["pos_typ"]] != typ_num or not _ge(r[P["pos_datum"]], von):
                continue
            kid = _id(r[P["pos_kpf_id"]])
            if kid not in kpf:                       # document of another Mandant / missing
                continue
            if typ_text == "LS" and self._ist_gesperrt(r[P["pos_stm_id"]], r[P["pos_lief_datum"]], sperr):
                continue
            if typ_text == "WE" and sperr.get(_id(r[P["pos_stm_id"]])) is not None:
                continue
            nr, _typ, _datum, adr, _md, manuell, klimit, _w = kpf[kid]
            a_nr, name, _n2, _n3, ort, _plz = self.adresse(adr)
            artnr = r[P["pos_artnr"]] or (self.artikel(r[P["pos_stm_id"]])[0] if typ_text == "WE" else "")
            typ2 = r[P["pos_typ2"]]
            z = [typ_text, ganz(nr), ganz(r[P["pos_pos"]]), ganz(r[P["pos_unterpos"]] or 0),
                 de_datum(r[P["pos_datum"]]), a_nr, name, ort, artnr or "", r[P["pos_version"]] or "",
                 r[P["pos_bez1"]] or "", de_zahl(r[P["pos_menge"]]), self.kenn_nr(NVS_ME, r[P["pos_einh"]]),
                 ganz(r[P["pos_status"]]), de_datum(r[P["pos_lief_datum"]]), de_zahl(r[P["pos_preis"]]),
                 de_zahl(r[P["pos_wert"]]), POS_TYP2_TEXT.get(int(typ2), "") if typ2 else "",
                 r[P["pos_artnr_kd"]] or "", jn(manuell), ganz(klimit or 0),
                 de_zahl(r[P["pos_menge_rest"]])]
            vater = kpf.get(_id(r[P["pos_vater_kpf_id"]]))
            if typ_text == "LS":
                vpos = pos_pos.get(_id(r[P["pos_vater_pos_id"]]))
                z += [ganz(vater[0]) if vater else "", ganz(vpos[0]) if vpos else ""]
            elif typ_text == "WE":
                z += [ganz(vater[0]) if vater else "0", de_datum(vater[2]) if vater else "",
                      self.kenn_id(r[P["pos_wgr"]]), ganz(self.artikel(r[P["pos_stm_id"]])[3])]
            zeilen.append(z)
        return zeilen

    def auftragspositionen(self, von):
        return "AswKpf_AUF.txt", tab_datei(self._POS_HEADER, self._positionen(1, "AUF", von))

    def lieferscheine(self, von):  # Excel
        return "AswKpf_LS.xlsx", xlsx_datei(self._POS_HEADER + self._LS_ZUSATZ,
                                            self._positionen(5, "LS", von))

    def wareneingaenge(self, von):
        return "AswKpf_WE.txt", tab_datei(self._POS_HEADER + self._WE_ZUSATZ,
                                          self._positionen(8, "WE", von))

    def materialpreise(self, von):  # same WE file, own target import
        return self.wareneingaenge(von)

    # ---- Lagerbewegungen -------------------------------------------------------------
    _LAGBEW = ["Artikelnr", "Bezeichnung 1", "BuchDatum", "Zeit", "Bewegungsmenge",
               "Charge", "BuchTyp", "Kommentar", "QS", "Buchungsgrund", "Benutzer"]

    def lagerbewegungen(self, von):
        self._lookups("_stm")
        sperr = self._sperr_map(nur_mandant=False)
        zeilen = []
        # Kommentar stays empty: the Apollo list composes it from the booking document
        # ("LS <Nr>  <Text> <Kunde> RG <Nr>  /0000"); bestand_kommentar holds
        # internal markers instead ("$ProMldSave:…"). No KPI reads it.
        for stm, datum, zeit, delta, charge, vtyp, grund, user, md in self.src.rows(
                "bestand_std", ["bestand_stm_id", "bestand_datum", "bestand_zeit", "bestand_delta",
                                "bestand_charge", "bestand_vater_typ", "bestand_grund",
                                "bestand_user", "bestand_mandant"]):
            if md != self.mandant or not _ge(datum, von):
                continue
            if self._ist_gesperrt(stm, datum, sperr):
                continue                        # the mask hides blocked articles
            artnr, bez1, _b2, _k = self.artikel(stm)
            zeilen.append([artnr, bez1, de_datum(datum), de_zeit(zeit), de_zahl(delta), charge or "",
                           vtyp or "", "", "", grund or "", user or ""])
        return "AswLagBew.txt", tab_datei(self._LAGBEW, zeilen)

    # ---- Prüfungen (AswQs2151) -------------------------------------------------------
    _QS = ["Datum", "Zeit", "Benutzer", "FA", "Artikel", "Bezeichnung",
           "Buchungs-Menge", "Ausschuss-Menge", "RSC", "Produktgruppe", "Typ"]

    def pruefungen(self, von):  # no reference export to compare yet
        """Artikel/Bezeichnung = FA product (meld_fa -> fa_std.fa_stm_id -> stm_std),
        RSC = article of the message (meld_stm_id), Benutzer = meld_user."""
        self._lookups("_stm")
        fa_prod = {int(fid): pid for fid, pid in self.src.rows("fa_std", ["fa_id", "fa_stm_id"]) if fid and pid}
        zeilen = []
        for datum, zeit, user, fa, stm_id, menge, md in self.src.rows(
                "meld_std", ["meld_datum_buch", "meld_zeit_buch", "meld_user", "meld_fa",
                             "meld_stm_id", "meld_menge", "meld_mandant"]):
            if md != self.mandant or not _ge(datum, von):
                continue
            p_art, p_bez, _b2, _k = self.artikel(fa_prod.get(_id(fa)))
            rsc_art = self.artikel(stm_id)[0]
            zeilen.append([de_datum(datum), de_zeit(zeit), user or "", ganz(fa), p_art,
                           p_bez, de_zahl(menge), "", rsc_art, "", ""])
        return "AswQs2151.txt", tab_datei(self._QS, zeilen)

    # ---- Liefertreue Einkauf ---------------------------------------------------------
    _LIEFERTREUE = ["Auftrag", "Pos", "UPos", "Kunde", "LS-Nr", "LS-Pos", "LS-Upos",
                    "Lieferdatum", "Wunschdatum", "geliefert", "Verzug (Tage)", "Artikel",
                    "Bezeichnung", "ME", "Menge", "Wert", "Währung", "Kundennummer", "PLZ"]

    def liefertreue(self, von):
        """Purchasing delivery reliability: one row per goods-receipt line (WE, type 8) with
        the purchase-order line it books (pos_vater_pos_id, order header type 3).
        Lieferdatum = requested date of the order line, else its delivery date; Verzug =
        working days from Lieferdatum to the receipt (`geliefert` = receipt date). Receipts
        without an order: Auftrag 0, Verzug 0.

        Window: receipts of the current year (from 1 January, at most back to `von`), like
        the Apollo list the platform was fed with. The platform keeps one row per order line
        (Auftrag/Pos/UPos, first row in the file); with last year's receipts in the file an
        order line delivered in both years would count with its old receipt and drop out of
        this year's figures (October 2026: 5 order lines)."""
        P = self._P
        self._lookups("_adr", "_nvs")
        von = max(von, dt.date(self.heute.year, 1, 1))
        kpf, pos_pos = self._kpf(), self._pos_pos()
        sperr = self._sperr_map(nur_mandant=True)   # as the receipt list: blocked articles hidden
        zeilen = []
        for r in self._pos():
            if r[P["pos_typ"]] != 8 or sperr.get(_id(r[P["pos_stm_id"]])) is not None:
                continue
            kid = _id(r[P["pos_kpf_id"]])
            we = kpf.get(kid)
            if not we or not _ge(we[2], von):
                continue
            we_nr, _t, geliefert, adr, _md, _s, _k, waehrung = we
            a_nr, name, _n2, _n3, _ort, plz = self.adresse(adr)
            vater = kpf.get(_id(r[P["pos_vater_kpf_id"]]))
            vpos = pos_pos.get(_id(r[P["pos_vater_pos_id"]]))
            if vater and vpos:
                v_pos, v_lief, v_wunsch = vpos
                lieferdatum = v_wunsch or v_lief
                verzug = arbeitstage(lieferdatum, geliefert)
                auftrag, pos, wunsch = ganz(vater[0]), ganz(v_pos), v_wunsch
            else:
                lieferdatum, verzug, auftrag, pos, wunsch = None, 0, "0", "0", None
            menge = r[P["pos_menge"]]
            zeilen.append([
                auftrag, pos, ganz(r[P["pos_unterpos"]] or 0), name, ganz(we_nr), ganz(r[P["pos_pos"]]),
                ganz(r[P["pos_unterpos"]] or 0), de_datum(lieferdatum), de_datum(wunsch),
                de_datum(geliefert), str(verzug if verzug is not None else 0), r[P["pos_artnr"]] or "",
                r[P["pos_bez1"]] or "", self.kenn_nr(NVS_ME, r[P["pos_einh"]]),
                de_zahl(None if menge is None else round(menge, 2)),     # the list shows 2 decimals
                de_zahl(r[P["pos_wert"]]), self.kenn_nr(NVS_WAEHRUNG, waehrung), a_nr, plz,
            ])
        # Sorted like the Apollo list (receipt number, line, sub-line). Several receipts of one
        # order line share the platform key Auftrag/Pos/UPos; the parser keeps the first, so
        # the order decides which receipt counts — as with the Apollo file, the earliest.
        zeilen.sort(key=lambda z: (int(z[4] or 0), int(z[5] or 0), int(z[6] or 0)))
        return "dev_excel_Liefertreue_Einkauf.txt", tab_datei(self._LIEFERTREUE, zeilen)

    # ---- Kontakte --------------------------------------------------------------------
    _KONTAKTE = ["Datum", "Zeit", "W-Vorlage", "Ansprechpartner", "Art", "Typ", "St",
                 "Mitarbeiter", "Name 1", "Ort", "Erf. Datum", "Erf. Benutzer",
                 "Textfeld", "Typ", "Vorgang Nr.", "Wert"]

    def kontakte(self, von):
        self._lookups("_adr", "_nvs")
        zeilen = []
        for (datum, zeit, ansp, vtyp, vart, status, mit, aid, erf_dat, erf_usr, memo,
             kpf_typ, kpf_nr, md) in self.src.rows(
                "vrg_std", ["vrg_datum", "vrg_zeit", "vrg_ansprech", "vrg_typ", "vrg_art", "vrg_status",
                            "vrg_mitarbeiter", "vrg_adr_id", "vrg_datum_save", "vrg_user_save",
                            "vrg_memo", "vrg_kpf_typ", "vrg_kpf_nr", "vrg_mandant"]):
            if md != self.mandant or not _ge(datum, von):
                continue
            _nr, name, _n2, _n3, ort, _plz = self.adresse(aid)
            zeilen.append([
                de_datum(datum), de_zeit(zeit), "", ansp or "", self.kenn_id(vart), self.kenn_id(vtyp),
                ganz(status), (mit or "").upper(), name, ort, de_datum(erf_dat), erf_usr or "",
                memo or "", TYP_TEXT.get(int(kpf_typ), "") if kpf_typ else "", ganz(kpf_nr), "",
            ])
        return "Kontakte.txt", tab_datei(self._KONTAKTE, zeilen)

    # ---- Interessenten ---------------------------------------------------------------
    _INTERESSENTEN = ["Adress-Nr.", "Name 1", "Datum Save"]

    def interessenten(self, von):  # master data, von unused
        """Prospects (adr_typ 8) of the Mandant; deleted addresses are not in Apollo's list
        (October 2026: 1,876 = 1,876 numbers, the 69 deleted ones left out)."""
        zeilen = [[ganz(nr), name or "", de_datum(ds)]
                  for nr, name, ds, typ, geloescht, md in self.src.rows(
                      "adr_std", ["adr_nr", "adr_name1", "adr_datum_save", "adr_typ", "adr_geloescht", "adr_mandant"])
                  if typ == 8 and not geloescht and md == self.mandant]
        return "dev_excel_INT.txt", tab_datei(self._INTERESSENTEN, zeilen)

    # ---- row floor (memory) ----------------------------------------------------------
    @staticmethod
    def _auf_von(von: dt.date) -> dt.date:
        return dt.date(von.year - 2, von.month, 1)

    @classmethod
    def row_floor(cls, von: dt.date) -> dict[str, tuple[str, dt.date]]:
        """Per table the weakest date filter of ALL its readers: rows below it are never used,
        so the run does not keep them (pos_std/meld_std/bestand_std have millions of rows).
        Tables read without a date filter (kpf_std, stm_std, adr_std, fa_std, nvs_std — join
        sides) must not appear here. Proven by the equivalence test on the live path."""
        return {
            "pos_std": ("pos_datum", cls._auf_von(von)),   # order lines of receipts/deliveries look back 2 years
            "meld_std": ("meld_datum_buch", von),
            "bestand_std": ("bestand_datum", von),
            "vrg_std": ("vrg_datum", von),
            "rek_std": ("rek_datum", von),
        }

    # ---- registry --------------------------------------------------------------------
    def builders(self) -> dict[str, Callable]:
        return {
            "umsatz": self.umsatz, "auftraege": self.auftraege, "angebote": self.angebote,
            "auftragspositionen": self.auftragspositionen, "lieferscheine": self.lieferscheine,
            "wareneingaenge": self.wareneingaenge, "materialpreise": self.materialpreise,
            "acht_d": self.acht_d, "pruefungen": self.pruefungen,
            "lagerbewegungen": self.lagerbewegungen, "lagerpreise": self.lagerpreise,
            "liefertreue": self.liefertreue, "kontakte": self.kontakte,
            "interessenten": self.interessenten,
        }


ARTEN = tuple(Feeds(None).builders())


class _Recorder:
    """Source that only records which columns of which table a feed reads."""

    def __init__(self):
        self.requested: dict[str, set[str]] = {}

    def rows(self, table: str, columns: list[str]) -> list[tuple]:
        self.requested.setdefault(table, set()).update(columns)
        return []


def needs(arten) -> dict[str, list[str]]:
    """Exactly the columns the given feeds read, per table — derived from the feed code itself
    (no hand-kept list that could drift). A run reads each table once with this union and
    nothing more."""
    rec = _Recorder()
    feeds = Feeds(rec).builders()
    for art in arten:
        try:
            feeds[art](dt.date(2000, 1, 1))
        except ImportError:          # file writer dependency (openpyxl) — reads happened already
            pass
    return {t: sorted(c) for t, c in sorted(rec.requested.items())}
