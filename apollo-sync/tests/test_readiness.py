"""Readiness profiler with a fake session: column groups, row limit, stats, resumability."""
import datetime as dt
import json

from apollo_sync import protocol as p, readiness
from apollo_sync.client import Apollo
from apollo_sync.guard import Guard


class FakeSession:
    def __init__(self, rows=7):
        self.rows, self.calls = rows, []

    def connect(self, pw):
        return self

    def close(self):
        pass

    def query(self, file, fields, server_filter=None, batch=256, limit=None):
        self.calls.append((len(fields), limit))
        n = self.rows if limit is None else min(self.rows, limit)
        for rec in range(1, n + 1):
            out = []
            for ty, sub, fld in fields:
                if ty == p.T_DATE:
                    out.append(dt.date(2026, 1, rec) if rec % 2 else None)
                elif ty == p.T_STR:
                    out.append("ab " if rec == 1 else "")
                elif ty == p.T_TIME:
                    out.append("24:00:00.00" if rec == 3 else "00:00:00.00")
                else:
                    out.append(p.DEFAULTS[ty])
            yield rec, out


def _apollo(tmp_path, s):
    a = Apollo("x", password="pw", guard=Guard(tmp_path / "guard.json"))
    a._session = s
    return a


def test_profile_groups_limit_and_stats(tmp_path):
    s = FakeSession(rows=7)
    a = _apollo(tmp_path, s)
    r = readiness.profile_table(a, "stm_std", group=100, limit=5, count_cap=1000)
    assert r["rows"] == 7 and r["profiled_rows"] == 5 and r["recno_unique"] and not r["rows_at_least"]
    assert s.calls[0] == (1, 1000)                        # count scan: one column, streamed, capped
    assert all(n <= 100 and lim == 5 for n, lim in s.calls[1:])
    assert sum(n for n, _ in s.calls[1:]) == 790
    st = r["column_stats"]
    assert st["stm_bez1"]["filled"] == 1 and st["stm_bez1"]["trailing_blanks"] == 1
    assert r["status"] == "ok" and "stm_datum_save" in r["change_columns"]


def test_count_is_capped_and_streamed(tmp_path):
    s = FakeSession(rows=50)
    a = _apollo(tmp_path, s)
    r = readiness.profile_table(a, "mwst_std", group=100, limit=10, count_cap=20)
    assert r["rows"] == 20 and r["rows_at_least"] and r["profiled_rows"] == 10


def test_unexpected_error_does_not_stop_the_run(tmp_path, monkeypatch):
    s = FakeSession(rows=3)
    monkeypatch.setattr(readiness.Apollo, "from_env", classmethod(lambda cls: _apollo(tmp_path, s)))
    monkeypatch.setenv("APOLLO_SYNC_STATE", str(tmp_path / "state"))
    real = readiness.profile_table

    def flaky(a, n, **kw):
        if n == "mwst_std":
            raise MemoryError("simulated")
        return real(a, n, **kw)

    monkeypatch.setattr(readiness, "profile_table", flaky)
    summary = readiness.run(tmp_path / "out", ["mwst_std", "T_Zeiten"], log=lambda m: None)
    assert summary["tables"] == 2 and summary["problems"]["mwst_std"][0] == "error"
    assert list((tmp_path / "state" / "incidents").glob("*_profile_mwst_std.json"))


def test_run_is_resumable(tmp_path, monkeypatch):
    s = FakeSession(rows=3)
    monkeypatch.setattr(readiness.Apollo, "from_env", classmethod(lambda cls: _apollo(tmp_path, s)))
    out = tmp_path / "out"
    readiness.run(out, ["mwst_std"], log=lambda m: None)
    calls = len(s.calls)
    summary = readiness.run(out, ["mwst_std", "T_Zeiten"], log=lambda m: None)
    assert len(s.calls) > calls and summary["tables"] == 2 and summary["ok"] == 2
    assert json.loads((out / "tables" / "mwst_std.json").read_text())["rows"] == 3
    assert (out / "READINESS.md").exists()
