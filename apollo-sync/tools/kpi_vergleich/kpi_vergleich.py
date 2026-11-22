#!/usr/bin/env python3
"""Zwei KPI-Schnappschüsse (kpi_snapshot.sql) vergleichen — nur Standardbibliothek.

    python3 kpi_vergleich.py vorher.json nachher.json [--toleranz 1e-9] > bericht.md

Je KPI-Funktion und Zeitfenster: identisch, oder die Zahl der abweichenden Werte, die größte
relative Abweichung und die ersten Beispiele (Pfad, vorher, nachher). Zahlen gelten als gleich,
wenn sie innerhalb der Toleranz liegen (Rundung beim Summieren in anderer Reihenfolge).
"""
from __future__ import annotations

import argparse
import json
import sys


def _flach(x, pfad="", out=None):
    """JSON -> {pfad: blattwert}. Listen von Zeilen werden nach ihrem Inhalt sortiert, damit die
    Reihenfolge der Zeilen (ohne ORDER BY) keine Abweichung vortäuscht."""
    out = {} if out is None else out
    if isinstance(x, dict):
        for k in sorted(x):
            _flach(x[k], f"{pfad}.{k}" if pfad else k, out)
    elif isinstance(x, list):
        for i, v in enumerate(sorted(x, key=lambda v: json.dumps(v, sort_keys=True, default=str))):
            _flach(v, f"{pfad}[{i}]", out)
    else:
        out[pfad] = x
    return out


def _gleich(a, b, tol):
    if isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool):
        return abs(a - b) <= tol * max(1.0, abs(a), abs(b))
    return a == b


def _rel(a, b):
    try:
        return abs(float(a) - float(b)) / max(1e-12, abs(float(a)), abs(float(b)))
    except (TypeError, ValueError):
        return None


def vergleiche(v: dict, n: dict, tol: float) -> tuple[str, bool]:
    z = [f"# KPI-Vergleich\n", f"- vorher: {v.get('erstellt')} · nachher: {n.get('erstellt')}",
         f"- Fenster: {v.get('von')} bis {v.get('bis')}" +
         ("" if (v.get("von"), v.get("bis")) == (n.get("von"), n.get("bis")) else
          f" **(nachher: {n.get('von')} bis {n.get('bis')})**"), ""]

    z += ["## Importtabellen (Zeilen)", "", "| Tabelle | vorher | nachher | Differenz |", "|---|---:|---:|---:|"]
    for t in sorted(set(v["tabellen"]) | set(n["tabellen"])):
        a, b = v["tabellen"].get(t), n["tabellen"].get(t)
        z.append(f"| {t} | {a} | {b} | {b - a:+} |" if None not in (a, b) else f"| {t} | {a} | {b} | |")
    z += ["", "## Sichten", ""]
    for t in sorted(set(v.get("sichten", {})) | set(n.get("sichten", {}))):
        a, b = v["sichten"].get(t), n["sichten"].get(t)
        z.append(f"- `{t}`: {'identisch' if a == b else f'vorher {a} · nachher {b}'}")

    z += ["", "## KPI-Funktionen", "", "| Funktion | Fenster | gleich | abweichend | größte rel. Abw. |",
          "|---|---:|---:|---:|---:|"]
    details, alles_gleich = [], True
    for fn in sorted(set(v["kpi"]) | set(n["kpi"])):
        fv, fnn = v["kpi"].get(fn), n["kpi"].get(fn)
        if fv is None or fnn is None:
            z.append(f"| `{fn}` | nur {'nachher' if fv is None else 'vorher'} | | | |"); alles_gleich = False
            continue
        gleich = abw = 0
        maxrel = 0.0
        for w in sorted(set(fv) | set(fnn)):
            a, b = _flach(fv.get(w)), _flach(fnn.get(w))
            diff = [(p, a.get(p), b.get(p)) for p in sorted(set(a) | set(b)) if not _gleich(a.get(p), b.get(p), tol)]
            if not diff:
                gleich += 1; continue
            abw += 1
            r = [x for x in (_rel(p1, p2) for _, p1, p2 in diff) if x is not None]
            maxrel = max([maxrel] + r)
            details.append((fn, w, len(diff), diff[:5]))
        alles_gleich &= abw == 0
        z.append(f"| `{fn}` | {gleich + abw} | {gleich} | {abw} | {maxrel:.2%} |" if abw else
                 f"| `{fn}` | {gleich} | {gleich} | 0 | – |")
    fehler = sorted({f"{fn} ({w})" for s in (v, n) for fn, fw in s["kpi"].items() for w, e in fw.items()
                     if isinstance(e, dict) and set(e) == {"fehler"}})
    if fehler:
        alles_gleich = False
        z += ["", f"**Achtung:** {len(fehler)} Aufrufe endeten mit Fehler (zählen nicht als Beleg), z. B. " +
              ", ".join(f"`{x}`" for x in fehler[:8]) + " — Meldung steht im JSON unter `fehler`."]
    if v.get("uebersprungen") or n.get("uebersprungen"):
        z += ["", "Nicht aufrufbar (Pflichtargumente außer von/bis): " +
              ", ".join(f"`{x}`" for x in sorted(set(v.get("uebersprungen", [])) | set(n.get("uebersprungen", []))))]
    if details:
        z += ["", "## Abweichungen im Einzelnen (je Fenster die ersten 5)", ""]
        for fn, w, k, beispiele in details:
            z.append(f"- `{fn}` {w}: {k} Werte")
            for p, a, b in beispiele:
                z.append(f"  - `{p}`: {a!r} → {b!r}")
    z += ["", "**Ergebnis:** " + ("alle KPI-Werte identisch." if alles_gleich else "es gibt Abweichungen (siehe oben).")]
    return "\n".join(z) + "\n", alles_gleich


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("vorher"); ap.add_argument("nachher")
    ap.add_argument("--toleranz", type=float, default=1e-9)
    a = ap.parse_args(argv)
    lade = lambda p: json.load(open(p, encoding="utf-8"))
    bericht, gleich = vergleiche(lade(a.vorher), lade(a.nachher), a.toleranz)
    sys.stdout.buffer.write(bericht.encode("utf-8"))
    return 0 if gleich else 1


if __name__ == "__main__":
    sys.exit(main())
