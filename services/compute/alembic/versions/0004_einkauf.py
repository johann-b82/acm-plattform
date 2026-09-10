"""Einkauf: Liefertermintreue (OTD) — Tabelle, Zugriffsregeln, Kennzahlen.

Revision ID: 0004_einkauf
Revises: 0003_verwaltung
Create Date: 2026-09-10

Rechenweg nach docs/kpi-rechenwege.md, Abschnitt „Liefertermintreue / OTD":

  Fenster    über das Ist-Lieferdatum `delivered_date`, nicht über den
             Zieltermin.
  Nenner     COUNT der Positionen im Fenster — je Position, nicht nach Menge.
  Zähler     COUNT mit `verzug_tage <= 0`. Frühe Lieferungen sind pünktlich.
  Quote      Zähler / Nenner, als Bruch. Nenner 0 ergibt NULL, nicht 0.
  Ø Verzug   SUM(verzug_tage) / COUNT(verzug_tage) — NULLs zählen hier nicht
             mit, im Nenner der Quote dagegen schon.

Der letzte Punkt ist keine Unachtsamkeit, sondern das Verhalten des
Altprojekts: eine Position ohne Verzugswert kann nie pünktlich sein und
drückt die Quote, verzerrt aber den Mittelwert nicht.

Der Zielwert von 98 % steht im Altprojekt als Konstante im Frontend, nicht in
den Einstellungen. Das bleibt vorerst so; die Einstellungen kommen als
eigenes Modul.
"""
from alembic import op

revision = "0004_einkauf"
down_revision = "0003_verwaltung"
branch_labels = None
depends_on = None

UPGRADE = """
create table public.delivery_reliability (
    id              integer generated always as identity primary key,
    auftrag         varchar(50) not null,
    pos             integer     not null,
    upos            integer     not null default 0,
    adr_nr          varchar(50),
    supplier_name   varchar(255),
    -- Ist-Wareneingang. Treibt Fenster und Verlaufskurve, deshalb indiziert.
    delivered_date  date,
    -- Bestätigter Zieltermin, nur für die Prüftabelle.
    target_date     date,
    -- Vorzeichenbehaftet. <= 0 heißt pünktlich.
    verzug_tage     integer,
    quantity        numeric(15, 3),
    unit            varchar(20),
    article_number  varchar(50),
    article_name    varchar(255),
    upload_batch_id integer references public.upload_batches (id) on delete set null,
    imported_at     timestamptz not null default now(),
    raw             jsonb,
    constraint uq_delivery_reliability_position unique (auftrag, pos, upos)
);
create index ix_delivery_reliability_delivered on public.delivery_reliability (delivered_date);
create index ix_delivery_reliability_supplier on public.delivery_reliability (supplier_name);

alter table public.delivery_reliability enable row level security;
grant select on public.delivery_reliability to authenticated;

create policy delivery_reliability_read on public.delivery_reliability
    for select to authenticated using (public.app_level('kpi') is not null);

-- ---------------------------------------------------------------------------
-- Kennzahlen
-- ---------------------------------------------------------------------------

create or replace function public.kpi_einkauf_otd(
    von date default null,
    bis date default null
)
returns table (
    quote          numeric,
    puenktlich     bigint,
    gesamt         bigint,
    verzug_schnitt numeric
)
language sql
stable
as $$
    select case when count(*) = 0 then null
                else count(*) filter (where d.verzug_tage <= 0)::numeric / count(*)
           end,
           count(*) filter (where d.verzug_tage <= 0),
           count(*),
           avg(d.verzug_tage)
    from public.delivery_reliability d
    where d.delivered_date is not null
      and (von is null or d.delivered_date >= von)
      and (bis is null or d.delivered_date <= bis);
$$;

create or replace function public.kpi_einkauf_otd_verlauf(
    von  date default null,
    bis  date default null,
    takt text default 'month'
)
returns table (
    bucket     date,
    quote      numeric,
    puenktlich bigint,
    gesamt     bigint
)
language sql
stable
as $$
    select date_trunc(
               case when takt in ('day', 'week', 'month', 'quarter', 'year') then takt else 'month' end,
               d.delivered_date
           )::date as bucket,
           case when count(*) = 0 then null
                else count(*) filter (where d.verzug_tage <= 0)::numeric / count(*)
           end,
           count(*) filter (where d.verzug_tage <= 0),
           count(*)
    from public.delivery_reliability d
    where d.delivered_date is not null
      and (von is null or d.delivered_date >= von)
      and (bis is null or d.delivered_date <= bis)
    group by 1
    order by 1;
$$;

-- Prüftabelle. Im Altprojekt fest auf 500 Zeilen begrenzt; die Grenze bleibt,
-- damit ein voller Jahresexport nicht als eine Antwort durch den Browser geht.
create or replace function public.kpi_einkauf_positionen(
    von     date default null,
    bis     date default null,
    grenze  integer default 500
)
returns table (
    auftrag        varchar,
    pos            integer,
    upos           integer,
    supplier_name  varchar,
    article_number varchar,
    article_name   varchar,
    target_date    date,
    delivered_date date,
    verzug_tage    integer
)
language sql
stable
as $$
    select d.auftrag, d.pos, d.upos, d.supplier_name, d.article_number,
           d.article_name, d.target_date, d.delivered_date, d.verzug_tage
    from public.delivery_reliability d
    where d.delivered_date is not null
      and (von is null or d.delivered_date >= von)
      and (bis is null or d.delivered_date <= bis)
    order by d.verzug_tage desc nulls first, d.delivered_date desc
    limit least(greatest(coalesce(grenze, 500), 1), 500);
$$;

grant execute on function
    public.kpi_einkauf_otd(date, date),
    public.kpi_einkauf_otd_verlauf(date, date, text),
    public.kpi_einkauf_positionen(date, date, integer)
to authenticated;
"""

DOWNGRADE = """
drop function if exists public.kpi_einkauf_positionen(date, date, integer);
drop function if exists public.kpi_einkauf_otd_verlauf(date, date, text);
drop function if exists public.kpi_einkauf_otd(date, date);
drop table if exists public.delivery_reliability;
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
