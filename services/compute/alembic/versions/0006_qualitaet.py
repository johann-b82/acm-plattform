"""Qualität: 8D-Berichte und Audit-Findings.

Revision ID: 0006_qualitaet
Revises: 0005_produktion
Create Date: 2026-09-10

Die Tabelle `quality_records` nimmt den 8D-Export vollständig auf, nicht nur
die Audit-Zeilen. Die Reklamationen liegen in derselben Datei und speisen die
Fehlerquote — sie kommt als eigene Revision, soll aber nicht denselben Upload
noch einmal verlangen.

Rechenweg nach docs/kpi-rechenwege.md, Abschnitt „Audit-Findings Level 1 / 2":

  Daten      `quality_records` mit `art` in den vier Audit-Codes.
  Rechnung   COUNT(*) je Level über `report_date` im Fenster. Reine
             Zeilenzahl, keine Mengen, keine Quote.
  Level      steckt nicht in einer eigenen Spalte der Quelldatei, sondern im
             Freitext „Artikel": „Major … Level 1" bzw. „Minor … Level 2".
             Der Parser leitet es ab, die Datenbank speichert nur 1, 2 oder
             nichts.

Zeilen ohne erkanntes Level zählen in keiner Kachel. Sie bleiben trotzdem in
der Tabelle: im Altprojekt tauchen sie in einer Diagnoseliste auf, und ohne
sie wäre nicht zu sehen, dass ein Bericht falsch beschriftet ist.
"""
from alembic import op

revision = "0006_qualitaet"
down_revision = "0005_produktion"
branch_labels = None
depends_on = None

UPGRADE = """
create table public.quality_records (
    id                  integer generated always as identity primary key,
    report_nr           varchar(50) not null unique,
    report_date         date,
    -- Audit-Code (BH AUD, EX AUD, IN AUD, KU AUD) oder Reklamationsart.
    -- Bewusst ohne Beschränkung: der Export bringt Codes, die wir noch nicht
    -- kennen, und die sollen nicht den ganzen Upload scheitern lassen.
    art                 varchar(20),
    level               smallint check (level is null or level in (1, 2)),
    issuer              varchar(255),
    customer_name       varchar(255),
    customer_id         varchar(50),
    designation         text,
    status_code         varchar(50),
    problem_description text,
    root_cause          text,
    quantity            numeric(15, 3),
    accepted_quantity   numeric(15, 3),
    upload_batch_id     integer references public.upload_batches (id) on delete set null,
    imported_at         timestamptz not null default now(),
    raw                 jsonb
);
create index ix_quality_records_report_date on public.quality_records (report_date);
create index ix_quality_records_art_level_date on public.quality_records (art, level, report_date);

alter table public.quality_records enable row level security;
grant select on public.quality_records to authenticated;

create policy quality_records_read on public.quality_records
    for select to authenticated using (public.app_level('kpi') is not null);

-- ---------------------------------------------------------------------------
-- Kennzahlen
-- ---------------------------------------------------------------------------

-- Die vier Audit-Codes. Als Funktion statt als Aufzählung an jeder Stelle,
-- damit ein fünfter Code an genau einer Stelle dazukommt.
create or replace function public.audit_codes()
returns text[]
language sql
immutable
as $$ select array['BH AUD', 'EX AUD', 'IN AUD', 'KU AUD']; $$;

create or replace function public.kpi_qualitaet_audits(
    von   date default null,
    bis   date default null,
    arten text[] default null
)
returns table (
    level_1     bigint,
    level_2     bigint,
    ohne_level  bigint
)
language sql
stable
as $$
    select count(*) filter (where q.level = 1),
           count(*) filter (where q.level = 2),
           count(*) filter (where q.level is null)
    from public.quality_records q
    where q.art = any (coalesce(arten, public.audit_codes()))
      and q.art = any (public.audit_codes())
      and q.report_date is not null
      and (von is null or q.report_date >= von)
      and (bis is null or q.report_date <= bis);
$$;

-- Der Verlauf schlüsselt zusätzlich nach Art auf; die Summe der
-- Aufschlüsselung ist der Bucket-Gesamtwert.
create or replace function public.kpi_qualitaet_audits_verlauf(
    von   date default null,
    bis   date default null,
    takt  text default 'month',
    arten text[] default null
)
returns table (
    bucket  date,
    art     varchar,
    level_1 bigint,
    level_2 bigint
)
language sql
stable
as $$
    select date_trunc(
               case when takt in ('day', 'week', 'month', 'quarter', 'year') then takt else 'month' end,
               q.report_date
           )::date as bucket,
           q.art,
           count(*) filter (where q.level = 1),
           count(*) filter (where q.level = 2)
    from public.quality_records q
    where q.art = any (coalesce(arten, public.audit_codes()))
      and q.art = any (public.audit_codes())
      and q.report_date is not null
      and (von is null or q.report_date >= von)
      and (bis is null or q.report_date <= bis)
    group by 1, 2
    order by 1, 2;
$$;

-- Diagnoseliste: Audit-Berichte, deren Level im Freitext nicht zu erkennen
-- war. Sie zählen in keiner Kachel; ohne diese Liste bliebe unsichtbar, dass
-- ein Bericht falsch beschriftet ist.
create or replace function public.kpi_qualitaet_audits_ohne_level(
    von    date default null,
    bis    date default null,
    grenze integer default 500,
    arten  text[] default null
)
returns table (
    report_nr     varchar,
    report_date   date,
    art           varchar,
    customer_name varchar,
    designation   text
)
language sql
stable
as $$
    select q.report_nr, q.report_date, q.art, q.customer_name, q.designation
    from public.quality_records q
    where q.art = any (coalesce(arten, public.audit_codes()))
      and q.art = any (public.audit_codes())
      and q.level is null
      and q.report_date is not null
      and (von is null or q.report_date >= von)
      and (bis is null or q.report_date <= bis)
    order by q.report_date desc
    limit least(greatest(coalesce(grenze, 500), 1), 500);
$$;

grant execute on function
    public.audit_codes(),
    public.kpi_qualitaet_audits(date, date, text[]),
    public.kpi_qualitaet_audits_verlauf(date, date, text, text[]),
    public.kpi_qualitaet_audits_ohne_level(date, date, integer, text[])
to authenticated;
"""

DOWNGRADE = """
drop function if exists public.kpi_qualitaet_audits_ohne_level(date, date, integer, text[]);
drop function if exists public.kpi_qualitaet_audits_verlauf(date, date, text, text[]);
drop function if exists public.kpi_qualitaet_audits(date, date, text[]);
drop function if exists public.audit_codes();
drop table if exists public.quality_records;
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
