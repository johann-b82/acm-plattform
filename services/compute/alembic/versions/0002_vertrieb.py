"""Vertrieb: Ingestionstabellen, Zugriffsregeln und KPI-Funktionen.

Revision ID: 0002_vertrieb
Revises: 0001_rechtemodell
Create Date: 2026-09-09

Die Kennzahlen sind hier SQL-Funktionen statt Python-Aggregation. Im
Altprojekt lief jede Verlaufskurve als Schleife über Zeitfenster mit je einer
Abfrage; `/api/hr/kpis/history` machte so bis zu 124 Roundtrips für ein
Diagramm. Als `GROUP BY date_trunc()` ist es eine Abfrage.

Rechenwege nach docs/kpi-rechenwege.md:
  Umsatz            SUM(revenues.wert_eur) — Gutschriften stehen negativ drin,
                    die Summe ist damit netto. Kein Typ-Filter.
  Ø Auftragswert    AVG(auftraege.wert_eur) über wert_eur > 0
  Aufträge gesamt   COUNT(*) über wert_eur > 0
Zähler und Nenner kommen aus verschiedenen Tabellen; Umsatz geteilt durch
Aufträge ergibt deshalb absichtlich nicht den Ø Auftragswert.

Aufrufer ist die Rolle `authenticated` über PostgREST. Die Funktionen laufen
mit den Rechten des Aufrufers, die Policies der Tabellen greifen also.
"""
from alembic import op

revision = "0002_vertrieb"
down_revision = "0001_rechtemodell"
branch_labels = None
depends_on = None

UPGRADE = """
create table public.upload_batches (
    id          integer generated always as identity primary key,
    filename    varchar(255) not null,
    uploaded_at timestamptz  not null default now(),
    kind        varchar(32)  not null,
    row_count   integer      not null default 0,
    error_count integer      not null default 0,
    status      varchar(16)  not null check (status in ('success', 'partial', 'failed')),
    uploaded_by uuid references auth.users (id) on delete set null
);
create index ix_upload_batches_uploaded_at on public.upload_batches (uploaded_at desc);

create table public.revenues (
    vorgang_nr      varchar(50) primary key,
    typ             varchar(8)  not null,
    datum           date        not null,
    adr_nr          varchar(50),
    customer_name   varchar(255),
    wert_eur        numeric(15, 2) not null,
    upload_batch_id integer references public.upload_batches (id) on delete set null,
    imported_at     timestamptz not null default now(),
    raw             jsonb
);
create index ix_revenues_datum on public.revenues (datum);
create index ix_revenues_customer on public.revenues (customer_name);

create table public.auftraege (
    vorgang_nr      varchar(50) primary key,
    typ             varchar(8)  not null,
    datum           date        not null,
    adr_nr          varchar(50),
    customer_name   varchar(255),
    erfasser        varchar(64),
    wert_eur        numeric(15, 2) not null,
    upload_batch_id integer references public.upload_batches (id) on delete set null,
    imported_at     timestamptz not null default now(),
    raw             jsonb
);
create index ix_auftraege_datum on public.auftraege (datum);
create index ix_auftraege_erfasser_datum on public.auftraege (erfasser, datum);
create index ix_auftraege_customer on public.auftraege (customer_name);

-- Lesen für alle mit einem Recht auf die App `kpi`; Schreiben nur über
-- compute (verbindet als postgres und umgeht RLS).
alter table public.upload_batches enable row level security;
alter table public.revenues       enable row level security;
alter table public.auftraege      enable row level security;

grant select on public.upload_batches, public.revenues, public.auftraege to authenticated;

create policy upload_batches_read on public.upload_batches
    for select to authenticated using (public.app_level('uploads') is not null);
create policy revenues_read on public.revenues
    for select to authenticated using (public.app_level('kpi') is not null);
create policy auftraege_read on public.auftraege
    for select to authenticated using (public.app_level('kpi') is not null);

-- ---------------------------------------------------------------------------
-- Kennzahlen
-- ---------------------------------------------------------------------------

create or replace function public.kpi_vertrieb_summe(
    von date default null,
    bis date default null
)
returns table (
    umsatz            numeric,
    umsatz_zeilen     bigint,
    auftragswert_avg  numeric,
    auftraege_anzahl  bigint
)
language sql
stable
as $$
    select
        (select coalesce(sum(r.wert_eur), 0) from public.revenues r
          where (von is null or r.datum >= von) and (bis is null or r.datum <= bis)),
        (select count(*) from public.revenues r
          where (von is null or r.datum >= von) and (bis is null or r.datum <= bis)),
        (select coalesce(avg(a.wert_eur), 0) from public.auftraege a
          where a.wert_eur > 0
            and (von is null or a.datum >= von) and (bis is null or a.datum <= bis)),
        (select count(*) from public.auftraege a
          where a.wert_eur > 0
            and (von is null or a.datum >= von) and (bis is null or a.datum <= bis));
$$;

-- Verlauf. `takt` steuert die Bucket-Breite; das Frontend wählt sie nach
-- Fensterlänge (bis 31 Tage täglich, bis 91 wöchentlich, sonst monatlich).
create or replace function public.kpi_vertrieb_verlauf(
    von  date default null,
    bis  date default null,
    takt text default 'month'
)
returns table (
    bucket date,
    umsatz numeric
)
language sql
stable
as $$
    select date_trunc(
               case when takt in ('day', 'week', 'month', 'quarter', 'year') then takt else 'month' end,
               r.datum
           )::date as bucket,
           sum(r.wert_eur)
    from public.revenues r
    where (von is null or r.datum >= von) and (bis is null or r.datum <= bis)
    group by 1
    order by 1;
$$;

-- Kundenanteil: die größten `top_n` Kunden, der Rest als eine Zeile „Übrige".
create or replace function public.kpi_vertrieb_kundenanteil(
    quelle text default 'revenues',
    von    date default null,
    bis    date default null,
    top_n  integer default 14
)
returns table (
    kunde  text,
    wert   numeric,
    anteil numeric
)
language sql
stable
as $$
    with zeilen as (
        select coalesce(r.customer_name, 'ohne Namen') as kunde, r.wert_eur as wert
          from public.revenues r
         where quelle = 'revenues'
           and (von is null or r.datum >= von) and (bis is null or r.datum <= bis)
        union all
        select coalesce(a.customer_name, 'ohne Namen'), a.wert_eur
          from public.auftraege a
         where quelle = 'auftraege'
           and (von is null or a.datum >= von) and (bis is null or a.datum <= bis)
    ),
    je_kunde as (
        select kunde, sum(wert) as wert from zeilen group by kunde
    ),
    gesamt as (select nullif(sum(wert), 0) as summe from je_kunde),
    rang as (
        select kunde, wert, row_number() over (order by wert desc) as platz from je_kunde
    )
    select kunde,
           wert,
           round(wert / (select summe from gesamt), 4)
      from rang
     where platz <= greatest(top_n, 1)
    union all
    select 'Übrige',
           sum(wert),
           round(sum(wert) / (select summe from gesamt), 4)
      from rang
     where platz > greatest(top_n, 1)
    having sum(wert) is not null
     order by 2 desc;
$$;

-- Aufträge je Erfasser und Woche — Kennzahl für die Vertriebsaktivität.
create or replace function public.kpi_vertrieb_je_erfasser(
    von date default null,
    bis date default null
)
returns table (
    erfasser         text,
    auftraege_anzahl bigint,
    wert_summe       numeric
)
language sql
stable
as $$
    select coalesce(a.erfasser, 'ohne Zuordnung'),
           count(*),
           sum(a.wert_eur)
    from public.auftraege a
    where a.wert_eur > 0
      and (von is null or a.datum >= von)
      and (bis is null or a.datum <= bis)
    group by 1
    order by 3 desc nulls last;
$$;

grant execute on function
    public.kpi_vertrieb_summe(date, date),
    public.kpi_vertrieb_verlauf(date, date, text),
    public.kpi_vertrieb_kundenanteil(text, date, date, integer),
    public.kpi_vertrieb_je_erfasser(date, date)
to authenticated;

-- Uploads sind eine eigene App-Kachel; die Anwendungsliste kennt sie schon.
update public.apps set name = 'Uploads', path = '/uploads' where id = 'uploads';
"""

DOWNGRADE = """
drop function if exists public.kpi_vertrieb_je_erfasser(date, date);
drop function if exists public.kpi_vertrieb_kundenanteil(text, date, date, integer);
drop function if exists public.kpi_vertrieb_verlauf(date, date, text);
drop function if exists public.kpi_vertrieb_summe(date, date);
drop table if exists public.auftraege;
drop table if exists public.revenues;
drop table if exists public.upload_batches;
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
