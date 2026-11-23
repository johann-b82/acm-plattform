"""The two ways of building the feeds produce the same files: live (CachedSource, rows below
Feeds.row_floor filtered on the server and dropped while streaming) and offline from a SQLite
mirror that holds only the columns `needs()` reports. Generated data with edge cases: NULL
dates, other client (Mandant), dangling joins, trailing blanks, umlauts, tabs and quotes.

Until 23.11.2026 these tests compared against odbc-worker/worker.py. That worker was never
live and its files differ from the Apollo lists the platform reads (empty names, IDs instead
of codes, lost sub-positions, sales instead of purchasing reliability); the feeds now follow
the Apollo lists (test_feeds_mapping.py, docs/FEEDS.md)."""
from __future__ import annotations

import datetime as dt
import io
import random

import pytest

from apollo_sync import protocol as p
from apollo_sync import schema
from apollo_sync.acm import build
from apollo_sync.feeds import ARTEN, Feeds, needs
from apollo_sync.mirror import Mirror

VON = dt.date(2025, 1, 1)


# ------------------------------------------------------------------ test data
def _gen(seed: int = 7) -> dict[str, list[dict]]:
    rnd = random.Random(seed)
    S = schema.load()

    def date():
        return None if rnd.random() < 0.08 else dt.date(2021, 6, 1) + dt.timedelta(days=rnd.randrange(2000))

    def text(n=12):
        if rnd.random() < 0.15:
            return ""
        s = "".join(rnd.choice('ABCabc äöüßØµ²-./"\t') for _ in range(rnd.randrange(1, n)))
        return s + ("  " if rnd.random() < 0.2 else "")

    def tm():
        return "%02d:%02d:%02d.%02d" % (rnd.randrange(24), rnd.randrange(60), rnd.randrange(60), rnd.randrange(100))

    n_stm, n_kpf, n_pos, n_adr = 60, 120, 400, 50
    data: dict[str, list[dict]] = {}
    data["nvs_std"] = [{"nvs_id": float(i), "nvs_typ": float(t), "nvs_sprache": float(s), "nvs_nr": float(nr),
                        "nvs_kenn": f"K{t}-{nr}-{s}", "nvs_mandant": float(md)}
                       for i, (t, nr, s, md) in enumerate(
                           [(t, nr, s, md) for t in (7, 13, 14, 48, 69, 74, 250) for nr in range(4)
                            for s in (1, 2) for md in (0, 1)], start=335000)]
    data["stm_std"] = [{"stm_id": float(i), "stm_artnr": f"A{i:04d}" if i % 9 else "",
                        "stm_sk_kalk": rnd.choice([0.0, 0.0, 1.25, 12.5, 999.9999, -3.0]),
                        "stm_bez1": text(), "stm_bez2": text(), "stm_konto_ek": float(rnd.choice([0, 5400, 5900])),
                        "stm_mandant": float(rnd.choice([1, 1, 2])),
                        "stm_sperr_date": None if rnd.random() < 0.6 else date()} for i in range(1, n_stm + 1)]
    data["adr_std"] = [{"adr_id": float(i), "adr_nr": float(10000 + i), "adr_name1": text(), "adr_name2": text(),
                        "adr_name3": text(), "adr_ort": text(8), "adr_plz": text(5), "adr_datum_save": date(),
                        "adr_typ": rnd.choice([1, 8, 8, 3]), "adr_geloescht": rnd.random() < 0.1,
                        "adr_mandant": float(rnd.choice([1, 1, 2]))}
                       for i in range(1, n_adr + 1)]
    data["kpf_std"] = [{"kpf_id": float(i), "kpf_typ": float(rnd.choice([1, 2, 5, 6, 7, 8, 3])),
                        "kpf_nr": float(500000 + i), "kpf_datum": date(),
                        "kpf_adr_id": float(rnd.randrange(1, n_adr + 5)), "kpf_user_save": text(6),
                        "kpf_user_edit": text(6), "kpf_art": float(rnd.randrange(0, 5)),
                        "kpf_art2": float(rnd.choice([0, 0, 2])), "kpf_rabatt_aktion": float(rnd.choice([0, 1])),
                        "kpf_waehrung": float(rnd.randrange(0, 4)), "kpf_sperre": rnd.random() < 0.1,
                        "kpf_sperrkz": rnd.choice([0, 0, 2]),
                        "kpf_wert": round(rnd.uniform(-500, 90000), 2), "kpf_wert_f": round(rnd.uniform(0, 1000), 4),
                        "kpf_mandant": float(rnd.choice([1, 1, 1, 2]))} for i in range(1, n_kpf + 1)]
    # Positions as in production: a position carries its document's date (4 of 2.68 M have
    # none — the server filter drops those, so the generator gives every position a date),
    # and a delivery/receipt line points to an order line at most a year older (receipts of
    # 2026: oldest order line 566 days, inside the 2-year floor).
    kpf_by_id = {int(k["kpf_id"]): k for k in data["kpf_std"]}
    data["pos_std"] = []
    for i in range(1, n_pos + 1):
        kid = rnd.randrange(1, n_kpf + 8)
        head = kpf_by_id.get(kid)
        datum = (head["kpf_datum"] if head and head["kpf_datum"] else None) or (
            dt.date(2021, 6, 1) + dt.timedelta(days=rnd.randrange(2000)))
        older = [q for q in data["pos_std"] if 0 <= (datum - q["pos_datum"]).days <= 365]
        parent = rnd.choice(older) if older and rnd.random() < 0.8 else None
        data["pos_std"].append({
            "pos_id": float(i), "pos_kpf_id": float(kid), "pos_pos": float(rnd.randrange(1, 30)),
            "pos_datum": datum, "pos_lief_datum": date(), "pos_artnr": text(8), "pos_version": text(3),
            "pos_bez1": text(), "pos_menge": rnd.choice([0.0, 1.0, 2.5, 1000.125, 15.642]),
            "pos_status": float(rnd.randrange(0, 4)), "pos_preis": round(rnd.uniform(0, 99), 3),
            "pos_wert": round(rnd.uniform(0, 9999), 2), "pos_typ2": float(rnd.choice([0, 337647, 337650, 1])),
            "pos_vater_kpf_id": parent["pos_kpf_id"] if parent else float(rnd.choice([0, rnd.randrange(1, n_kpf + 3)])),
            "pos_vater_pos_id": parent["pos_id"] if parent else 0.0,
            "pos_typ": float(rnd.choice([1, 1, 5, 5, 8, 8, 2, 3])), "pos_stm_id": float(rnd.randrange(0, n_stm + 3)),
            "pos_wgr": float(rnd.choice([0, 335001, 335009, 99])), "pos_lief_wunsch": date(),
            "pos_artnr_kd": text(6), "pos_menge_rest": rnd.choice([0.0, 1.0, 7.5]),
            "pos_mandant": float(rnd.choice([1, 1, 2])), "pos_einh": float(rnd.randrange(0, 5)),
            "pos_unterpos": float(rnd.choice([0, 0, 1, 2]))})
    data["rek_std"] = [{"rek_nr": float(i), "rek_datum": date(), "rek_art": rnd.choice(["KUN RE", "IN AUD", ""]),
                        "rek_stm_id": float(rnd.choice([39, 38, 5, 0])), "rek_adr_id": float(rnd.randrange(50)),
                        "rek_kpf_id": float(rnd.choice([0, rnd.randrange(1, n_kpf)])),
                        "rek_status": float(rnd.randrange(5)), "rek_menge": rnd.choice([0.0, 3.0]),
                        "rek_menge_akz": rnd.choice([0.0, 1.5]), "rek_geloescht": rnd.random() < 0.2,
                        "rek_accept": rnd.random() < 0.5, "rek_abgelehnt": rnd.random() < 0.2,
                        "rek_accept_date": date(), "rek_abschluss_d": date(), "rek_aussteller": text(6),
                        "rek_Problembeschreib": text(40), "rek_fehlerursache": text(30),
                        "rek_kz_a01": text(4), "rek_mandant": float(rnd.choice([1, 2]))} for i in range(1, 40)]
    data["bestand_std"] = [{"bestand_stm_id": float(rnd.randrange(0, n_stm + 2)), "bestand_datum": date(),
                            "bestand_zeit": tm(), "bestand_delta": rnd.choice([-2.0, 5.5, 0.0]),
                            "bestand_charge": text(5), "bestand_vater_typ": rnd.choice(["M", "SM", "WE", ""]),
                            "bestand_grund": text(5), "bestand_user": text(5),
                            "bestand_mandant": float(rnd.choice([1, 2]))}
                           for _ in range(150)]
    data["meld_std"] = [{"meld_datum_buch": date(), "meld_zeit_buch": tm(), "meld_user": text(5), "meld_fa": float(rnd.randrange(3000, 3100)),
                         "meld_stm_id": float(rnd.randrange(0, n_stm)), "meld_menge": rnd.choice([1.0, 0.5, 7.0]),
                         "meld_mandant": float(rnd.choice([1, 2]))}
                        for _ in range(120)]
    data["fa_std"] = [{"fa_id": float(i), "fa_stm_id": float(rnd.choice([0, rnd.randrange(1, n_stm + 3)]))}
                      for i in range(3000, 3090)]
    data["vrg_std"] = [{"vrg_datum": date(), "vrg_zeit": tm(), "vrg_ansprech": text(6),
                        "vrg_typ": float(rnd.choice([335000, 335008, 335020, 0, 111])),
                        "vrg_art": float(rnd.choice([0, 335001])), "vrg_status": float(rnd.randrange(3)),
                        "vrg_mitarbeiter": text(4), "vrg_adr_id": float(rnd.randrange(0, n_adr + 4)),
                        "vrg_datum_save": date(), "vrg_user_save": text(5), "vrg_memo": text(30),
                        "vrg_kpf_typ": float(rnd.choice([0, 2, 3, 6])), "vrg_kpf_nr": float(rnd.randrange(0, 999)),
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


class _FakeApollo:
    database = "fake"

    def __init__(self, data):
        self.schema = schema.load()
        self.data = data

    def fetch(self, table, columns, server_filter=None, with_recno=False, keep=None):
        rows = self.data[table]
        out = []
        self.dropped = getattr(self, "dropped", {})
        self.filters = getattr(self, "filters", {})
        if server_filter:                         # like the server: `col >= value`, empty dates never match
            self.filters[table] = server_filter
            col, op, bound = server_filter
            assert op == ">="
            j = columns.index(col)
        for i, r in enumerate(rows, 1):
            vals = tuple(r.get(c, p.DEFAULTS[self.schema[table].column(c).type]) for c in columns)
            if server_filter and (vals[j] is None or vals[j] < bound):
                self.dropped[table] = self.dropped.get(table, 0) + 1
                continue
            if keep is not None and not keep(vals):
                self.dropped[table] = self.dropped.get(table, 0) + 1
                continue
            out.append((i, *vals) if with_recno else vals)
        if server_filter:                         # the real server answers a filtered query in index order
            out.reverse()
        return out


class _FullScan:
    """Reference source: every row, every needed column, no floor and no server filter."""

    def __init__(self, data):
        self.fake = _FakeApollo(data)

    def rows(self, table, columns):
        return self.fake.fetch(table, columns)


def _run_mirror(data, arten, tmp_path):
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


def _reference(data, art):
    return Feeds(_FullScan(data)).builders()[art](VON)


@pytest.mark.parametrize("art", ARTEN)
def test_mirror_equals_full_scan(art, tmp_path):
    """Offline from a mirror with only the needed columns = full scan of every row."""
    ref = _reference(_gen(), art)
    new = _run_mirror(_gen(), [art], tmp_path)[art]
    if isinstance(new, Exception):
        raise new
    assert new[0] == ref[0]
    assert _content(*new) == _content(*ref)


@pytest.mark.parametrize("art", ARTEN)
def test_live_path_with_row_floor_equals_full_scan(art):
    """Live (CachedSource, server-side floor, rows below Feeds.row_floor dropped while
    streaming) = full scan: the floor never drops a row a feed uses."""
    data = _gen()
    ref = _reference(data, art)
    new = build([art], VON, apollo=_FakeApollo(data))[0][art]
    if isinstance(new, Exception):
        raise new
    assert _content(*new) == _content(*ref)


def test_row_floor_drops_rows():
    """Guard against a vacuous floor test: the generated data has rows below every floor."""
    fake = _FakeApollo(_gen())
    build(list(ARTEN), VON, apollo=fake)
    assert set(fake.dropped) == {"pos_std", "meld_std", "bestand_std", "vrg_std", "rek_std"}
    assert all(n > 3 for n in fake.dropped.values()), fake.dropped
    # the floor is sent to the server (rows never cross the wire), exactly for the floored tables
    assert {t: f[0] for t, f in fake.filters.items()} == {t: c for t, (c, _) in Feeds.row_floor(VON).items()}


def test_server_floor_keeps_record_order():
    """A server-filtered read comes back in another order; the cache restores record order, so
    the files are the same as with a full scan + local filter."""
    from apollo_sync.client import CachedSource
    data = _gen()
    col, bound = Feeds.row_floor(VON)["pos_std"]
    cols = ["pos_id", col, "pos_menge"]
    src = CachedSource(_FakeApollo(data), row_floor={"pos_std": (col, bound)})
    got = list(src.rows("pos_std", cols))
    scan = [r for r in _FakeApollo(data).fetch("pos_std", cols) if r[1] is not None and r[1] >= bound]
    assert got == scan and len(got) > 3


def test_only_needed_columns_are_read():
    """The columns a run reads are exactly what the feeds use: per feed derived from the code
    (a mirror with only those columns is enough, see above), and for all feeds a small
    fraction of each table."""
    s = schema.load()
    plan = needs(ARTEN)
    assert sum(len(c) for c in plan.values()) < 140                  # 129 of ~2,350 columns
    for t, cols in plan.items():
        assert set(cols) <= {c.name for c in s[t].columns}, t
        assert len(cols) <= 35 and len(cols) < len(s[t].columns) / 4, t
    assert needs(["umsatz"]) == {
        "adr_std": ["adr_id", "adr_name1", "adr_name2", "adr_name3", "adr_nr", "adr_ort", "adr_plz"],
        "kpf_std": sorted(["kpf_id", "kpf_typ", "kpf_nr", "kpf_datum", "kpf_adr_id", "kpf_user_save",
                           "kpf_user_edit", "kpf_art", "kpf_art2", "kpf_rabatt_aktion", "kpf_waehrung",
                           "kpf_wert", "kpf_wert_f", "kpf_mandant"]),
        "nvs_std": ["nvs_id", "nvs_kenn", "nvs_mandant", "nvs_nr", "nvs_sprache", "nvs_typ"],
        "pos_std": sorted(Feeds._POS_SPALTEN),
    }


def test_feeds_produce_rows():
    """Guard against a vacuous equivalence: the generated data must hit every feed."""
    data = _gen()
    for art in ARTEN:
        name, content = _reference(data, art)
        n = len(_content(name, content)) - 1
        assert n > 0, f"{art}: test data produces no rows"
