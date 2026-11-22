"""Session guard: never let the tool cause a lockout cascade on the production server.

Observed behaviour of the CONZEPT 16 server (2026-11-22):
  * If the server aborts a session (connection reset, e.g. table `Statistiken` with all
    columns in one projection), new logins of the same user are refused for about 30 min
    (handshake reply -817/-814; the Windows driver reports "User authorization failed").
  * Every further attempt in that window is useless.

The guard records such events in a small state file and refuses to connect until the
cool-down is over — also across process restarts. It never stores secrets.
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path

COOLDOWN_S = 35 * 60


class CoolingDown(RuntimeError):
    def __init__(self, until: float, reason: str):
        mins = max(0, int((until - time.time()) // 60) + 1)
        super().__init__(f"server cool-down active for about {mins} more min ({reason})")
        self.until = until
        self.reason = reason


def _default_path() -> Path:
    base = os.environ.get("APOLLO_SYNC_STATE") or os.path.join(Path.home(), ".apollo-sync")
    return Path(base) / "guard.json"


class Guard:
    def __init__(self, path: str | Path | None = None):
        self.path = Path(path) if path else _default_path()

    def _read(self) -> dict:
        try:
            return json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}

    def _write(self, data: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data), encoding="utf-8")
        tmp.replace(self.path)

    def check(self) -> None:
        d = self._read()
        until = float(d.get("until", 0))
        if until > time.time():
            raise CoolingDown(until, d.get("reason", ""))

    def trip(self, reason: str, seconds: int = COOLDOWN_S) -> None:
        self._write({"until": time.time() + seconds, "reason": reason[:200],
                     "at": time.strftime("%Y-%m-%dT%H:%M:%S")})

    def status(self) -> dict:
        d = self._read()
        d["active"] = float(d.get("until", 0)) > time.time()
        d["quarantine"] = Quarantine(self.path.parent / "quarantine.json").all()
        return d


class Quarantine:
    """Tables that made the server abort a session. Runs on the personal Apollo account, so
    the same table must never cause a second lockout: after an abort it is read in smaller
    column groups; if it aborts again with groups of <= MIN_GROUP columns it is skipped until
    a human resets it (`apollo-sync guard --reset`)."""

    MIN_GROUP = 10

    def __init__(self, path: str | Path):
        self.path = Path(path)

    def all(self) -> dict:
        try:
            return json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}

    def get(self, table: str) -> dict | None:
        return self.all().get(table)

    def record_abort(self, table: str, columns_requested: int) -> dict:
        d = self.all()
        prev = d.get(table)
        if prev and prev.get("group"):
            group = prev["group"] // 2
        else:
            group = max(self.MIN_GROUP, columns_requested // 4)
        # splitting cannot help if the groups would not be smaller than what was requested
        useless = group >= columns_requested
        entry = {"group": group if group >= self.MIN_GROUP and not useless else None,
                 "skip": useless or group < self.MIN_GROUP
                 or (prev is not None and prev.get("group") == self.MIN_GROUP),
                 "aborts": (prev or {}).get("aborts", 0) + 1,
                 "last": time.strftime("%Y-%m-%dT%H:%M:%S")}
        d[table] = entry
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(d, indent=1), encoding="utf-8")
        tmp.replace(self.path)
        return entry

    def reset(self) -> None:
        self.path.unlink(missing_ok=True)
