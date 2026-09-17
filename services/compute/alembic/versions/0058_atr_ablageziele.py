"""ATR: die Ablageziele von „Auf Server speichern" in die Einstellungen.

Revision ID: 0058_atr_ablageziele
Revises: 0057_realtime_konfliktschutz
Create Date: 2026-09-17

Bis hierher standen die Ordner fest in `app/atr/ziele.py`, wie im Altprojekt in
`_server_targets`. Sie kommen in die einzeilige Tabelle `atr_scan`, zu Rechner,
Freigabe und Dienstkonto — dieselbe Maske, dieselbe Grenze: ändern darf nur die
Plattform-Verwaltung.

Vier Spalten, nicht drei: das Mappen-Ziel ist je Programm verschieden (A350 und
A380 haben eigene Unter- und Jahresordner), die beiden PDF-Ziele nicht.

**Vorbelegt mit den Pfaden des Altprojekts**, Zeichen für Zeichen — mit dem
Leerzeichen in `ACM_ATR_A 380_.....` und dem Backtick in `ATR`S_…`. Eine frisch
aufgesetzte Plattform legt damit dort ab, wo QS und Logistik heute suchen.

**Die Datenbank prüft, was die Maske nicht verhindern kann:**

- kein `..` als Pfadbestandteil — `compute` weist es beim Zusammensetzen
  ebenfalls ab (Befund 17), hier fällt es schon beim Speichern auf;
- als Platzhalter nur `{jahr}` und `{kw}` — ein Vertipper wie `{jahr` legte
  sonst einen Ordner mit geschweifter Klammer im Namen an;
- nicht leer — ein leeres Ziel schriebe in die Wurzel der Freigabe.
"""
from alembic import op

revision = "0058_atr_ablageziele"
down_revision = "0057_realtime_konfliktschutz"
branch_labels = None
depends_on = None

SPALTEN = ("ziel_mappe_a350", "ziel_mappe_a380", "ziel_logistik", "ziel_weight_report")


def _pruefung(spalte: str) -> str:
    return (
        f"constraint atr_scan_{spalte}_gueltig check ("
        f"btrim({spalte}) <> ''"
        rf" and {spalte} !~ '(^|[\\/])\.\.([\\/]|$)'"
        rf" and regexp_replace({spalte}, '\{{(jahr|kw)\}}', '', 'g') !~ '[{{}}]'"
        ")"
    )


UPGRADE = r"""
alter table public.atr_scan
    add column ziel_mappe_a350 varchar(500) not null default
        '1300 - Qualität\1320_QS\132002_WA-Prüfung\132002_02_TR_Spec_QAA\DIEHL\A350\ATR_Acceptance Test Report\ACM_ATR_A350_.....{jahr}',
    add column ziel_mappe_a380 varchar(500) not null default
        '1300 - Qualität\1320_QS\132002_WA-Prüfung\132002_02_TR_Spec_QAA\DIEHL\A380\ATR_Acceptance Test Report\ACM_ATR_A 380_.....{jahr}',
    add column ziel_logistik varchar(500) not null default
        '1200 - Logistik\Versand\ATR`S_Weight Reports_Firma Diehl_Portal',
    add column ziel_weight_report varchar(500) not null default
        '1300 - Qualität\1320_QS\132002_WA-Prüfung\132002_02_TR_Spec_QAA\DIEHL\Weight Report für Firma Diehl ( verschicken )\{jahr}\KW {kw}';
""" + "".join(
    f"\nalter table public.atr_scan add {_pruefung(s)};" for s in SPALTEN
) + """

-- Die Spaltenrechte aus 0048 gelten Spalte für Spalte; neue kommen nicht von
-- selbst dazu. Die Regel `atr_scan_schreiben` begrenzt weiter auf die
-- Plattform-Verwaltung.
grant update (ziel_mappe_a350, ziel_mappe_a380, ziel_logistik, ziel_weight_report)
    on public.atr_scan to authenticated;
"""

DOWNGRADE = """
alter table public.atr_scan
    drop column ziel_mappe_a350,
    drop column ziel_mappe_a380,
    drop column ziel_logistik,
    drop column ziel_weight_report;
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
