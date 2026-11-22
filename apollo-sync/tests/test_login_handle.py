"""Login: the database handle from the X reply must reach L, F2 and C (found 22.11.2026 —
with the captured handle 1 every session read `apollo`, whatever name was sent)."""
import pytest

from apollo_sync import protocol as p


class _Sock:
    def __init__(self, x_handle: int):
        h = x_handle.to_bytes(4, "big", signed=True)
        ok = bytes(24)
        self.replies = [ok, ok, bytes(4) + b"\x58\0\x3b\x05" + h + bytes(16), ok, ok, ok,
                        b"\x40\x62\0\x02" + bytes(24)]
        self.sent, self.buf, self.closed = [], b"", False

    def settimeout(self, t): pass
    def setsockopt(self, *a): pass
    def close(self): self.closed = True

    def sendall(self, data):
        self.sent.append(data)
        r = self.replies.pop(0)
        self.buf += (len(r) + 4).to_bytes(4, "big") + r

    def recv(self, n):
        out, self.buf = self.buf[:n], self.buf[n:]
        return out


def _login(monkeypatch, handle, db="Test"):
    sock = _Sock(handle)
    monkeypatch.setattr(p.socket, "create_connection", lambda *a, **k: sock)
    return p.Session("h", database=db), sock


def test_handle_from_x_reply_goes_into_l_f2_c(monkeypatch):
    s, sock = _login(monkeypatch, 4)
    s.connect("pw")
    assert s.handle == 4
    l, f2, c = sock.sent[3:6]
    four = (4).to_bytes(4, "big")
    assert l[4:][12:16] == four and f2[4:][12:16] == four and c[4:][8:12] == four
    assert s.ctx == b"\x40\x62\0\x02"


def test_apollo_keeps_the_captured_frames(monkeypatch):
    s, sock = _login(monkeypatch, 1, db="apollo")
    s.connect("pw")
    assert [f[4:] for f in sock.sent[3:6]] == [p._SEQ_L, p._SEQ_F2, p._SEQ_C]


def test_unknown_database_is_refused_before_anything_is_read(monkeypatch):
    s, sock = _login(monkeypatch, -803, db="gibtsnicht")
    with pytest.raises(p.UnknownDatabase) as e:
        s.connect("pw")
    assert e.value.code == -803 and len(sock.sent) == 3 and sock.closed and s.sock is None
