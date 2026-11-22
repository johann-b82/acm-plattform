"""Records longer than one reply (4,632 bytes), strict decoding, clean drain on errors,
incident files + offline replay."""
import json
import struct

import pytest

from apollo_sync import incidents
from apollo_sync import protocol as p

HEAD_FINAL = bytes(20) + b"\xfd\xf1" + bytes(6)
HEAD_PART = bytes(11) + b"\x01" + bytes(16)          # no fd f1 marker -> more replies follow
TYPES = [p.T_DBL, p.T_STR, p.T_I16]
DEF = [p.DEFAULTS[t] for t in TYPES]


def _split_record(text: bytes, cut: int):
    """Field 2 (long string) split after `cut` bytes, like dic_std on the real server."""
    a = (HEAD_PART + b"\x80\x00" + struct.pack("<q", 5) + b"\x80\x01" + struct.pack("<d", 2.0)
         + b"\xa4\x02" + cut.to_bytes(2, "little") + text[:cut])
    rest = text[cut:]
    b = (HEAD_FINAL + b"\xac\x02" + len(rest).to_bytes(2, "little") + cut.to_bytes(2, "little") + rest
         + b"\x80\x03" + struct.pack("<h", 7) + b"\x00")
    return a, b


def test_split_string_is_assembled():
    text = (b"Zeile\r\n" * 700)[:4000]
    a, b = _split_record(text, 381)
    assert p.is_partial(a) and not p.is_partial(b)
    rec, v = p.decode_row([a, b], TYPES, DEF)
    assert rec == 5 and v == [2.0, text.decode(), 7]


def test_wrong_continuation_offset_is_rejected():
    a, b = _split_record(b"x" * 1000, 400)
    b = b[:32] + (399).to_bytes(2, "little") + b[34:]       # offset field
    with pytest.raises(p.ProtocolError, match="offset"):
        p.decode_row([a, b], TYPES, DEF)


@pytest.mark.parametrize("broken", [
    HEAD_FINAL + b"\x80\x00" + struct.pack("<q", 1) + b"\x0d\x0a\x00",           # invalid tag
    HEAD_FINAL + b"\x80\x00" + struct.pack("<q", 1) + b"\x80\x09\x00\x00\x00",    # field index too big
    HEAD_FINAL + b"\x80\x00" + struct.pack("<q", 1) + b"\x90\x02\x05ab",          # truncated string
    HEAD_FINAL + b"\x80\x00" + struct.pack("<q", 1) + b"\x80\x03\x07",            # truncated int16
    HEAD_FINAL + b"\x80\x00" + struct.pack("<q", 1) + b"\x80\x01" + struct.pack("<d", 1.0),  # no end tag
])
def test_strict_decoding(broken):
    with pytest.raises(p.ProtocolError):
        p.decode_row(broken, TYPES, DEF)


class ScriptedSession(p.Session):
    """Models the real server: each 0xb1 request is answered by one *record* — a list of
    replies (partials unsolicited, then the final one) — or by end-of-data. Reading more than
    the server sent fails; replies left unread at the end mean the session would desync."""

    def __init__(self, records):
        super().__init__("x")
        self.ctx = b"\x01\x02\x03\x04"
        self.records = [r if isinstance(r, list) else [r] for r in records]
        self.wire: list[bytes] = []          # replies the server has sent, not yet read
        self.sent_ops: list[int] = []

    def _answer(self, op):
        self.sent_ops.append(op)
        if op == 0xB1:
            self.wire.extend(self.records.pop(0) if self.records else [bytes(32)])
        else:
            self.wire.append(bytes(32))      # ack for control frames

    def _send(self, data):
        step = 32 if data[8] == 0xB1 else len(data)
        for i in range(0, len(data), step):
            self._answer(data[i + 8])

    def _recv(self):
        assert self.wire, "client reads a reply the server never sent"
        return self.wire.pop(0)

    def _rq(self, frame):
        self._send(frame)
        return self._recv()


def _row(recno, val):
    return HEAD_FINAL + b"\x80\x00" + struct.pack("<q", recno) + b"\x80\x01" + struct.pack("<d", val) + b"\x00"


FIELDS = [(t, 1, i + 1) for i, t in enumerate(TYPES)]


@pytest.mark.parametrize("batch", [1, 2, 4, 256])
def test_query_assembles_split_records_and_leaves_nothing_in_flight(batch):
    a, b = _split_record(b"y" * 5000, 4000)
    c, d = _split_record(b"q" * 9000, 4000)
    s = ScriptedSession([_row(1, 1.0), [a, b], _row(3, 3.0), [c, d], _row(4, 4.0)])
    rows = list(s.query(9, FIELDS, batch=batch))
    assert [r for r, _ in rows] == [1, 5, 3, 5, 4]
    assert rows[1][1][1] == "y" * 5000 and rows[3][1][1] == "q" * 9000
    assert s.sent_ops[-1] == 0x94 and s.wire == []           # closed, nothing left unread
    # a second query on the same session starts in step (the real bug desynchronized here)
    s.records = [[_row(9, 9.0)]]
    assert [r for r, _ in s.query(9, FIELDS, batch=batch)] == [9] and s.wire == []


def test_limit_stops_cleanly_with_split_records_in_flight():
    a, b = _split_record(b"y" * 5000, 4000)
    s = ScriptedSession([_row(1, 1.0), [a, b], [a, b], _row(4, 4.0), _row(5, 5.0)])
    rows = list(s.query(9, FIELDS, batch=256, limit=2))
    assert len(rows) == 2 and s.wire == [] and s.sent_ops[-1] == 0x94


def test_decode_failure_drains_then_raises():
    bad = HEAD_FINAL + b"\x80\x00" + struct.pack("<q", 2) + b"\x0d\x00"
    s = ScriptedSession([_row(1, 1.0), bad, _row(3, 3.0), _row(4, 4.0)])
    got = []
    with pytest.raises(p.DecodeFailure) as ei:
        for r in s.query(9, FIELDS, batch=4):
            got.append(r)
    assert [r for r, _ in got] == [1]
    assert ei.value.frames == [bad] and ei.value.row_index == 1
    assert s.sent_ops[-1] == 0x94 and s.wire == []           # drained + closed: no server abort


def test_incident_written_and_replayable(tmp_path, monkeypatch):
    monkeypatch.setenv("APOLLO_SYNC_STATE", str(tmp_path))
    from apollo_sync.schema import Column

    cols = [Column("a", p.T_DBL, 1, 1), Column("b", p.T_STR, 1, 2), Column("c", p.T_I16, 1, 3)]
    a, b = _split_record(b"z" * 4500, 4000)
    path = incidents.write("decode", "dic_std", cols, p.ProtocolError("boom"), [a, b], row_index=7)
    rec = json.loads(path.read_text(encoding="utf-8"))
    assert rec["kind"] == "decode" and rec["table"] == "dic_std" and len(rec["frames_hex"]) == 2
    assert "replay" in rec["how_to_fix"] and "pw" not in json.dumps(rec).lower().replace("projection", "")
    r = incidents.replay(path)                                 # current code decodes it
    assert r["ok"] and r["values"]["b"] == "z" * 4500 and r["recno"] == 5
