"""Apollo-Listen gegen apollo-sync-Lieferungen, Feld für Feld — ohne Plattform-Datenbank.

Beide Seiten werden mit den Parsern der Plattform gelesen (`services/compute/app/parsing`), so wie
ein Upload sie sähe, und je Schlüssel verglichen; nur im Zeitraum, den die Apollo-Liste abdeckt
(frühestes Datum der Liste bis `--bis`). Keine Geschäftsdaten im Bericht außer den Schlüsseln der
ersten abweichenden Zeilen.

    python -m apollo_sync feed --alle --dry-run --out lieferungen/
    python tools/extrakt_abgleich.py --extrakte "Z:/.../Rohdaten/Oktober_26" --lieferungen lieferungen/ --bis 2026-10-31

Bekannte Abweichungen, die kein Fehler von apollo-sync sind (docs/FEEDS.md): Belege, die nach dem
Export der Liste geändert wurden; die Lieferschein-Excel aus Apollo (echte Datums-/Zahlzellen liest
der Plattform-Parser falsch, darum hier ohne Datumsfenster und ohne Datumsfelder); Anführungszeichen
in 8D-Texten.
"""
from __future__ import annotations

import argparse
import collections
import datetime as dt
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# Art: (Parser, Apollo-Datei, apollo-sync-Datei, Schlüssel, Datumsfeld)
ARTEN = {
    "umsatz": ("vertrieb.parse_umsatz", "AswKpf_RG.txt", "umsatz_AswKpf_RG.txt", ("vorgang_nr",), "datum"),
    "auftraege": ("vertrieb.parse_auftraege", "AswKpf_AUF.txt", "auftraege_AswKpf_AUF.txt", ("vorgang_nr",), "datum"),
    "angebote": ("aktivitaet.parse_angebote", "AswKpf_ANG.txt", "angebote_AswKpf_ANG.txt", ("vorgang_nr",), "datum"),
    "kontakte": ("aktivitaet.parse_kontakte", "Kontakte.txt", "kontakte_Kontakte.txt", None, "contact_date"),
    "acht_d": ("qualitaet.parse_8d", "8D.txt", "acht_d_8D.txt", ("report_nr",), "report_date"),
    "lieferscheine": ("positionen.parse_lieferscheine", "AswKpf_LS_pos.xlsx", "lieferscheine_AswKpf_LS.xlsx",
                      ("vorgang_nr", "pos", "upos"), None),
    "wareneingaenge": ("positionen.parse_wareneingaenge", "AswKpf_WE_pos.txt", "wareneingaenge_AswKpf_WE.txt",
                       ("vorgang_nr", "pos", "upos"), "entry_date"),
    "auftragspositionen": ("positionen.parse_auftrag_positionen", "AswKpf_AUF_pos.txt",
                           "auftragspositionen_AswKpf_AUF.txt", ("vorgang_nr", "pos", "upos"), "entry_date"),
    "lagerbewegungen": ("material.parse_lagerbewegungen", "AswLagBew.txt", "lagerbewegungen_AswLagBew.txt",
                        None, "buch_datum"),
    "materialpreise": ("materialpreise.parse_materialpreise", "AswKpf_WE_pos.txt", "materialpreise_AswKpf_WE.txt",
                       ("vorgang_nr", "pos", "upos"), "datum"),
    "liefertreue": ("einkauf.parse_liefertreue", "dev_excel_Liefertreue_Einkauf.txt",
                    "liefertreue_dev_excel_Liefertreue_Einkauf.txt", ("auftrag", "pos", "upos"), "delivered_date"),
}
OHNE = {"lagerbewegungen": {"kommentar"}, "lieferscheine": {"entry_date", "delivery_date", "price", "position_value"}}


def _parser(name: str):
    sys.path.insert(0, str(ROOT / "services" / "compute"))
    modul, funktion = name.split(".")
    return getattr(__import__(f"app.parsing.{modul}", fromlist=[funktion]), funktion)


def _norm(v) -> str:
    if v is None:
        return ""
    if hasattr(v, "normalize"):
        try:
            return format(v.normalize(), "f")
        except Exception:
            pass
    return str(v).strip()


def _datei(ordner: Path, name: str) -> Path | None:
    for p in (ordner / name, ordner / f"_dryrun_{name}"):
        if p.exists():
            return p
    return None


def vergleiche(art: str, extrakte: Path, lieferungen: Path, bis: dt.date) -> list[str]:
    parser, fa, fb, schluessel, dfeld = ARTEN[art]
    pa, pb = _datei(extrakte, fa), _datei(lieferungen, fb)
    if not pa or not pb:
        return [f"## {art}\n\nübersprungen: {'Apollo-Liste' if not pa else 'Lieferung'} fehlt\n"]
    parse = _parser(parser)
    ra, fehler_a = parse(pa.read_bytes())
    rb, fehler_b = parse(pb.read_bytes())
    if dfeld:
        # Beginn: das spätere der beiden frühesten Daten (die 8D-Liste reicht bis 2017 zurück,
        # die Lieferung nur bis zu ihrem `--von`)
        anfang = [min(d) for d in ([r[dfeld] for r in ra if r.get(dfeld)],
                                   [r[dfeld] for r in rb if r.get(dfeld)]) if d]
        von = max(anfang) if anfang else dt.date.min
        ra = [r for r in ra if r.get(dfeld) and von <= r[dfeld] <= bis]
        rb = [r for r in rb if r.get(dfeld) and von <= r[dfeld] <= bis]
        fenster = f"{von:%d.%m.%Y}–{bis:%d.%m.%Y}"
    else:
        fenster = "ganze Liste (Apollo-Daten nicht lesbar), apollo-sync auf die Schlüssel der Liste beschränkt"
    out = [f"## {art}\n", f"Zeitraum {fenster}; Zeilen Apollo {len(ra)}, apollo-sync {len(rb)}; "
                          f"Lesefehler Apollo {len(fehler_a)}, apollo-sync {len(fehler_b)}\n"]
    if not ra:
        return out
    felder = [f for f in ra[0] if f != "raw" and f not in OHNE.get(art, set())]
    if schluessel:
        ma = {tuple(_norm(r.get(k)) for k in schluessel): r for r in ra}
        mb = {tuple(_norm(r.get(k)) for k in schluessel): r for r in rb}
        if not dfeld:
            mb = {k: v for k, v in mb.items() if k in ma}
        beide = ma.keys() & mb.keys()
        out.append(f"Schlüssel: gemeinsam {len(beide)}, nur Apollo {len(ma.keys() - mb.keys())}, "
                   f"nur apollo-sync {len(mb.keys() - ma.keys())}\n")
        diff, beispiel = collections.Counter(), {}
        for k in sorted(beide):
            for f in felder:
                if _norm(ma[k].get(f)) != _norm(mb[k].get(f)):
                    diff[f] += 1
                    beispiel.setdefault(f, k)
        out += [f"- `{f}`: {n} von {len(beide)} abweichend (z. B. Schlüssel {beispiel[f]})" for f, n in diff.most_common()]
        if not diff:
            out.append("- alle Felder identisch")
        nur = sorted(ma.keys() - mb.keys())[:5], sorted(mb.keys() - ma.keys())[:5]
        if any(nur):
            out.append(f"- nur Apollo z. B. {nur[0]}; nur apollo-sync z. B. {nur[1]}")
    else:
        za = collections.Counter(tuple(_norm(r.get(f)) for f in felder) for r in ra)
        zb = collections.Counter(tuple(_norm(r.get(f)) for f in felder) for r in rb)
        out.append(f"- identische Zeilen {sum((za & zb).values())}, nur Apollo {sum((za - zb).values())}, "
                   f"nur apollo-sync {sum((zb - za).values())}")
    return out + [""]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--extrakte", required=True, type=Path, help="Ordner mit den Apollo-Listen")
    ap.add_argument("--lieferungen", required=True, type=Path, help="Ordner mit den apollo-sync-Dateien")
    ap.add_argument("--bis", required=True, type=dt.date.fromisoformat, help="letzter Tag (JJJJ-MM-TT)")
    ap.add_argument("--art", action="append", choices=sorted(ARTEN), help="nur diese Art(en)")
    ap.add_argument("--bericht", type=Path, help="Markdown-Datei (sonst Ausgabe)")
    a = ap.parse_args(argv)
    teile = ["# Abgleich Apollo-Listen gegen apollo-sync\n"]
    for art in a.art or ARTEN:
        teile += vergleiche(art, a.extrakte, a.lieferungen, a.bis)
    text = "\n".join(teile)
    if a.bericht:
        a.bericht.write_text(text, encoding="utf-8")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
