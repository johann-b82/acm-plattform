"""Incident log: every failure leaves a self-contained file a coding agent can pick up.

    <APOLLO_SYNC_STATE>/incidents/<UTC timestamp>_<kind>_<table>.json

Contents: kind, table, projection (column name, wire type, sub-record, field), error and
traceback, tool version, the raw server replies of the failing record (hex, for decode errors)
and a short "how to fix" text. `apollo-sync replay <file>` decodes the stored replies offline
with the current code — reproduce, fix, re-run, no server needed.

Raw replies contain business data of one record; incidents stay on the machine that ran the
tool (state volume), they are not uploaded anywhere. Never contains credentials.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import traceback
from pathlib import Path

from . import __version__

HOW_TO = {
    "decode": ("The server reply of one record could not be decoded. Run `python -m apollo_sync replay <this "
               "file>`, fix apollo_sync/protocol.py (decode_row) until replay decodes all frames, add a "
               "regression test with a synthetic frame in tests/test_protocol.py, run pytest."),
    "server_abort": ("The server reset the session while reading this projection. The table is quarantined "
                     "(smaller column groups next time) and the guard waits ~35 min. Do NOT retry quickly — "
                     "the personal Apollo account is locked meanwhile. Consider excluding the table in the "
                     "table policy (APOLLO_SYNC_POLICY) or requesting fewer columns."),
    "feed": ("Building or sending a platform feed failed. See traceback; reproduce offline with "
             "`python -m apollo_sync pull --for-feeds --db m.sqlite` once and "
             "`python -m apollo_sync feed --art <art> --mirror m.sqlite --out out/`."),
    "refused": ("The server refused the login (session/licence lock, usually after an aborted session). "
                "Wait ~35 min; the guard blocks attempts meanwhile."),
    "profile": ("The readiness profile failed on this table for a reason outside the protocol (see traceback). "
                "Reproduce with `python -m apollo_sync readiness --out <dir> --tables <table>` on APOLLO_DB=Test, "
                "fix apollo_sync/readiness.py or client.py, add a test in tests/test_readiness.py."),
}


def incidents_dir() -> Path:
    base = os.environ.get("APOLLO_SYNC_STATE") or os.path.join(Path.home(), ".apollo-sync")
    return Path(base) / "incidents"


def write(kind: str, table: str | None = None, columns=None, error: BaseException | str | None = None,
          frames: list[bytes] | None = None, **context) -> Path | None:
    """Write one incident file; never raises (logging must not break a run)."""
    try:
        d = incidents_dir()
        d.mkdir(parents=True, exist_ok=True)
        ts = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        safe = re.sub(r"[^A-Za-z0-9_.-]", "_", table or "-")
        path = d / f"{ts}_{kind}_{safe}.json"
        rec = {
            "kind": kind, "tool_version": __version__, "at_utc": ts, "table": table,
            "database": os.environ.get("APOLLO_DB", "apollo"),
            "error": str(error) if error is not None else None,
            "error_type": type(error).__name__ if isinstance(error, BaseException) else None,
            "traceback": "".join(traceback.format_exception(error)) if isinstance(error, BaseException) else None,
            "projection": [{"name": c.name, "type": c.type, "sub": c.sub, "field": c.field} for c in (columns or [])],
            "frames_hex": [f.hex() for f in (frames or [])],
            "how_to_fix": HOW_TO.get(kind, ""),
            "context": {k: (v if isinstance(v, (str, int, float, bool, type(None))) else str(v))
                        for k, v in context.items()},
        }
        path.write_text(json.dumps(rec, ensure_ascii=False, indent=1), encoding="utf-8")
        return path
    except Exception:
        return None


def replay(path: str | Path) -> dict:
    """Decode the stored frames of a decode incident with the current code."""
    from . import protocol as p

    rec = json.loads(Path(path).read_text(encoding="utf-8"))
    frames = [bytes.fromhex(h) for h in rec.get("frames_hex", [])]
    if not frames:
        return {"ok": False, "error": "incident has no frames to replay", "kind": rec.get("kind")}
    types = [c["type"] for c in rec["projection"]]
    try:
        recno, vals = p.decode_row(frames if len(frames) > 1 else frames[0], types, [p.DEFAULTS[t] for t in types])
    except Exception as exc:
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}", "frames": len(frames)}
    names = [c["name"] for c in rec["projection"]]
    return {"ok": True, "recno": recno, "frames": len(frames),
            "values": {n: (v.isoformat() if hasattr(v, "isoformat") else v) for n, v in zip(names, vals)}}
