"""Platform connection: same contract as odbc-worker (no change in `compute` needed).

    GET  {BASE}/api/odbc/konfig      interval, active feeds, "sync now" timestamp
    POST {BASE}/api/odbc/<art>       the feed file (multipart field `file`), header X-ODBC-Token
    POST {BASE}/api/odbc/status      heartbeat + last runs

A run reads every needed table exactly once in one guarded session, logs out, then builds
and sends the feeds — the Apollo session is never held during HTTP uploads.
"""
from __future__ import annotations

import datetime as dt
import json
import logging
import os
import socket
import sys
import time

from . import __version__, incidents, protocol
from .client import Apollo, CachedSource, TableExcluded, TableQuarantined
from .feeds import ARTEN, Feeds, needs
from .guard import CoolingDown

log = logging.getLogger("apollo_sync")

BASE_URL = os.environ.get("ACM_BASE_URL", "http://192.9.201.9").rstrip("/")
ODBC_TOKEN = os.environ.get("ODBC_SYNC_TOKEN", "")


def setup_logging() -> None:
    """docs/logging.md: stdout, level WARNING, JSON lines."""
    class _Json(logging.Formatter):
        def format(self, r: logging.LogRecord) -> str:
            d = {"ts": dt.datetime.now().isoformat(timespec="seconds"), "level": r.levelname,
                 "logger": r.name, "msg": r.getMessage()}
            if r.exc_info:
                d["exc"] = self.formatException(r.exc_info)
            return json.dumps(d, ensure_ascii=False)

    h = logging.StreamHandler(sys.stdout)
    h.setFormatter(_Json())
    root = logging.getLogger()
    root.handlers[:] = [h]
    root.setLevel(os.environ.get("LOG_LEVEL", "WARNING"))


def _headers() -> dict:
    if not ODBC_TOKEN:
        raise SystemExit("ODBC_SYNC_TOKEN is not set")
    return {"X-ODBC-Token": ODBC_TOKEN}


def send(art: str, filename: str, data: bytes) -> dict:
    import requests

    r = requests.post(f"{BASE_URL}/api/odbc/{art}", headers=_headers(),
                      files={"file": (filename, data, "application/octet-stream")}, timeout=600)
    if r.status_code >= 400:
        raise RuntimeError(f"HTTP {r.status_code} — {r.text[:300]}")
    return r.json()


def fetch_config() -> dict:
    import requests

    r = requests.get(f"{BASE_URL}/api/odbc/konfig", headers=_headers(), timeout=60)
    r.raise_for_status()
    return r.json()


def report_status(runs: list[dict], sync_confirmed_at: str | None = None,
                  last_error: str | None = None) -> None:
    import requests

    try:
        requests.post(f"{BASE_URL}/api/odbc/status", headers=_headers(), json={
            "worker_version": f"apollo-sync {__version__}",
            "host": socket.gethostname(),
            "sync_bestaetigt_am": sync_confirmed_at,
            "letzter_fehler": last_error,
            "laeufe": runs,
        }, timeout=60).raise_for_status()
    except Exception as exc:  # monitoring must never break a run
        log.warning("status report failed: %s", exc)


def default_from() -> dt.date:
    """From 1 Jan of the previous year (as the old worker)."""
    return dt.date(dt.date.today().year - 1, 1, 1)


def build(arten: list[str], von: dt.date, apollo: Apollo | None = None, source=None
          ) -> tuple[dict[str, tuple[str, bytes] | Exception], dict]:
    """Build feeds. With `apollo`: read all needed tables in this session first (each once,
    only the needed columns), then build offline. With `source`: build from it (e.g. Mirror)."""
    timings: dict = {}
    if source is None:
        src = CachedSource(apollo)
        plan = needs(arten)                  # exactly the columns the active feeds read
        src.prefetch(plan)
        for t, cols in plan.items():
            t0 = time.perf_counter()
            try:
                src.rows(t, cols)
            except (TableQuarantined, TableExcluded, protocol.DecodeFailure) as exc:
                log.warning("%s: %s", t, exc)    # only the feeds needing `t` fail; session stays usable
            timings[t] = round(time.perf_counter() - t0, 2)
        source = src
    feeds = Feeds(source).builders()
    out: dict[str, tuple[str, bytes] | Exception] = {}
    for a in arten:
        try:
            out[a] = feeds[a](von)
        except Exception as exc:  # one broken feed must not stop the others
            if not isinstance(exc, protocol.DecodeFailure):      # decode incidents are written by the client
                exc.incident = incidents.write("feed", None, error=exc, art=a, von=von)
            out[a] = exc
    return out, timings


def run_once(arten: list[str], von: dt.date, dry_run: bool = False, outdir: str = ".") -> list[dict]:
    t0 = time.monotonic()
    runs: list[dict] = []
    try:
        with Apollo.from_env() as a:
            built, _ = build(arten, von, apollo=a)
    except (CoolingDown, protocol.SessionRefused, protocol.ServerAbort) as exc:
        ms = int((time.monotonic() - t0) * 1000)
        return [{"art": art, "status": "fehler", "zeilen": None, "dauer_ms": ms,
                 "fehler": f"Apollo: {exc}"[:500]} for art in arten]
    read_ms = int((time.monotonic() - t0) * 1000)
    if dry_run:
        os.makedirs(outdir, exist_ok=True)      # the read took minutes — never lose it to a missing folder
    for art in arten:
        t1 = time.monotonic()
        res = built[art]
        try:
            if isinstance(res, Exception):
                raise res
            filename, data = res
            if dry_run:
                path = os.path.join(outdir, f"_dryrun_{filename}")
                with open(path, "wb") as f:
                    f.write(data)
                rows = None
            else:
                rows = send(art, filename, data).get("rows_total")
            runs.append({"art": art, "status": "ok", "zeilen": rows,
                         "dauer_ms": read_ms + int((time.monotonic() - t1) * 1000), "fehler": None})
        except Exception as exc:
            inc = getattr(exc, "incident", None) or incidents.write("feed", None, error=exc, art=art, stage="send")
            log.warning("feed %s failed: %s (incident %s)", art, exc, inc)
            exc = RuntimeError(f"{exc} [incident {os.path.basename(str(inc)) if inc else '-'}]")
            runs.append({"art": art, "status": "fehler", "zeilen": None,
                         "dauer_ms": int((time.monotonic() - t1) * 1000), "fehler": str(exc)[:500]})
    return runs


_STOP = False


def _request_stop(signum, frame) -> None:
    """SIGTERM/SIGINT: never kill a running Apollo session (a hard kill can leave a session the
    server holds for ~30 min). Let the current run finish and log out, then exit."""
    global _STOP
    _STOP = True


def _sleep(seconds: int) -> None:
    for _ in range(seconds):
        if _STOP:
            return
        time.sleep(1)


def service() -> None:
    """Continuous operation: poll config every 60 s, run when due or on "sync now".
    Stops gracefully on SIGTERM (compose sets stop_grace_period so a run can finish)."""
    import signal

    signal.signal(signal.SIGTERM, _request_stop)
    signal.signal(signal.SIGINT, _request_stop)
    last_request = None
    next_run = 0.0
    while not _STOP:
        try:
            k = fetch_config()
        except Exception as exc:
            log.warning("config not reachable: %s", exc)
            report_status([], last_error=f"Konfig nicht erreichbar: {exc}"[:500])
            _sleep(60)
            continue
        request = k.get("sync_angefordert_am")
        now_requested = bool(request) and request != last_request
        if now_requested or time.monotonic() >= next_run:
            arten = [a for a in k.get("aktive_arten", []) if a in ARTEN]
            runs = run_once(arten, default_from()) if arten else []
            report_status(runs, sync_confirmed_at=request if now_requested else None,
                          last_error=next((r["fehler"] for r in runs if r["fehler"]), None))
            if now_requested:
                last_request = request
            next_run = time.monotonic() + max(int(k.get("intervall_min", 60)), 5) * 60
        _sleep(60)
