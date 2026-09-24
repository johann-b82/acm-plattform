"""Datenstand: den Status des jüngsten Laufs je Art mitführen.

Revision ID: 0062_datenstand_teilweise
Revises: 0061_atr_nummer_sicher
Create Date: 2026-09-20

Die Sicht `datenstand` schloss fehlgeschlagene Läufe aus (`status <> 'failed'`),
zählte einen **teilweise** eingespielten Lauf (`partial`) aber stillschweigend
als vollen Datenstand mit. Ein Auszug, bei dem einzelne Zeilen scheiterten, sah
dann so frisch aus wie ein sauberer.

Die Sicht gibt jetzt zusätzlich den Status des **jüngsten** nicht
fehlgeschlagenen Laufs je Art heraus (`stand`), damit die Anzeige einen
Teilimport eindeutig kenntlich machen kann. `zuletzt` und `laeufe` bleiben
unverändert. Die Sicht bleibt die Rechteprüfung (Eigentümerrechte,
`security_invoker = false`).
"""
from alembic import op

revision = "0062_datenstand_teilweise"
down_revision = "0061_atr_nummer_sicher"
branch_labels = None
depends_on = None

UPGRADE = """
create or replace view public.datenstand as
select distinct on (b.kind)
       b.kind        as art,
       b.uploaded_at as zuletzt,
       count(*) over (partition by b.kind) as laeufe,
       b.status      as stand
from public.upload_batches b
where b.status <> 'failed'
order by b.kind, b.uploaded_at desc;

grant select on public.datenstand to authenticated;
"""

DOWNGRADE = """
-- Eine Spalte lässt sich nicht per `create or replace` aus einer Sicht
-- entfernen — deshalb erst weg, dann neu.
drop view if exists public.datenstand;
create view public.datenstand as
select b.kind                 as art,
       max(b.uploaded_at)     as zuletzt,
       count(*)               as laeufe
from public.upload_batches b
where b.status <> 'failed'
group by b.kind;

grant select on public.datenstand to authenticated;
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
