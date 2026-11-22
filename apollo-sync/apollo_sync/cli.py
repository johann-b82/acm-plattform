"""Command line: `python -m apollo_sync <command>` (or `apollo-sync <command>`).

Offline (no server):   tables, describe, guard
Live (one session):    pull, export, feed
Platform service:      service

Connection via environment: APOLLO_HOST (192.9.200.134), APOLLO_PORT (4722),
APOLLO_DB (apollo | Test), APOLLO_PWD (on Windows alternatively ~/apollo-cred.xml).
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import time

from . import __version__
from . import schema as schema_mod
from .guard import Guard


def _cols(arg: str | None) -> list[str] | None:
    return [c.strip() for c in arg.split(",") if c.strip()] if arg else None


def _where(arg: str | None):
    """'col>=2026-01-01' or 'col>123' -> (col, op, value) with a typed value."""
    if not arg:
        return None
    for op in (">=", ">"):
        if op in arg:
            col, val = arg.split(op, 1)
            col, val = col.strip(), val.strip()
            try:
                v = dt.date.fromisoformat(val)
            except ValueError:
                v = float(val) if "." in val or "e" in val.lower() else int(val)
            return (col, op, v)
    raise SystemExit("--where supports only 'col>value' or 'col>=value' (server-side, indexed columns)")


def cmd_tables(a) -> None:
    s = schema_mod.load()
    for name in s.names():
        if a.pattern and a.pattern.lower() not in name.lower():
            continue
        t = s[name]
        print(f"{name}\tfile={t.file}\tcolumns={len(t.columns)}")


def cmd_describe(a) -> None:
    t = schema_mod.load()[a.table]
    print(f"# {t.name}  file={t.file}  columns={len(t.columns)}")
    for c in t.columns:
        print(f"{c.name}\t{c.type_name}\tsub={c.sub}\tfield={c.field}")


def cmd_guard(a) -> None:
    from .guard import Quarantine

    g = Guard()
    if a.reset:
        g.path.unlink(missing_ok=True)
        Quarantine(g.path.parent / "quarantine.json").reset()
        print("guard and quarantine reset")
        return
    print(json.dumps(g.status(), ensure_ascii=False))


def cmd_incidents(a) -> None:
    from . import incidents

    d = incidents.incidents_dir()
    files = sorted(d.glob("*.json")) if d.exists() else []
    for f in files[-a.last:]:
        rec = json.loads(f.read_text(encoding="utf-8"))
        print(f"{f}\t{rec['kind']}\t{rec.get('table') or '-'}\t{(rec.get('error') or '')[:100]}")
    if not files:
        print(f"no incidents in {d}")


def cmd_replay(a) -> None:
    from . import incidents

    r = incidents.replay(a.file)
    print(json.dumps(r, ensure_ascii=False, indent=1, default=str))
    if not r.get("ok"):
        raise SystemExit(1)


def _jsonable(v):
    if isinstance(v, dt.date):
        return v.isoformat()
    return v


def cmd_export(a) -> None:
    from .client import Apollo

    cols = _cols(a.columns)
    if cols is None and not a.all_columns:
        raise SystemExit("name the columns you need (--columns a,b,c); all columns only with --all-columns")
    out = open(a.output, "w", encoding="utf-8", newline="\n") if a.output else sys.stdout
    t0 = time.perf_counter()
    with Apollo.from_env() as ap:
        names = [c.name for c in ap.schema[a.table].select(cols)]
        rows = ap.fetch(a.table, names, server_filter=_where(a.where), with_recno=True)
    if a.format == "jsonl":
        for r in rows:
            out.write(json.dumps({"_recno": r[0], **{n: _jsonable(v) for n, v in zip(names, r[1:])}},
                                 ensure_ascii=False) + "\n")
    else:
        out.write("\t".join(["_recno", *names]) + "\n")
        for r in rows:
            out.write("\t".join("" if v is None else str(_jsonable(v)).replace("\t", "\\t").replace("\n", "\\n")
                                for v in r) + "\n")
    if out is not sys.stdout:
        out.close()
    print(f"{a.table}: {len(rows)} rows in {time.perf_counter() - t0:.1f} s", file=sys.stderr)


def cmd_pull(a) -> None:
    from .client import Apollo
    from .mirror import Mirror, pull_many

    s = schema_mod.load()
    cols = _cols(a.columns)
    if a.for_feeds:
        from .feeds import ARTEN, needs

        plan = list(needs(ARTEN).items())            # only what the feeds read
    else:
        if not a.tables:
            raise SystemExit("name tables (or use --for-feeds)")
        tables = s.names() if a.tables == "ALL" else [t.strip() for t in a.tables.split(",")]
        if cols is None and not a.all_columns:
            raise SystemExit("name the columns you need (--columns, one table), use --for-feeds, "
                             "or --all-columns for complete tables")
        if cols and len(tables) != 1:
            raise SystemExit("--columns only with exactly one table")
        plan = [(t, cols) for t in tables]
    m = Mirror(a.db)

    def report(t, n, secs, err):
        print(f"{t}: {'ABORT ' + err if err else f'{n} rows'} in {secs:.1f} s", file=sys.stderr, flush=True)

    with Apollo.from_env() as ap:
        pull_many(ap, m, plan, on_table=report)
    m.close()


def cmd_readiness(a) -> None:
    from . import readiness

    tables = [t.strip() for t in a.tables.split(",")] if a.tables else None
    s = readiness.run(a.out, tables, group=a.group, limit=a.limit or None,
                      log=lambda m: print(m, file=sys.stderr, flush=True))
    print(json.dumps(s, ensure_ascii=False, indent=1))


def cmd_columns(a) -> None:
    from .feeds import ARTEN, needs

    s = schema_mod.load()
    for t, cols in needs([a.art] if a.art else ARTEN).items():
        print(f"{t}\t{len(cols)} of {len(s[t].columns)} columns\t{','.join(cols)}")


def cmd_feed(a) -> None:
    from . import acm
    from .feeds import ARTEN

    arten = list(ARTEN) if a.alle else [a.art]
    von = dt.date.fromisoformat(a.von) if a.von else acm.default_from()
    if a.mirror:
        from .mirror import Mirror

        built, _ = acm.build(arten, von, source=Mirror(a.mirror))
        os.makedirs(a.out, exist_ok=True)
        for art, res in built.items():
            if isinstance(res, Exception):
                print(f"{art}: ERROR {res}", file=sys.stderr)
                continue
            fn, data = res
            path = os.path.join(a.out, fn if not os.path.exists(os.path.join(a.out, fn)) else f"{art}_{fn}")
            with open(path, "wb") as f:
                f.write(data)
            print(f"{art}: {path} ({len(data):,} bytes)", file=sys.stderr)
        return
    runs = acm.run_once(arten, von, dry_run=a.dry_run, outdir=a.out)
    if not a.dry_run:
        acm.report_status(runs)
    for r in runs:
        print(json.dumps(r, ensure_ascii=False), file=sys.stderr)
    if any(r["status"] == "fehler" for r in runs):
        raise SystemExit(1)


def cmd_service(a) -> None:
    from . import acm

    acm.service()


def main(argv: list[str] | None = None) -> None:
    from .acm import setup_logging

    setup_logging()
    ap = argparse.ArgumentParser(prog="apollo-sync", description=f"Apollo (CONZEPT 16) reader {__version__}")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("tables", help="list tables (offline)")
    p.add_argument("pattern", nargs="?")
    p.set_defaults(fn=cmd_tables)
    p = sub.add_parser("describe", help="columns and wire types of a table (offline)")
    p.add_argument("table")
    p.set_defaults(fn=cmd_describe)
    p = sub.add_parser("guard", help="show (or --reset) the server cool-down state")
    p.add_argument("--reset", action="store_true")
    p.set_defaults(fn=cmd_guard)
    p = sub.add_parser("export", help="one table (projection) as TSV or JSON lines")
    p.add_argument("table")
    p.add_argument("--columns", help="comma separated — only the columns you need")
    p.add_argument("--all-columns", action="store_true", help="explicitly read every column")
    p.add_argument("--where", help="server filter 'col>=value' (indexed columns only)")
    p.add_argument("--format", choices=["tsv", "jsonl"], default="tsv")
    p.add_argument("-o", "--output")
    p.set_defaults(fn=cmd_export)
    p = sub.add_parser("pull", help="mirror tables into a local SQLite file (only needed columns)")
    p.add_argument("tables", nargs="?", help="comma separated or ALL (not with --for-feeds)")
    p.add_argument("--columns", help="only these columns (one table)")
    p.add_argument("--for-feeds", action="store_true",
                   help="exactly the tables/columns the 14 feeds read (then `feed --mirror` works offline)")
    p.add_argument("--all-columns", action="store_true", help="explicitly mirror complete tables")
    p.add_argument("--db", default="apollo.sqlite")
    p.set_defaults(fn=cmd_pull)
    p = sub.add_parser("incidents", help="list incident files (failures) for a coding agent (offline)")
    p.add_argument("--last", type=int, default=20)
    p.set_defaults(fn=cmd_incidents)
    p = sub.add_parser("replay", help="decode the raw replies of a decode incident with the current code (offline)")
    p.add_argument("file")
    p.set_defaults(fn=cmd_replay)
    p = sub.add_parser("readiness", help="profile every table: readable, decodable, size, data columns")
    p.add_argument("--out", required=True, help="directory for per-table JSON + READINESS.md (resumable)")
    p.add_argument("--tables", help="comma separated (default: all)")
    p.add_argument("--group", type=int, default=100, help="max columns per projection")
    p.add_argument("--limit", type=int, default=200_000, help="max rows per column group (0 = all)")
    p.set_defaults(fn=cmd_readiness)
    p = sub.add_parser("columns", help="columns the feeds read per table (offline)")
    p.add_argument("--art", help="only this feed (default: all)")
    p.set_defaults(fn=cmd_columns)
    p = sub.add_parser("feed", help="build platform feeds (live or from a mirror)")
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--art")
    g.add_argument("--alle", action="store_true")
    p.add_argument("--von", help="YYYY-MM-DD (default: 1 Jan of the previous year)")
    p.add_argument("--dry-run", action="store_true", help="write files instead of sending")
    p.add_argument("--mirror", help="build offline from this SQLite mirror (implies writing files)")
    p.add_argument("--out", default=".")
    p.set_defaults(fn=cmd_feed)
    p = sub.add_parser("service", help="platform service loop (konfig/status/uploads)")
    p.set_defaults(fn=cmd_service)
    a = ap.parse_args(argv)
    a.fn(a)
