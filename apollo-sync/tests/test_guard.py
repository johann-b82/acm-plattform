"""Protection of the (personal) Apollo account: cool-down, quarantine, column groups."""
import pytest

from apollo_sync import protocol as p
from apollo_sync.client import Apollo, TableQuarantined
from apollo_sync.guard import CoolingDown, Guard, Quarantine


class FakeSession:
    """Stands in for protocol.Session; aborts whenever more than `limit` columns are asked."""

    def __init__(self, limit=None, rows=5):
        self.limit, self.rows, self.queries = limit, rows, []

    def connect(self, pw):
        return self

    def close(self):
        pass

    def query(self, file, fields, server_filter=None, batch=256):
        self.queries.append(len(fields))
        if self.limit is not None and len(fields) > self.limit:
            raise p.ServerAbort("connection reset by the server")
        for rec in range(1, self.rows + 1):
            yield rec, [f"{rec}:{f[2]}:{f[1]}" for f in fields]


def _apollo(tmp_path, session):
    a = Apollo("x", password="pw", guard=Guard(tmp_path / "guard.json"))
    a._session = session
    return a


def test_quarantine_progression_wide_table(tmp_path):
    q = Quarantine(tmp_path / "q.json")
    groups = [q.record_abort("T", 595)["group"] for _ in range(5)]
    assert groups == [148, 74, 37, 18, None]
    assert q.get("T")["skip"] is True


def test_quarantine_narrow_table_skips_immediately(tmp_path):
    q = Quarantine(tmp_path / "q.json")
    assert q.record_abort("T", 8)["skip"] is True


def test_abort_trips_cooldown_and_quarantine(tmp_path):
    a = _apollo(tmp_path, FakeSession(limit=100))
    with pytest.raises(p.ServerAbort):
        a.fetch("stm_std")                                    # 790 columns > limit
    assert Quarantine(tmp_path / "quarantine.json").get("stm_std")["group"] == 197
    with pytest.raises(CoolingDown):
        a.connect()                                           # no second attempt in the window


def test_quarantined_table_is_read_in_groups_and_merged(tmp_path):
    Quarantine(tmp_path / "quarantine.json").record_abort("stm_std", 790)   # -> groups of 197
    s = FakeSession(limit=200)
    a = _apollo(tmp_path, s)
    rows = a.fetch("stm_std", with_recno=True)
    assert s.queries == [197, 197, 197, 197, 2]
    assert len(rows) == 5 and len(rows[0]) == 1 + 790
    cols = a.schema["stm_std"].columns
    assert rows[2][1:] == tuple(f"3:{c.field}:{c.sub}" for c in cols)


def test_skipped_table_never_reaches_the_server(tmp_path):
    q = Quarantine(tmp_path / "quarantine.json")
    q.record_abort("mwst_std", 5)
    s = FakeSession()
    a = _apollo(tmp_path, s)
    with pytest.raises(TableQuarantined):
        a.fetch("mwst_std", ["mwst_id"])
    assert s.queries == []


def test_session_refused_trips_cooldown(tmp_path):
    class Refusing(FakeSession):
        def connect(self, pw):
            raise p.SessionRefused(-817)

    a = _apollo(tmp_path, Refusing())
    with pytest.raises(p.SessionRefused):
        a.connect()
    with pytest.raises(CoolingDown):
        a.connect()
