"""The 14 platform feeds ("Arten"), ported 1:1 from odbc-worker/worker.py on `main`.

Only the data source changes: instead of SQL through the Windows driver every feed reads
projections via `source.rows(table, columns)` and applies the former WHERE/JOIN locally with
the driver's semantics (NULL never matches a comparison, keys built with str() of the
driver's Python types). The produced files are byte-for-byte the format the platform parser
expects (`services/compute/app/parsing/*.py`).

Status per feed as in the old worker README: ✅ confirmed, 🟡 format derived from the parser.

`kunden` (worker `build_kunden_bestellungen`) is not ported: it is a per-customer targeted
query, not a feed — the platform has no `kunden` import (REGISTRY in routers/uploads.py).
"""
from __future__ import annotations

import datetime as dt
import io
import os
from collections.abc import Callable

MANDANT = int(os.environ.get("APOLLO_MANDANT", "1"))


# ----------------------------------------------------------------- formatting (unchanged)
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


def _ge(value, bound) -> bool:
    """SQL `value >= bound` (NULL never matches)."""
    return value is not None and value >= bound


TYP_TEXT = {1: "AUF", 2: "ANG", 5: "LS", 6: "RG", 7: "GS", 8: "WE"}

VRG_TYP_TEXT = {
    "340521": "ERS", "335768": "TEL", "338224": "EMAIL", "338281": "MESSE",
    "338266": "ORT", "347568": "ONL", "347559": "ANFR", "347566": "REFURB",
    "347567": "EPA", "348301": "BELT", "347570": "CARG", "347569": "INHOUS",
    "347753": "EINLAD", "348314": "AIXREL",
}


class Feeds:
    """All feeds over one source (live CachedSource or SQLite mirror)."""

    def __init__(self, source, mandant: int = MANDANT):
        self.src = source
        self.mandant = mandant
        self._stm: dict | None = None

    def stm_artnr(self) -> dict:
        if self._stm is None:
            self._stm = {str(sid): art for sid, art in self.src.rows("stm_std", ["stm_id", "stm_artnr"])}
        return self._stm

    # ---- AswKpf-Belegexport (Kopf) --------------------------------------------------
    _ASWKPF = ["Typ", "Vorgang Nr.", "Datum", "Adr Nr.", "Name 1", "Name 2", "Name 3",
               "Ort", "Erfasst durch", "Geändert durch", "Anz Pos", "AA", "Typ 2",
               "Rab Aktion", "Wert", "eigene Währung", "Ges.Wert FW", "WAHR"]

    def _beleg_kopf(self, typen: tuple[int, ...], dateiname: str, von: dt.date):
        zeilen = []
        for typ, nr, datum, adr, user, wert, wert_f, md in self.src.rows(
                "kpf_std", ["kpf_typ", "kpf_nr", "kpf_datum", "kpf_adr_id", "kpf_user_save",
                            "kpf_wert", "kpf_wert_f", "kpf_mandant"]):
            if typ not in typen or md != self.mandant or not _ge(datum, von):
                continue
            z = [""] * len(self._ASWKPF)
            z[0] = TYP_TEXT.get(int(typ), str(typ))
            z[1] = ganz(nr)
            z[2] = de_datum(datum)
            z[3] = ganz(adr)
            z[8] = user or ""
            z[14] = de_zahl(wert)
            z[16] = de_zahl(wert_f)
            zeilen.append(z)
        return dateiname, tab_datei(self._ASWKPF, zeilen)

    def umsatz(self, von):     return self._beleg_kopf((6, 7), "AswKpf_RG.txt", von)   # ✅
    def auftraege(self, von):  return self._beleg_kopf((1,), "AswKpf_AUF.txt", von)    # ✅
    def angebote(self, von):   return self._beleg_kopf((2,), "AswKpf_ANG.txt", von)    # ✅

    # ---- 8D --------------------------------------------------------------------------
    _8D = ["Nr.", "Datum", "Art", "Artikel", "Adressen", "Adress Nr.", "Bezeichnung",
           "Status", "Menge", "akzeptierte Menge", "gelöscht"]

    def acht_d(self, von):  # ✅
        artnr = self.stm_artnr()
        zeilen = []
        for nr, datum, art, stm, adr, status, menge, akz, gel, md in self.src.rows(
                "rek_std", ["rek_nr", "rek_datum", "rek_art", "rek_stm_id", "rek_adr_id", "rek_status",
                            "rek_menge", "rek_menge_akz", "rek_geloescht", "rek_mandant"]):
            if md != self.mandant or not _ge(datum, von):
                continue
            zeilen.append([
                ganz(nr), de_datum(datum), art or "", artnr.get(str(stm), ""), "",
                ganz(adr), "", ganz(status), de_zahl(menge), de_zahl(akz),
                "J" if gel else "",
            ])
        return "8D.txt", tab_datei(self._8D, zeilen)

    # ---- Lagerpreise -----------------------------------------------------------------
    _LAGERPREISE = ["Artikelnr3", "Wert", "Preismenge", "Preiseinheit", "Bezeichnung 1"]

    def lagerpreise(self, von):  # ✅ (master data, von unused)
        zeilen = [[art or "", de_zahl(sk), "1", "", bez or ""]
                  for art, sk, bez in self.src.rows("stm_std", ["stm_artnr", "stm_sk_kalk", "stm_bez1"])
                  if sk is not None and sk != 0]
        return "AswLagBew-Preiskonditionen.txt", tab_datei(self._LAGERPREISE, zeilen)

    # ---- Positionen ------------------------------------------------------------------
    _POS_HEADER = ["Typ", "Vorgang Nr.", "Pos", "UPos", "Datum", "Adr Nr.", "Name 1", "Ort",
                   "Artnr", "Version", "Bezeichnung 1", "Menge", "ME", "St", "Lieferdatum",
                   "Preis", "Pos Wert", "Pos Typ 2", "Fremdnr", "Auftrag", "Bestellung",
                   "WGR", "EK Konto"]

    def _kpf_join(self) -> dict:
        """kpf_id -> [(kpf_nr, kpf_adr_id), ...] for k.kpf_mandant = MANDANT (inner-join side)."""
        out: dict = {}
        for kid, knr, kadr, md in self.src.rows("kpf_std", ["kpf_id", "kpf_nr", "kpf_adr_id", "kpf_mandant"]):
            if md == self.mandant:
                out.setdefault(kid, []).append((knr, kadr))
        return out

    @staticmethod
    def _ist_gesperrt(stm_id, datum, sperr_map: dict) -> bool:
        """Article blocked and block date >= row date (as the ERP mask filters)."""
        sdate = sperr_map.get(str(stm_id)) if stm_id else None
        if sdate is None:
            return False
        if datum is None:
            return True
        return sdate >= datum

    def _positionen(self, typ_num: int, typ_text: str, von: dt.date):
        """Lookups are read unconditionally (the worker skips them when no row needs them —
        same result, and `needs()` sees every column the feed may read)."""
        kpf = self._kpf_join()
        rows = []
        for (kid, pos, datum, lief, artnr, menge, status, preis, wert, typ2, vater, ptyp,
             stm_id, unterpos) in self.src.rows(
                "pos_std", ["pos_kpf_id", "pos_pos", "pos_datum", "pos_lief_datum", "pos_artnr",
                            "pos_menge", "pos_status", "pos_preis", "pos_wert", "pos_typ2",
                            "pos_vater_kpf_id", "pos_typ", "pos_stm_id", "pos_unterpos"]):
            if ptyp != typ_num or not _ge(datum, von):
                continue
            for nr, aid in kpf.get(kid, ()):
                rows.append((nr, pos, datum, lief, artnr, menge, status, preis, wert, typ2, vater,
                             aid, stm_id, unterpos))
        vater_ids = {str(r[10]) for r in rows if r[10]}
        vater_nr: dict[str, str] = {}
        for kid, knr, md in self.src.rows("kpf_std", ["kpf_id", "kpf_nr", "kpf_mandant"]):
            if md == self.mandant and str(kid) in vater_ids:
                vater_nr[str(kid)] = ganz(knr)
        adr_ids = {str(r[11]) for r in rows if r[11]}
        adr_data: dict[str, tuple[str, str, str]] = {}
        for aid, anr, name, ort in self.src.rows("adr_std", ["adr_id", "adr_nr", "adr_name1", "adr_ort"]):
            if str(aid) in adr_ids:
                adr_data[str(aid)] = (ganz(anr), name or "", ort or "")
        if typ_text == "LS":
            # Production worker compares the block date with r[3] = pos_lief_datum (its docstring
            # says pos_datum) — reproduced as is, see PR notes.
            sperr_map = {str(sid): sdate for sid, sdate, md in
                         self.src.rows("stm_std", ["stm_id", "stm_sperr_date", "stm_mandant"])
                         if md == self.mandant}
            rows = [r for r in rows if not self._ist_gesperrt(r[12], r[3], sperr_map)]
        zeilen = []
        for nr, pos, datum, lief, artnr, menge, status, preis, wert, typ2, vater, aid, _stm, unterpos in rows:
            z = [""] * len(self._POS_HEADER)
            z[0] = typ_text
            z[1] = ganz(nr)
            z[2] = ganz(pos)
            z[3] = ganz(unterpos) if typ_text == "LS" else "0"
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

    def auftragspositionen(self, von):  # 🟡
        return "AswKpf_AUF.txt", tab_datei(self._POS_HEADER, self._positionen(1, "AUF", von))

    def lieferscheine(self, von):  # 🟡 — Excel
        return "AswKpf_LS.xlsx", xlsx_datei(self._POS_HEADER, self._positionen(5, "LS", von))

    def _wareneingang_zeilen(self, von: dt.date):
        artnr = self.stm_artnr()
        kpf = self._kpf_join()
        zeilen = []
        for kid, pos, datum, lief, stm, art, menge, preis, wert, wgr, ptyp in self.src.rows(
                "pos_std", ["pos_kpf_id", "pos_pos", "pos_datum", "pos_lief_datum", "pos_stm_id",
                            "pos_artnr", "pos_menge", "pos_preis", "pos_wert", "pos_wgr", "pos_typ"]):
            if ptyp != 8 or not _ge(datum, von):
                continue
            for nr, _aid in kpf.get(kid, ()):
                z = [""] * len(self._POS_HEADER)
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
                z[21] = ganz(wgr)
                zeilen.append(z)
        return zeilen

    def wareneingaenge(self, von):  # 🟡
        return "AswKpf_WE.txt", tab_datei(self._POS_HEADER, self._wareneingang_zeilen(von))

    def materialpreise(self, von):  # 🟡 — same WE file, own target import
        return "AswKpf_WE.txt", tab_datei(self._POS_HEADER, self._wareneingang_zeilen(von))

    # ---- Lagerbewegungen -------------------------------------------------------------
    _LAGBEW = ["Artikelnr", "Bezeichnung 1", "BuchDatum", "Zeit", "Bewegungsmenge",
               "Charge", "BuchTyp", "Kommentar", "QS", "Buchungsgrund", "Benutzer"]

    def lagerbewegungen(self, von):  # 🟡
        artnr = self.stm_artnr()
        sperr_map = {str(sid): sdate for sid, sdate in self.src.rows("stm_std", ["stm_id", "stm_sperr_date"])}
        zeilen = []
        for stm, datum, zeit, delta, charge, vtyp, grund, md in self.src.rows(
                "bestand_std", ["bestand_stm_id", "bestand_datum", "bestand_zeit", "bestand_delta",
                                "bestand_charge", "bestand_vater_typ", "bestand_grund", "bestand_mandant"]):
            if md != self.mandant or not _ge(datum, von):
                continue
            if self._ist_gesperrt(stm, datum, sperr_map):
                continue                        # the mask hides blocked articles
            zeilen.append([
                artnr.get(str(stm), ""), "", de_datum(datum), de_zeit(zeit),
                de_zahl(delta), charge or "", vtyp or "", "", "", grund or "", "",
            ])
        return "AswLagBew.txt", tab_datei(self._LAGBEW, zeilen)

    # ---- Prüfungen (AswQs2151) -------------------------------------------------------
    _QS = ["Datum", "Zeit", "Benutzer", "FA", "Artikel", "Bezeichnung",
           "Buchungs-Menge", "Ausschuss-Menge", "RSC", "Produktgruppe", "Typ"]

    def pruefungen(self, von):  # 🟡
        """Artikel/Bezeichnung = FA product (meld_fa -> fa_std.fa_stm_id -> stm_std),
        RSC = article of the message (meld_stm_id), Benutzer = meld_user."""
        stm = {str(sid): (art or "", bez or "")
               for sid, art, bez in self.src.rows("stm_std", ["stm_id", "stm_artnr", "stm_bez1"])}
        fa_prod = {str(fid): str(pid) for fid, pid in self.src.rows("fa_std", ["fa_id", "fa_stm_id"]) if pid}
        zeilen = []
        for datum, zeit, user, fa, stm_id, menge, md in self.src.rows(
                "meld_std", ["meld_datum_buch", "meld_zeit_buch", "meld_user", "meld_fa",
                             "meld_stm_id", "meld_menge", "meld_mandant"]):
            if md != self.mandant or not _ge(datum, von):
                continue
            p_art, p_bez = stm.get(fa_prod.get(str(fa), ""), ("", ""))
            rsc_art, _ = stm.get(str(stm_id), ("", ""))
            zeilen.append([
                de_datum(datum), de_zeit(zeit), user or "", ganz(fa), p_art,
                p_bez, de_zahl(menge), "", rsc_art, "", "",
            ])
        return "AswQs2151.txt", tab_datei(self._QS, zeilen)

    # ---- Liefertreue -----------------------------------------------------------------
    _LIEFERTREUE = ["Auftrag", "Pos", "UPos", "Kundennummer", "Kunde", "geliefert",
                    "Lieferdatum", "Wunschdatum", "Verzug (Tage)", "Menge", "ME",
                    "Artikel", "Bezeichnung"]

    @staticmethod
    def _arbeitstage(a, b) -> int | None:
        if not a or not b:
            return None
        schritt = 1 if b >= a else -1
        tage, d = 0, a
        while d != b:
            d += dt.timedelta(days=schritt)
            if d.weekday() < 5:
                tage += schritt
        return tage

    def liefertreue(self, von):  # 🟡
        auf_von = self._auf_von(von)
        kpf = self.src.rows("kpf_std", ["kpf_id", "kpf_nr", "kpf_adr_id", "kpf_typ", "kpf_mandant", "kpf_datum"])
        auf = {str(kid): (ganz(nr), str(adr)) for kid, nr, adr, typ, md, d in kpf
               if typ == 1 and md == self.mandant and _ge(d, auf_von)}
        aufpos = {}
        pos = self.src.rows("pos_std", ["pos_id", "pos_lief_datum", "pos_lief_wunsch", "pos_typ",
                                        "pos_mandant", "pos_datum", "pos_kpf_id", "pos_pos",
                                        "pos_vater_kpf_id", "pos_vater_pos_id", "pos_artnr",
                                        "pos_menge", "pos_einh"])
        for pid, lief, wun, typ, md, d, *_ in pos:
            if typ == 1 and md == self.mandant and _ge(d, auf_von):
                aufpos[str(pid)] = (lief, wun)
        adr = {str(aid): (ganz(nr), name or "") for aid, nr, name in
               self.src.rows("adr_std", ["adr_id", "adr_nr", "adr_name1"])}
        ls_datum = {str(kid): d for kid, nr, adr_, typ, md, d in kpf
                    if typ == 5 and md == self.mandant and _ge(d, von)}
        zeilen = []
        for _pid, _l, _w, typ, md, d, ls_kpf, p_pos, vkpf, vpos, art, menge, einh in pos:
            if typ != 5 or md != self.mandant or not _ge(d, von):
                continue
            geliefert = ls_datum.get(str(ls_kpf))
            auftrag_nr, adr_id = auf.get(str(vkpf), ("", ""))
            lief, wun = aufpos.get(str(vpos), (None, None))
            verzug = self._arbeitstage(lief, geliefert)
            if verzug is None:
                verzug = 0
            adr_nr, adr_name = adr.get(adr_id, ("", ""))
            zeilen.append([
                auftrag_nr, ganz(p_pos), "0", adr_nr, adr_name, de_datum(geliefert),
                de_datum(lief), de_datum(wun), str(verzug), de_zahl(menge),
                ganz(einh), art or "", "",
            ])
        return "dev_excel_Liefertreue_Einkauf.txt", tab_datei(self._LIEFERTREUE, zeilen)

    # ---- Kontakte --------------------------------------------------------------------
    _KONTAKTE = ["Datum", "Zeit", "W-Vorlage", "Ansprechpartner", "Art", "Typ", "St",
                 "Mitarbeiter", "Name 1", "Ort", "Erf. Datum", "Erf. Benutzer",
                 "Textfeld", "Typ", "Vorgang Nr.", "Wert"]

    def kontakte(self, von):  # ✅
        adr = {str(aid): (name or "", ort or "") for aid, name, ort in
               self.src.rows("adr_std", ["adr_id", "adr_name1", "adr_ort"])}
        zeilen = []
        for (datum, zeit, ansp, vtyp, status, mit, aid, erf_dat, erf_usr, text,
             kpf_typ, kpf_nr, md) in self.src.rows(
                "vrg_std", ["vrg_datum", "vrg_zeit", "vrg_ansprech", "vrg_typ", "vrg_status",
                            "vrg_mitarbeiter", "vrg_adr_id", "vrg_datum_save", "vrg_user_save",
                            "vrg_text1", "vrg_kpf_typ", "vrg_kpf_nr", "vrg_mandant"]):
            if md != self.mandant or not _ge(datum, von):
                continue
            name, ort = adr.get(str(aid), ("", ""))
            kontaktart = VRG_TYP_TEXT.get(ganz(vtyp), "")
            erp = TYP_TEXT.get(int(kpf_typ), "") if kpf_typ else ""
            zeilen.append([
                de_datum(datum), de_zeit(zeit), "", ansp or "", "", kontaktart,
                ganz(status), (mit or "").upper(), name, ort, de_datum(erf_dat),
                erf_usr or "", text or "", erp, ganz(kpf_nr), "",
            ])
        return "Kontakte.txt", tab_datei(self._KONTAKTE, zeilen)

    # ---- Interessenten ---------------------------------------------------------------
    _INTERESSENTEN = ["Adress-Nr.", "Name 1", "Datum Save"]

    def interessenten(self, von):  # ✅ (master data, von unused)
        zeilen = [[ganz(nr), name or "", de_datum(ds)]
                  for nr, name, ds, typ in self.src.rows("adr_std", ["adr_nr", "adr_name1", "adr_datum_save", "adr_typ"])
                  if typ == 8]
        return "dev_excel_INT.txt", tab_datei(self._INTERESSENTEN, zeilen)

    # ---- row floor (memory) ----------------------------------------------------------
    @staticmethod
    def _auf_von(von: dt.date) -> dt.date:
        return dt.date(von.year - 2, von.month, 1)

    @classmethod
    def row_floor(cls, von: dt.date) -> dict[str, tuple[str, dt.date]]:
        """Per table the weakest date filter of ALL its readers: rows below it are never used,
        so the run does not keep them (pos_std/meld_std/bestand_std have millions of rows).
        Tables read without a date filter (kpf_std, stm_std, adr_std, fa_std — join sides)
        must not appear here. Proven by the equivalence test on the live path."""
        return {
            "pos_std": ("pos_datum", cls._auf_von(von)),   # liefertreue looks back 2 years; others >= von
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
