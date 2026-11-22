"""CONZEPT 16 (Apollo) wire protocol: session handshake and the server-side query path.

The Windows ODBC driver is not needed. Reading uses the server's query path:

    0x92            open query
    0x93 / 0002     filter program (optional, evaluated on the server)
    0x93 / 0001     projection program (file / sub-record / field / wire type per column)
    0xb1            fetch one row; the request is constant, so fetches are pipelined
    0x94            close query
    0x98, 0x65      logout (exactly like the driver)

A result row is a sparse tagged field list starting at body offset 28:
    tag 0x80 present, 0x40 -> u16 index (else u8), 0x10 -> string with u8 length,
    0x20 -> string with u16 length, 0x00 -> end of row. Index 0 is the record number
    (i64); absent fields carry their type's default (as the driver reports them).

Verified against the driver: stm_std 39,809 rows / 31,289,874 cells and mwst_std, 0
differences; strings keep trailing blanks exactly like the driver.
"""
from __future__ import annotations

import codecs
import datetime as dt
import hashlib
import socket
import struct
from collections.abc import Iterator, Sequence

Z = bytes(1)

# wire type codes
T_STR, T_DATE, T_I16, T_NUM, T_I32, T_I64, T_DBL, T_BOOL, T_TIME = 1, 2, 4, 5, 7, 8, 9, 10, 11
DEFAULTS = {T_STR: "", T_DATE: None, T_I16: 0, T_NUM: None, T_I32: 0, T_I64: 0, T_DBL: 0.0,
            T_BOOL: False, T_TIME: "00:00:00.00"}

# handshake frames (session tag 4704); the E frame carries the login token
_HDR_E = bytes.fromhex("0000000045003b050000000d00004704000000000400000000000000")
_HDR_F = bytes.fromhex("0000000046003b050000000000004704000000000400000000000000")
_HDR_X = bytes.fromhex("0000000058003b050000000000004704000000000400000000000000")
_SEQ_L = bytes.fromhex("000000004c003b050005083b00000001000000000400000000000000")
_SEQ_F2 = bytes.fromhex("0000000046003b050005083b00000001000000000400000000000000")
_SEQ_C = bytes.fromhex("0000000063001708000000011002000800000000040000000000000000000000"
                       "000000000000000000000000000000000000000000000000")
_SEQ_D = bytes.fromhex("0000000064000000000000000000000000000000000000000000000000000000")

# server charset -> CP1252 (driver table at c16_odbc_driver.dll offset 0xcf0db0, the second of
# its three variants; verified on every special character of stm_std). Undefined CP1252 bytes
# pass through as the matching C1 code point, as on Windows.
_SRV2CP = bytes.fromhex(
    "000102800405060708090a0b0c0d0e0f10111213b6a7161718191a1b1c1d1e1f"
    "202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f"
    "404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f"
    "606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f"
    "c7c0e9e2fae0e5e7eaebe8efeeecf4c5c9e6c6c499f2fbf9ff9cc1a2a3a5c29f"
    "e1edf3e4f1d1aabaa8a9acbdbcadabbb038182838414158e8f949395d6c8be85"
    "868788898a8ba1a4969d9798f69a9ba6aeafd2d3d4d5b8d7dc8c8d9291b4ca90"
    "b9bfcbe3cccdb5cefccfd0d8d9f8dfdaf0b1dbdddef5f7b3b0c3b7fdfeb29ea0")


def _w1252(b: int) -> str:
    try:
        return bytes([b]).decode("cp1252")
    except UnicodeDecodeError:
        return chr(b)


_DECODING_TABLE = "".join(_w1252(_SRV2CP[i]) for i in range(256))


def decode_str(raw: bytes) -> str:
    return codecs.charmap_decode(raw, "strict", _DECODING_TABLE)[0]


class ProtocolError(RuntimeError):
    """Unexpected reply from the server."""


class SessionRefused(RuntimeError):
    """The server refused a new session (handshake reply code, e.g. -817/-814).
    Observed when an aborted session of the same user is still held by the server;
    it clears after about 30 minutes. Never retry quickly."""

    def __init__(self, code: int):
        super().__init__(f"server refused the session (code {code})")
        self.code = code


class ServerAbort(ConnectionError):
    """The server reset the connection during a query. The aborted session blocks new
    logins of the same user for about 30 minutes."""


def login_token(password: str) -> bytes:
    p = password.encode("latin-1")
    rep = (p * (64 // len(p) + 1))[:64]
    return hashlib.sha1(rep + Z * (72 - len(rep))).hexdigest().upper().encode("ascii")


def _frame(body: bytes) -> bytes:
    return (4 + len(body)).to_bytes(4, "big") + body


def _qframe(ctx: bytes, sub: bytes, kind: bytes, chunk: int, instr: bytes) -> bytes:
    blen = 24 + len(instr)
    body = (b"XEMS" + kind + Z * 6 + blen.to_bytes(4, "little") + chunk.to_bytes(4, "little")
            + Z * 4 + instr)
    return (32 + blen).to_bytes(4, "big") + ctx + b"\x93" + sub + Z * 5 + blen.to_bytes(4, "little") + Z * 12 + body


def _arg16(v: int) -> bytes:
    return b"\x20" + int(v).to_bytes(2, "little") + Z


def _fref(ty: int, file: int, sub: int, field: int) -> bytes:
    return (b"\x10" + bytes([ty]) + b"\x20" + file.to_bytes(2, "little") + b"\x20"
            + sub.to_bytes(2, "little") + b"\x20" + field.to_bytes(2, "little") + Z)


def _ins(op: int, args: bytes) -> bytes:
    return bytes([op]) + b"\x16\x00\x00" + args


def projection_frames(ctx: bytes, file: int, fields: Sequence[tuple[int, int, int]],
                      maxinstr: int = 4468) -> list[bytes]:
    """fields: (wire type, sub-record, field) -> 0x93/0001 frames, chunked like the driver
    (non-final chunks zero-padded to 4468 instruction bytes)."""
    ins = ([_ins(0x07, _arg16(len(fields) + 1)), _ins(0x08, _arg16(file))]
           + [_ins(0x09, _fref(t, file, s, f)) for (t, s, f) in fields] + [_ins(0x0A, Z * 5)])
    chunks, cur = [], b""
    for x in ins:
        if len(cur) + len(x) > maxinstr:
            chunks.append(cur + Z * (maxinstr - len(cur)))
            cur = b""
        cur += x
    chunks.append(cur)
    return [_qframe(ctx, b"\x00\x01", b"\x00\x01", i, c) for i, c in enumerate(chunks)]


_OPS = {">": 0x06, ">=": 0x07}


def _const(ty: int, value) -> bytes:
    if ty == T_DBL:
        return b"\x10\x09\x81" + struct.pack("<d", float(value)) + Z
    if ty == T_I64:
        return b"\x10\x08\x83" + struct.pack("<q", int(value)) + Z
    if ty == T_DATE:
        if isinstance(value, (dt.date, dt.datetime)):
            value = (value.year, value.month, value.day)
        y, m, d = value
        return b"\x10\x02\x41" + bytes([y - 1900, m, d, 0]) + Z
    raise ValueError(f"server filter on wire type {ty} is not verified")


def filter_frame(ctx: bytes, file: int, field: tuple[int, int, int], op: str, value) -> bytes:
    """Single comparison evaluated by the server. Only worthwhile on indexed columns: on a
    non-indexed column the server is about 3x slower than a projection filtered locally."""
    t, s, f = field
    ins = (_ins(0x01, _arg16(file)) + _ins(0x03, _fref(t, file, s, f)) + _ins(0x04, _const(t, value))
           + _ins(0x02, b"\x10" + bytes([_OPS[op]]) + Z * 5))
    return _qframe(ctx, b"\x00\x02", b"\x01\x01", 0, ins)


def _small(ctx: bytes, op: int, tail: bytes = b"") -> bytes:
    return ((32).to_bytes(4, "big") + ctx + bytes([op]) + tail).ljust(32, Z)


def is_partial(x: bytes) -> bool:
    """A reply is at most 4,632 bytes. A longer record arrives in several replies; all but the
    last lack the `fd f1` marker at body[20:22] and end without an end tag."""
    return len(x) > 32 and x[20:22] != b"\xfd\xf1"


_FIXED = {T_DBL: 8, T_I32: 4, T_I16: 2, T_I64: 8, T_BOOL: 1, T_DATE: 4, T_TIME: 4}


def decode_row(x: bytes | Sequence[bytes], types: Sequence[int], defaults: Sequence) -> tuple[int | None, list]:
    """Decode one record (one reply body, or the list of replies of a multi-reply record)
    -> (record number, values). Strict: any inconsistency raises ProtocolError.

    Continuation of a split field: tag bit 0x08, then length (u8/u16 as usual) and a u16 offset
    = bytes of the field already delivered; the data is appended."""
    frames = [x] if isinstance(x, (bytes, bytearray)) else list(x)
    vals = list(defaults)
    recno = None
    nt = len(types)
    unpack = struct.unpack_from
    for fi, x in enumerate(frames):
        last = fi == len(frames) - 1
        p, n, ended = 28, len(x), False
        while p < n:
            start = p
            tag = x[p]
            p += 1
            if tag == 0:
                if p != n or not last:
                    raise ProtocolError(f"end tag at {start} before the end of the record")
                ended = True
                break
            if not tag & 0x80:
                raise ProtocolError(f"invalid tag {tag:#04x} at byte {start} of reply {fi}")
            if tag & 0x40:
                idx = x[p] | (x[p + 1] << 8)
                p += 2
            else:
                idx = x[p]
                p += 1
            if idx == 0:
                recno = unpack("<q", x, p)[0]
                p += 8
                continue
            if idx > nt:
                raise ProtocolError(f"field index {idx} > {nt} at byte {start} of reply {fi}")
            t = types[idx - 1]
            if tag & 0x30:
                if tag & 0x10:
                    ln = x[p]
                    p += 1
                else:
                    ln = x[p] | (x[p + 1] << 8)
                    p += 2
                if tag & 0x08:                       # continuation of a split string field
                    off = x[p] | (x[p + 1] << 8)
                    p += 2
                    prev = vals[idx - 1] if isinstance(vals[idx - 1], str) else ""
                    if off != len(prev):
                        raise ProtocolError(f"field {idx}: continuation offset {off} != {len(prev)} delivered")
                else:
                    prev = ""
                if p + ln > n:
                    raise ProtocolError(f"field {idx}: {ln} bytes announced, {n - p} left in reply {fi}")
                vals[idx - 1] = prev + decode_str(x[p:p + ln])
                p += ln
                continue
            if p + _FIXED.get(t, 0) > n:
                raise ProtocolError(f"field {idx}: fixed value truncated in reply {fi}")
            if t == T_DBL:
                v = unpack("<d", x, p)[0]
            elif t == T_I32:
                v = unpack("<i", x, p)[0]
            elif t == T_I16:
                v = unpack("<h", x, p)[0]
            elif t == T_I64:
                v = unpack("<q", x, p)[0]
            elif t == T_BOOL:
                v = x[p] != 0
            elif t == T_DATE:
                y, m, d = x[p], x[p + 1], x[p + 2]
                try:
                    v = None if y == m == d == 0 else dt.date(1900 + y, m, d)
                except ValueError as exc:
                    raise ProtocolError(f"field {idx}: invalid date bytes {x[p:p + 4].hex()}") from exc
            elif t == T_TIME:
                # lossless text: real data contains hour 24 (end of day)
                v = "%02d:%02d:%02d.%02d" % (x[p], x[p + 1], x[p + 2], x[p + 3])
            else:
                raise ProtocolError(f"wire type {t:#x} (field {idx}) is not supported")
            p += _FIXED[t]
            vals[idx - 1] = v
        if last and not ended:
            raise ProtocolError(f"record without end tag ({len(frames)} replies)")
        if not last and p != n:
            raise ProtocolError("partial reply does not end at a field boundary")
    return recno, vals


class DecodeFailure(ProtocolError):
    """A record could not be decoded. The session was drained and the query closed (no abort);
    `frames` holds the raw replies of the record for the incident log / offline replay."""

    def __init__(self, cause: Exception, frames: list[bytes], row_index: int):
        super().__init__(f"row {row_index}: {cause}")
        self.cause, self.frames, self.row_index = cause, frames, row_index


class Session:
    """One server session. Not thread-safe; the server processes sessions serially,
    so a second session brings no throughput (measured)."""

    def __init__(self, host: str, port: int = 4722, database: str = "apollo", timeout: float = 120):
        self.host, self.port, self.database, self.timeout = host, port, database, timeout
        self.sock: socket.socket | None = None
        self.ctx = b""

    # framing
    def _recv_exact(self, n: int) -> bytes:
        buf = bytearray()
        while len(buf) < n:
            try:
                c = self.sock.recv(n - len(buf))
            except ConnectionResetError as exc:
                raise ServerAbort("connection reset by the server") from exc
            if not c:
                raise ServerAbort("connection closed by the server")
            buf += c
        return bytes(buf)

    def _recv(self) -> bytes:
        n = int.from_bytes(self._recv_exact(4), "big")
        return self._recv_exact(n - 4)

    def _send(self, data: bytes) -> None:
        try:
            self.sock.sendall(data)
        except ConnectionResetError as exc:
            raise ServerAbort("connection reset by the server") from exc

    def _rq(self, frame: bytes) -> bytes:
        self._send(frame)
        return self._recv()

    def connect(self, password: str) -> "Session":
        token = login_token(password)
        s = socket.create_connection((self.host, self.port), timeout=self.timeout)
        s.settimeout(self.timeout)
        s.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        self.sock = s
        try:
            def step(body: bytes) -> bytes:
                return self._rq(_frame(body))

            step(_HDR_E + token)
            step(_HDR_F)
            step(_HDR_X + self.database.encode("latin-1") + Z)
            step(_SEQ_L)
            step(_SEQ_F2)
            c = step(_SEQ_C)
            d = step(_SEQ_D)
            code = int.from_bytes(c[8:12], "big", signed=True)
            if d[:4] == b"\0\0\0\0":
                raise SessionRefused(code if code < 0 else int.from_bytes(d[8:12], "big", signed=True))
            self.ctx = d[:4]
        except BaseException:
            self.sock.close()
            self.sock = None
            raise
        return self

    def close(self) -> None:
        """Clean logout like the driver: 0x98 (with reply), 0x65 (no reply)."""
        if not self.sock:
            return
        try:
            self._rq(_small(self.ctx, 0x98))
            self._send(_small(self.ctx, 0x65, Z * 15 + b"\xfd\xf1"))
        except (OSError, ServerAbort):
            pass
        finally:
            self.sock.close()
            self.sock = None

    def __enter__(self) -> "Session":
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    def query(self, file: int, fields: Sequence[tuple[int, int, int]],
              server_filter: tuple[tuple[int, int, int], str, object] | None = None,
              batch: int = 256, limit: int | None = None) -> Iterator[tuple[int | None, list]]:
        """Yield (record number, values) for every row (at most `limit`). The generator must be
        consumed completely before the next query on this session. With `limit` the pipeline
        is stopped cleanly: no further requests, the ones in flight are received, then the
        query is closed — the same sequence as at the natural end of the data."""
        ctx = self.ctx
        types = [f[0] for f in fields]
        defaults = [DEFAULTS[t] for t in types]
        self._rq(_small(ctx, 0x92))
        if server_filter:
            fld, op, val = server_filter
            self._rq(filter_frame(ctx, file, fld, op, val))
        for fr in projection_frames(ctx, file, fields):
            self._rq(fr)
        # Accounting: every 0xb1 request is answered by exactly ONE final reply (a complete
        # record, or end-of-data). A record longer than one reply is preceded by partial replies
        # that the server sends unsolicited for the same request — they do not answer a request.
        # The query is closed only when every request is answered, so nothing is left in flight.
        if limit is not None and limit <= 0:
            self._rq(_small(ctx, 0x94, Z * 18 + b"\x01"))
            return
        pending: list[bytes] = []
        done = False
        failure: DecodeFailure | None = None
        yielded = 0
        if limit is not None:
            batch = max(1, min(batch, limit))
        nxt = _small(ctx, 0xB1, Z + b"\x01") * batch
        self._send(_small(ctx, 0xB1, Z * 2))
        outstanding, started = 1, False
        while outstanding:
            r = self._recv()
            if is_partial(r):
                if not done:
                    pending.append(r)
                continue                                   # not an answer: outstanding unchanged
            outstanding -= 1
            if not done:
                if len(r) <= 32:                           # end of data
                    if pending:
                        failure = DecodeFailure(ProtocolError("end of data inside a split record"),
                                                pending, yielded)
                    done = True
                else:
                    frames, pending = pending + [r], []
                    try:
                        row = decode_row(frames if len(frames) > 1 else frames[0], types, defaults)
                    except ProtocolError as exc:
                        # never break off mid-stream: stop requesting, drain, close cleanly, raise
                        failure, done = DecodeFailure(exc, frames, yielded), True
                    else:
                        yield row
                        yielded += 1
                        if limit is not None and yielded >= limit:
                            done = True                    # stop: only drain what is in flight
            if not done:
                if not started:
                    # keep two batches in flight so the pipeline never drains
                    self._send(nxt)
                    self._send(nxt)
                    outstanding += 2 * batch
                    started = True
                elif outstanding == batch:
                    self._send(nxt)
                    outstanding += batch
        self._rq(_small(ctx, 0x94, Z * 18 + b"\x01"))
        if failure is not None:
            raise failure
