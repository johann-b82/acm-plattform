"""Datenstand für die vorbelegten Materialpreise ehrlich ausweisen.

Revision ID: 0053_matpreise_datenstand
Revises: 0052_materialpreise_vorbelegen
Create Date: 2026-09-13

Die Sicht `datenstand` liest aus `upload_batches`. Die Erstbefüllung (0052)
legte kein Protokoll an, deshalb meldete die Finanzseite „Datenstand
unvollständig — Materialpreise fehlt", obwohl die Preise da sind.

Diese Migration legt **ein** Protokoll der Art `materialpreise` an — nicht mit
„jetzt", sondern mit dem jüngsten Wareneingangsdatum als Stand, denn genau so
aktuell sind die vorbelegten Preise. Sie verknüpft die vorbelegten Zeilen
damit. Läuft nur, wenn es noch kein Materialpreis-Protokoll gibt; ein späterer
echter Upload legt sein eigenes, neueres Protokoll an und bestimmt dann den
Datenstand.
"""
from alembic import op

revision = "0053_matpreise_datenstand"
down_revision = "0052_materialpreise_vorbelegen"
branch_labels = None
depends_on = None

UPGRADE = """
insert into public.upload_batches (filename, kind, uploaded_at, row_count, error_count, status)
select 'Erstbefuellung aus Wareneingaengen', 'materialpreise',
       max(g.entry_date)::timestamptz, count(*), 0, 'success'
from public.goods_receipt_records g
where g.vorgang_nr is not null and g.article_number is not null
  and not exists (select 1 from public.upload_batches where kind = 'materialpreise')
having max(g.entry_date) is not null;

update public.material_prices mp
set upload_batch_id = b.id
from public.upload_batches b
where b.kind = 'materialpreise'
  and mp.upload_batch_id is null;
"""

DOWNGRADE = ""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    pass
