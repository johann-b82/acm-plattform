"""The new feeds must produce exactly what the production worker (odbc-worker/worker.py on
`main`) produced. The original worker runs its own, unchanged SQL against SQLite (standing in
for the driver: dates as datetime.date, times as datetime.time with whole seconds, doubles
as float); the new feeds read the same data through the SQLite mirror. Data is generated with
edge cases: NULL dates, other client (Mandant), dangling joins, trailing blanks, umlauts."""
from __future__ import annotations

import datetime as dt
import importlib.util
import io
import random
import re
import sqlite3
from pathlib import Path

import pytest

from apollo_sync import protocol as p
from apollo_sync import schema
from apollo_sync.acm import build
from apollo_sync.feeds import ARTEN, needs
from apollo_sync.mirror import Mirror

ROOT = Path(__file__).resolve().parents[2]
WORKER = ROOT / "odbc-worker" / "worker.py"
VON = dt.date(2025, 1, 1)


def _load_worker():
    spec = importlib.util.spec_from_file_location("old_worker", WORKER)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ------------------------------------------------------------------ test data
def _gen(seed: int = 7) -> dict[str, list[dict]]:
    rnd = random.Random(seed)
    S = schema.load()

    def date():
        return None if rnd.random() < 0.08 else dt.date(2023, 1, 1) + dt.timedelta(days=rnd.randrange(1600))

    def text(n=12):
        if rnd.random() < 0.15:
            return ""
        s = "".join(rnd.choice("ABCabc äöüßØµ²-./") for _ in range(rnd.randrange(1, n)))
        return s + ("  " if rnd.random() < 0.2 else "")

    def tm():
        return "%02d:%02d:%02d.%02d" % (rnd.randrange(24), rnd.randrange(60), rnd.randrange(60), rnd.randrange(100))

    n_stm, n_kpf, n_pos, n_adr = 60, 120, 400, 50
    data: dict[str, list[dict]] = {}
    data["stm_std"] = [{"stm_id": float(i), "stm_artnr": f"A{i:04d}" if i % 9 else "",
                        "stm_sk_kalk": rnd.choice([0.0, 0.0, 1.25, 12.5, 999.9999, -3.0]),
                        "stm_bez1": text()} for i in range(1, n_stm + 1)]
    data["adr_std"] = [{"adr_id": float(i), "adr_nr": float(10000 + i), "adr_name1": text(),
                        "adr_ort": text(8), "adr_datum_save": date(), "adr_typ": rnd.choice([1, 8, 8, 3])}
                       for i in range(1, n_adr + 1)]
    data["kpf_std"] = [{"kpf_id": float(i), "kpf_typ": float(rnd.choice([1, 2, 5, 6, 7, 8, 3])),
                        "kpf_nr": float(500000 + i), "kpf_datum": date(),
                        "kpf_adr_id": float(rnd.randrange(1, n_adr + 5)), "kpf_user_save": text(6),
                        "kpf_wert": round(rnd.uniform(-500, 90000), 2), "kpf_wert_f": round(rnd.uniform(0, 1000), 4),
                        "kpf_mandant": float(rnd.choice([1, 1, 1, 2]))} for i in range(1, n_kpf + 1)]
    data["pos_std"] = [{"pos_id": float(i), "pos_kpf_id": float(rnd.randrange(1, n_kpf + 8)),
                        "pos_pos": float(rnd.randrange(1, 30)), "pos_datum": date(), "pos_lief_datum": date(),
                        "pos_artnr": text(8), "pos_menge": rnd.choice([0.0, 1.0, 2.5, 1000.125]),
                        "pos_status": float(rnd.randrange(0, 4)), "pos_preis": round(rnd.uniform(0, 99), 3),
                        "pos_wert": round(rnd.uniform(0, 9999), 2), "pos_typ2": float(rnd.choice([0, 337647, 337650])),
                        "pos_vater_kpf_id": float(rnd.choice([0, rnd.randrange(1, n_kpf + 3)])),
                        "pos_typ": float(rnd.choice([1, 1, 5, 5, 8, 2])), "pos_stm_id": float(rnd.randrange(0, n_stm + 3)),
                        "pos_wgr": float(rnd.randrange(0, 5)), "pos_lief_wunsch": date(),
                        "pos_mandant": float(rnd.choice([1, 1, 2])),
                        "pos_vater_pos_id": float(rnd.randrange(0, n_pos)), "pos_einh": float(rnd.randrange(0, 3))}
                       for i in range(1, n_pos + 1)]
    data["rek_std"] = [{"rek_nr": float(i), "rek_datum": date(), "rek_art": rnd.choice(["KUN RE", "IN AUD", ""]),
                        "rek_stm_id": float(rnd.choice([39777, 39778, 5, 0])), "rek_adr_id": float(rnd.randrange(50)),
                        "rek_status": float(rnd.randrange(3)), "rek_menge": rnd.choice([0.0, 3.0]),
                        "rek_menge_akz": rnd.choice([0.0, 1.5]), "rek_geloescht": rnd.random() < 0.2,
                        "rek_mandant": float(rnd.choice([1, 2]))} for i in range(1, 40)]
    data["bestand_std"] = [{"bestand_stm_id": float(rnd.randrange(0, n_stm + 2)), "bestand_datum": date(),
                            "bestand_zeit": tm(), "bestand_delta": rnd.choice([-2.0, 5.5, 0.0]),
                            "bestand_charge": text(5), "bestand_vater_typ": rnd.choice(["M", "SM", "WE", ""]),
                            "bestand_grund": text(5), "bestand_mandant": float(rnd.choice([1, 2]))}
                           for _ in range(150)]
    data["rsc_std"] = [{"rsc_id": float(i), "rsc_stm_id": float(rnd.randrange(1, n_stm))} for i in range(1, 30)]
    data["meld_std"] = [{"meld_datum_buch": date(), "meld_zeit_buch": tm(), "meld_fa": float(rnd.randrange(3000, 3100)),
                         "meld_stm_id": float(rnd.randrange(0, n_stm)), "meld_menge": rnd.choice([1.0, 0.5, 7.0]),
                         "meld_rsc_id": float(rnd.randrange(0, 35)), "meld_mandant": float(rnd.choice([1, 2]))}
                        for _ in range(120)]
    data["vrg_std"] = [{"vrg_datum": date(), "vrg_zeit": tm(), "vrg_ansprech": text(6),
                        "vrg_typ": float(rnd.choice([340521, 335768, 338266, 0, 111])), "vrg_status": float(rnd.randrange(3)),
                        "vrg_mitarbeiter": text(4), "vrg_adr_id": float(rnd.randrange(0, n_adr + 4)),
                        "vrg_datum_save": date(), "vrg_user_save": text(5), "vrg_text1": text(20),
                        "vrg_kpf_typ": float(rnd.choice([0, 2, 6])), "vrg_kpf_nr": float(rnd.randrange(0, 999)),
                        "vrg_mandant": float(rnd.choice([1, 2]))} for _ in range(80)]
    # coerce to the exact wire types (int columns as int, like the driver)
    for t, rows in data.items():
        cols = {c.name: c.type for c in S[t].columns}
        for r in rows:
            for k, v in r.items():
                ty = cols[k]
                if ty in (p.T_I16, p.T_I32, p.T_I64) and v is not None:
                    r[k] = int(v)
                elif ty == p.T_DBL and v is not None and not isinstance(v, bool):
                    r[k] = float(v)
                elif ty == p.T_BOOL:
                    r[k] = bool(v)
    return data


# ------------------------------------------------------------------ old worker on SQLite
def _old_db(data) -> sqlite3.Connection:
    S = schema.load()
    sqlite3.register_converter("C16DATE", lambda b: dt.date.fromisoformat(b.decode()))
    sqlite3.register_converter("C16TIME", lambda b: dt.time(*map(int, b.decode()[:8].split(":"))))
    sqlite3.register_converter("C16BOOL", lambda b: bool(int(b)))
    db = sqlite3.connect(":memory:", detect_types=sqlite3.PARSE_DECLTYPES)
    decl = {p.T_DATE: "C16DATE", p.T_TIME: "C16TIME", p.T_BOOL: "C16BOOL", p.T_DBL: "REAL",
            p.T_STR: "TEXT", p.T_I16: "INTEGER", p.T_I32: "INTEGER", p.T_I64: "INTEGER"}
    for t, rows in data.items():
        cols = list(rows[0])
        types = {c.name: c.type for c in S[t].columns}
        db.execute(f"CREATE TABLE {t} (" + ", ".join(f"{c} {decl[types[c]]}" for c in cols) + ")")
        db.executemany(f"INSERT INTO {t} VALUES ({','.join('?' * len(cols))})",
                       [[(v.isoformat() if isinstance(v, dt.date) else int(v) if isinstance(v, bool) else v)
                         for v in (r[c] for c in cols)] for r in rows])
    return db


def _run_old(data, arten):
    w = _load_worker()
    db = _old_db(data)

    def q(sql, *params):
        for prm in params:
            sql = sql.replace("?", w._lit(prm), 1)
        sql = re.sub(r"\{d '([0-9-]+)'\}", r"'\1'", sql)       # ODBC date literal -> ISO text
        return db.execute(sql)

    w.q = q
    w._STM = None
    w.MANDANT = 1
    return {a: w.BUILDERS[a](VON) for a in arten}


# ------------------------------------------------------------------ new feeds via the mirror
class _FakeApollo:
    database = "fake"

    def __init__(self, data):
        self.schema = schema.load()
        self.data = data

    def fetch(self, table, columns, server_filter=None, with_recno=False):
        rows = self.data[table]
        out = []
        for i, r in enumerate(rows, 1):
            vals = tuple(r.get(c, p.DEFAULTS[self.schema[table].column(c).type]) for c in columns)
            out.append((i, *vals) if with_recno else vals)
        return out


def _run_new(data, arten, tmp_path):
    m = Mirror(str(tmp_path / "mirror.sqlite"))
    fake = _FakeApollo(data)
    for t, cols in needs(arten).items():        # mirror ONLY the columns the feed reads
        m.pull(fake, t, cols)
    built, _ = build(arten, VON, source=m)
    return built


def _content(name: str, data: bytes) -> list:
    if name.endswith(".xlsx"):
        openpyxl = pytest.importorskip("openpyxl")
        ws = openpyxl.load_workbook(io.BytesIO(data)).active
        rows = [tuple(c.value for c in r) for r in ws.iter_rows()]
        return [rows[0]] + sorted(rows[1:], key=repr)
    lines = data.split(b"\r\n")
    return [lines[0]] + sorted(lines[1:])


@pytest.mark.parametrize("art", ARTEN)
def test_feed_equals_production_worker(art, tmp_path):
    data = _gen()
    old = _run_old(data, [art])[art]
    new = _run_new(data, [art], tmp_path)[art]
    if isinstance(new, Exception):
        raise new
    assert new[0] == old[0], "file name"
    assert _content(*new) == _content(*old)
    if not new[0].endswith(".xlsx"):
        assert len(new[1]) == len(old[1])


def test_only_needed_columns_are_read():
    """The columns a run reads are exactly what the feeds use: per feed derived from the code
    (a mirror with only those columns is enough, see test above), and for all feeds a small
    fraction of each table."""
    s = schema.load()
    plan = needs(ARTEN)
    assert sum(len(c) for c in plan.values()) < 100                  # 78 of 2,350 columns
    for t, cols in plan.items():
        assert len(cols) <= 20 and set(cols) <= {c.name for c in s[t].columns}, t
    assert needs(["umsatz"]) == {"kpf_std": sorted(["kpf_typ", "kpf_nr", "kpf_datum", "kpf_adr_id",
                                                     "kpf_user_save", "kpf_wert", "kpf_wert_f",
                                                     "kpf_mandant"])}


def test_feeds_produce_rows():
    """Guard against a vacuous equivalence: the generated data must hit every feed."""
    data = _gen()
    old = _run_old(data, list(ARTEN))
    for art, (name, content) in old.items():
        n = len(_content(name, content)) - 1
        assert n > 0, f"{art}: test data produces no rows"
