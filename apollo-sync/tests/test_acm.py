"""run_once: dry run writes into a folder that does not exist yet (regression: all 14 feeds
failed after an 8-minute read because the output folder was missing)."""
import datetime as dt

from apollo_sync import acm


class _NoSession:
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def test_dry_run_creates_output_folder(tmp_path, monkeypatch):
    monkeypatch.setattr(acm.Apollo, "from_env", classmethod(lambda cls: _NoSession()))
    monkeypatch.setattr(acm, "build", lambda arten, von, apollo=None: (
        {"umsatz": ("AswKpf_RG.txt", b"Typ\r\n"), "acht_d": RuntimeError("boom")}, None))
    out = tmp_path / "neu" / "tief"
    runs = acm.run_once(["umsatz", "acht_d"], dt.date(2025, 1, 1), dry_run=True, outdir=str(out))
    assert (out / "_dryrun_AswKpf_RG.txt").read_bytes() == b"Typ\r\n"
    assert [r["status"] for r in runs] == ["ok", "fehler"]
