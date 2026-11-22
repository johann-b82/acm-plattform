"""Offline protocol tests: frames byte-exact against the Windows driver, row decoding."""
import datetime as dt
import json
import struct
from pathlib import Path

import pytest

from apollo_sync import protocol as p
from apollo_sync import schema

FIX = json.loads((Path(__file__).parent / "fixtures" / "driver_frames.json").read_text())


@pytest.mark.parametrize("table", sorted(FIX["tables"]))
def test_projection_byte_exact_against_driver(table):
    f = FIX["tables"][table]
    ctx = bytes.fromhex(f["ctx"])
    t = schema.load()[table]
    mine = p.projection_frames(ctx, t.file, [c.address for c in t.columns])
    assert [m.hex() for m in mine] == f["projection"]


@pytest.mark.parametrize("table", sorted(FIX["tables"]))
def test_small_frames_byte_exact(table):
    f = FIX["tables"][table]
    ctx = bytes.fromhex(f["ctx"])
    assert p._small(ctx, 0x92).hex() == f["q92"]
    assert p._small(ctx, 0xB1, b"\0\0").hex() == f["b1_first"]
    assert p._small(ctx, 0x94, bytes(18) + b"\x01").hex() == f["q94"]


@pytest.mark.parametrize("table", sorted(FIX["tables"]))
def test_filter_byte_exact_where_supported(table):
    f = FIX["tables"][table]
    raw = bytes.fromhex(f["filter"])
    ctx = bytes.fromhex(f["ctx"])
    ins = raw[56:]
    i = ins.index(b"\x03\x16\x00\x00")
    ty = ins[i + 5]
    sub = int.from_bytes(ins[i + 10:i + 12], "little")
    fld = int.from_bytes(ins[i + 13:i + 15], "little")
    if ty not in (p.T_DBL, p.T_I64):
        pytest.skip(f"constant encoding for wire type {ty} not implemented")
    file = schema.load()[table].file
    assert p.filter_frame(ctx, file, (ty, sub, fld), ">", 999999999).hex() == f["filter"]


def _row(fields: list[bytes], recno: int = 7) -> bytes:
    head = bytes(20) + b"\xfd\xf1" + bytes(6)
    return head + b"\x80\x00" + struct.pack("<q", recno) + b"".join(fields) + b"\x00"


def test_decode_all_types_and_tags():
    types = [p.T_DBL, p.T_I16, p.T_I32, p.T_I64, p.T_BOOL, p.T_DATE, p.T_TIME, p.T_STR, p.T_STR, p.T_DBL]
    long_text = "x" * 300
    fields = [
        b"\x80\x01" + struct.pack("<d", 1.5),
        b"\x80\x02" + struct.pack("<h", -2),
        b"\x80\x03" + struct.pack("<i", 70000),
        b"\x80\x04" + struct.pack("<q", 2**40),
        b"\x80\x05\x01",
        b"\x80\x06" + bytes([126, 11, 1, 0]),
        b"\x80\x07" + bytes([24, 0, 0, 0]),                     # hour 24 exists in real data
        b"\x90\x08\x04ab  ",                                     # trailing blanks are data
        b"\xa4\x09" + len(long_text).to_bytes(2, "little") + long_text.encode(),  # u16 length
    ]
    recno, v = p.decode_row(_row(fields), types, [p.DEFAULTS[t] for t in types])
    assert recno == 7
    assert v == [1.5, -2, 70000, 2**40, True, dt.date(2026, 11, 1), "24:00:00.00", "ab  ", long_text, 0.0]


def test_decode_u16_index_and_defaults():
    n = 300
    types = [p.T_DATE] * n
    fields = [b"\xc0" + (290).to_bytes(2, "little") + bytes([101, 4, 5, 0])]
    _, v = p.decode_row(_row(fields), types, [p.DEFAULTS[t] for t in types])
    assert v[289] == dt.date(2001, 4, 5)
    assert v[0] is None and v[-1] is None


def test_charset_special_characters():
    # server bytes for ä ö ü ß µ Ø ² à (driver table 0xcf0db0, verified on stm_std)
    assert p.decode_str(bytes([0xA3, 0xCC, 0xE8, 0xEE, 0xE6, 0xEB, 0xFD, 0x85])) == "äöüßµØ²à"
    assert p.decode_str(bytes([0x03])) == "€"


def test_login_token_shape():
    tok = p.login_token("geheim")
    assert len(tok) == 40 and tok.upper() == tok
