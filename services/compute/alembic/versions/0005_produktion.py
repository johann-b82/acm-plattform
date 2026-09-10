"""Produktion: Aufträge in Verzug — Tabellen, Zugriffsregeln, Kennzahlen.

Revision ID: 0005_produktion
Revises: 0004_einkauf
Create Date: 2026-09-10

Zwei Positionstabellen aus dem ERP, beide auf Positionsebene und beide mit
dem Schlüssel (vorgang_nr, pos, upos):

  auftrag_positionen  aus AswKpf_AUF (Positionsebene) — trägt den Zieltermin
  delivery_records    aus AswKpf_LS  (Lieferscheine)  — trägt das Ist-Datum

`delivery_records` speist später auch die Reklamationsquote in der Qualität;
die Tabelle wird deshalb schon jetzt vollständig übernommen und nicht auf die
zwei Spalten reduziert, die der Verzug braucht.

Rechenweg nach docs/kpi-rechenwege.md, Abschnitt „Verzugsquote":

  Zieltermin je Auftrag   MAX(lieferdatum) über die Positionen. Positionen
                          ohne Lieferdatum entfallen.
  Ist je Auftrag          MAX(delivery_date) über alle Lieferscheinzeilen mit
                          passendem order_nr.
  Verzug                  COALESCE(Ist, heute) − Ziel, in Tagen.
  Gezählt                 nur, wenn der Ausgang feststeht: Ist vorhanden ODER
                          Ziel liegt in der Vergangenheit. Noch nicht fällige
                          offene Aufträge sind weder im Zähler noch im Nenner.
  Fenster                 über den Zieltermin, nicht über das Ist-Datum.
  Quote                   Aufträge mit Verzug > 0 durch gezählte Aufträge.
  Ø Verzug                Mittel über alle gezählten. Pünktliche gehen negativ
                          ein, der Wert kann negativ sein.

Zwei bewusste Abweichungen vom Altprojekt:

* Ohne Zeitfenster rechnet die Funktion über alles. Das Altprojekt fiel beim
  Preset „Alles" still auf den laufenden Monat zurück — eine Überraschung, die
  niemand erwartet, wenn er „Alles" wählt.
* Der Seriengeschäft-Filter über `pos_typ_2` ist im Altprojekt vorbereitet,
  aber mit leerer Konstante wirkungslos. Er fehlt hier, statt als toter Code
  mitzukommen. Die Spalte wird übernommen, damit er später ohne Migration geht.
"""
from alembic import op

revision = "0005_produktion"
down_revision = "0004_einkauf"
branch_labels = None
depends_on = None

UPGRADE = """
create table public.auftrag_positionen (
    id              integer generated always as identity primary key,
    vorgang_nr      varchar(50) not null,
    pos             integer     not null,
    upos            integer     not null default 0,
    typ             varchar(10),
    entry_date      date,
    -- Zieltermin der Position. MAX je Auftrag ist der Zieltermin des Auftrags.
    lieferdatum     date,
    customer_id     varchar(50),
    customer_name   varchar(255),
    customer_city   varchar(255),
    article_number  varchar(50),
    article_version varchar(50),
    article_name    varchar(255),
    quantity        numeric(15, 3),
    unit            varchar(20),
    price           numeric(15, 4),
    position_value  numeric(15, 2),
    -- Nur Merkmal, noch ohne Wirkung: der Seriengeschäft-Filter kommt später.
    pos_typ_2       varchar(20),
    upload_batch_id integer references public.upload_batches (id) on delete set null,
    imported_at     timestamptz not null default now(),
    raw             jsonb,
    constraint uq_auftrag_positionen unique (vorgang_nr, pos, upos)
);
create index ix_auftrag_positionen_vorgang on public.auftrag_positionen (vorgang_nr);
create index ix_auftrag_positionen_lieferdatum on public.auftrag_positionen (lieferdatum);

create table public.delivery_records (
    id                integer generated always as identity primary key,
    vorgang_nr        varchar(50) not null,
    pos               integer     not null,
    upos              integer     not null default 0,
    typ               varchar(10),
    entry_date        date,
    delivery_date     date,
    customer_id       varchar(50),
    customer_name     varchar(255),
    customer_city     varchar(255),
    article_number    varchar(50),
    article_version   varchar(50),
    article_name      varchar(255),
    quantity          numeric(15, 3),
    unit              varchar(20),
    price             numeric(15, 4),
    position_value    numeric(15, 2),
    external_order_nr varchar(100),
    -- Verweis auf den Auftrag. Join-Schlüssel zum Zieltermin.
    order_nr          varchar(100),
    upload_batch_id   integer references public.upload_batches (id) on delete set null,
    imported_at       timestamptz not null default now(),
    raw               jsonb,
    constraint uq_delivery_records unique (vorgang_nr, pos, upos)
);
create index ix_delivery_records_delivery_date on public.delivery_records (delivery_date);
create index ix_delivery_records_order_nr on public.delivery_records (order_nr);

alter table public.auftrag_positionen enable row level security;
alter table public.delivery_records   enable row level security;
grant select on public.auftrag_positionen, public.delivery_records to authenticated;

create policy auftrag_positionen_read on public.auftrag_positionen
    for select to authenticated using (public.app_level('kpi') is not null);
create policy delivery_records_read on public.delivery_records
    for select to authenticated using (public.app_level('kpi') is not null);

-- ---------------------------------------------------------------------------
-- Kennzahlen
-- ---------------------------------------------------------------------------

-- Ein Auftrag je Zeile: Zieltermin, Ist-Fertigstellung, Verzug in Tagen.
-- Die drei Funktionen darunter setzen alle hierauf auf, damit der Rechenweg
-- genau einmal beschrieben ist.
create or replace view public.auftrag_verzug as
    select z.vorgang_nr,
           z.ziel,
           z.customer_name,
           l.ist,
           (coalesce(l.ist, current_date) - z.ziel) as verzug_tage,
           (l.ist is not null) as geliefert
    from (
        select p.vorgang_nr,
               max(p.lieferdatum) as ziel,
               max(p.customer_name) as customer_name
        from public.auftrag_positionen p
        where p.lieferdatum is not null
        group by p.vorgang_nr
    ) z
    left join (
        select d.order_nr, max(d.delivery_date) as ist
        from public.delivery_records d
        where d.order_nr is not null and d.delivery_date is not null
        group by d.order_nr
    ) l on l.order_nr = z.vorgang_nr
    -- Der Ausgang muss feststehen: entweder geliefert, oder der Termin ist
    -- verstrichen. Ein offener Auftrag, dessen Termin noch kommt, ist weder
    -- pünktlich noch verspätet und zählt in keiner Richtung.
    where l.ist is not null or z.ziel < current_date;

alter view public.auftrag_verzug set (security_invoker = true);
grant select on public.auftrag_verzug to authenticated;

create or replace function public.kpi_produktion_verzug(
    von date default null,
    bis date default null
)
returns table (
    quote          numeric,
    in_verzug      bigint,
    gesamt         bigint,
    verzug_schnitt numeric
)
language sql
stable
as $$
    select case when count(*) = 0 then null
                else count(*) filter (where v.verzug_tage > 0)::numeric / count(*)
           end,
           count(*) filter (where v.verzug_tage > 0),
           count(*),
           case when count(*) = 0 then null else avg(v.verzug_tage) end
    from public.auftrag_verzug v
    where (von is null or v.ziel >= von) and (bis is null or v.ziel <= bis);
$$;

create or replace function public.kpi_produktion_verzug_verlauf(
    von  date default null,
    bis  date default null,
    takt text default 'month'
)
returns table (
    bucket    date,
    quote     numeric,
    in_verzug bigint,
    gesamt    bigint
)
language sql
stable
as $$
    select date_trunc(
               case when takt in ('day', 'week', 'month', 'quarter', 'year') then takt else 'month' end,
               v.ziel
           )::date as bucket,
           case when count(*) = 0 then null
                else count(*) filter (where v.verzug_tage > 0)::numeric / count(*)
           end,
           count(*) filter (where v.verzug_tage > 0),
           count(*)
    from public.auftrag_verzug v
    where (von is null or v.ziel >= von) and (bis is null or v.ziel <= bis)
    group by 1
    order by 1;
$$;

-- Zwei Listen, die zusammen die Aufträge in Verzug ergeben:
--   art = 'verspaetet' — geliefert, aber zu spät. Zeitstabil.
--   art = 'offen'      — kein Lieferschein, Termin verstrichen. Wächst täglich.
create or replace function public.kpi_produktion_verzug_liste(
    von    date default null,
    bis    date default null,
    grenze integer default 500
)
returns table (
    vorgang_nr    varchar,
    customer_name varchar,
    ziel          date,
    ist           date,
    verzug_tage   integer,
    art           text
)
language sql
stable
as $$
    select v.vorgang_nr,
           v.customer_name,
           v.ziel,
           v.ist,
           v.verzug_tage,
           case when v.geliefert then 'verspaetet' else 'offen' end
    from public.auftrag_verzug v
    where v.verzug_tage > 0
      and (von is null or v.ziel >= von)
      and (bis is null or v.ziel <= bis)
    order by v.verzug_tage desc
    limit least(greatest(coalesce(grenze, 500), 1), 500);
$$;

grant execute on function
    public.kpi_produktion_verzug(date, date),
    public.kpi_produktion_verzug_verlauf(date, date, text),
    public.kpi_produktion_verzug_liste(date, date, integer)
to authenticated;
"""

DOWNGRADE = """
drop function if exists public.kpi_produktion_verzug_liste(date, date, integer);
drop function if exists public.kpi_produktion_verzug_verlauf(date, date, text);
drop function if exists public.kpi_produktion_verzug(date, date);
drop view if exists public.auftrag_verzug;
drop table if exists public.delivery_records;
drop table if exists public.auftrag_positionen;
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
