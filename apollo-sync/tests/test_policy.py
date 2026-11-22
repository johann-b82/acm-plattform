"""Table policy: excluded tables never reach the server; local decisions override defaults."""
import json

import pytest

from apollo_sync import policy, readiness
from apollo_sync.client import Apollo, TableExcluded
from apollo_sync.guard import Guard


class CountingSession:
    def __init__(self):
        self.queries = 0

    def connect(self, pw):
        return self

    def close(self):
        pass

    def query(self, file, fields, server_filter=None, batch=256, limit=None):
        self.queries += 1
        yield 1, [None] * len(fields)


def _apollo(tmp_path, s):
    a = Apollo("x", password="pw", guard=Guard(tmp_path / "guard.json"))
    a._session = s
    return a


def test_statistiken_excluded_by_default(tmp_path):
    policy._load.cache_clear()
    s = CountingSession()
    with pytest.raises(TableExcluded):
        _apollo(tmp_path, s).fetch("Statistiken", ["Stat_ID"] if False else None)
    assert s.queries == 0


def test_local_decision_overrides(tmp_path, monkeypatch):
    f = tmp_path / "decisions.json"
    f.write_text(json.dumps({"tables": {"mwst_std": {"read": False, "reason": "nicht benötigt"},
                                        "Statistiken": {"read": True, "reason": "doch gebraucht"}}}))
    monkeypatch.setenv("APOLLO_SYNC_POLICY", str(f))
    policy._load.cache_clear()
    assert not policy.allowed("mwst_std") and policy.allowed("Statistiken") and policy.allowed("stm_std")
    s = CountingSession()
    with pytest.raises(TableExcluded):
        _apollo(tmp_path, s).fetch("mwst_std", ["mwst_id"])
    assert s.queries == 0
    policy._load.cache_clear()


def test_readiness_skips_excluded_and_proposes(tmp_path, monkeypatch):
    policy._load.cache_clear()
    s = CountingSession()
    monkeypatch.setattr(readiness.Apollo, "from_env", classmethod(lambda cls: _apollo(tmp_path, s)))
    out = tmp_path / "out"
    readiness.run(out, ["Statistiken", "mwst_std"], log=lambda m: None)
    prop = json.loads((out / "table_policy.proposal.json").read_text(encoding="utf-8"))["tables"]
    assert prop["Statistiken"]["read"] is False and prop["mwst_std"]["read"] is True
    assert json.loads((out / "tables" / "Statistiken.json").read_text(encoding="utf-8"))["status"] == "excluded"
