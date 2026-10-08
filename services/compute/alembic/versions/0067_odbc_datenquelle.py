"""KPI-Datenquelle umschaltbar: Extrakte oder ODBC (Apollo-Worker).

Revision ID: 0067_odbc_datenquelle
Revises: 0066_signage_kachel
Create Date: 2026-10-07

Die KPIs beruhen heute auf monatlichen Extrakt-Uploads. Apollo lässt sich per
ODBC live lesen; ein Windows-Worker (eigene VM, 32-bit-Treiber) füllt dieselben
Tabellen über `POST /api/odbc/<art>`. Ein Umschalter sagt, welche Quelle gilt.

Zwei Spalten, keine neue Tabelle:

  - `plattform_einstellungen.datenquelle` ('extrakte' | 'odbc', Vorgabe
    'extrakte'). Steht er auf 'odbc', sperrt `compute` die manuellen Uploads
    (409) und nimmt nur den ODBC-Sync an. Die Tabelle ist der Singleton aus
    0039 (read-all, Schreibrecht `platform:admin`) — keine neue Policy nötig.
  - `upload_batches.quelle` ('upload' | 'odbc', Vorgabe 'upload'). Hält im
    Import-Ledger fest, woher ein Lauf kam. Die `datenstand`-Sicht (0037/0062)
    bleibt unverändert nutzbar, weil beide Wege weiter `upload_batches`
    schreiben.

Bestehende Zeilen bekommen die Vorgabe; der Betrieb läuft also unverändert als
'extrakte' weiter, bis jemand umschaltet.
"""
from alembic import op

revision = "0067_odbc_datenquelle"
down_revision = "0066_signage_kachel"
branch_labels = None
depends_on = None

UPGRADE = """
alter table public.plattform_einstellungen
    add column datenquelle varchar(16) not null default 'extrakte'
        check (datenquelle in ('extrakte', 'odbc'));

alter table public.upload_batches
    add column quelle varchar(16) not null default 'upload'
        check (quelle in ('upload', 'odbc'));
"""

DOWNGRADE = """
alter table public.upload_batches drop column quelle;
alter table public.plattform_einstellungen drop column datenquelle;
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
