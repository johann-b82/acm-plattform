"""Zentrale Plattform-Einstellungen: Seitengröße aller Tabellen.

Revision ID: 0039_plattform_einstellungen
Revises: 0038_geheimnisse
Create Date: 2026-09-12

Eine Zeile, wie `plattform_logo`. Die Seitengröße gilt für jede Tabelle der
Plattform (TAB-01) und hängt an keiner Person — wer sie ändert, ändert sie für
alle. Deshalb liest sie jeder Angemeldete, und setzen darf sie nur die
Plattform-Verwaltung, dieselbe Stelle, der die Einstellungsseite gehört.
"""
from alembic import op

revision = "0039_plattform_einstellungen"
down_revision = "0038_geheimnisse"
branch_labels = None
depends_on = None

UPGRADE = """
create table public.plattform_einstellungen (
    id                     boolean primary key default true check (id),
    tabellen_seitengroesse integer not null default 25
                           check (tabellen_seitengroesse in (25, 50, 100)),
    geaendert_am           timestamptz not null default now()
);

insert into public.plattform_einstellungen (id) values (true);

alter table public.plattform_einstellungen enable row level security;

grant select, update on public.plattform_einstellungen to authenticated;

create policy plattform_einstellungen_lesen on public.plattform_einstellungen
    for select to authenticated using (true);
create policy plattform_einstellungen_pflegen on public.plattform_einstellungen
    for update to authenticated
    using (public.app_mindestens('platform', 'admin'))
    with check (public.app_mindestens('platform', 'admin'));
"""

DOWNGRADE = """
drop table if exists public.plattform_einstellungen;
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
