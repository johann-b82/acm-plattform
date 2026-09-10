"""Qualität: Reklamationsquote (On Quality).

Revision ID: 0008_reklamationsquote
Revises: 0007_zielwerte
Create Date: 2026-09-10

Der Zähler steht schon in `quality_records` — die 8D-Datei enthält Audits und
Reklamationen. Neu ist der Nenner: die ausgelieferte bzw. eingegangene Menge.

Rechenweg nach docs/kpi-rechenwege.md, Abschnitt „On Quality":

  Zähler    SUM(Menge) über `quality_records` mit den Codes der jeweiligen
            Reklamationsart. Die Quelle schreibt beide Schreibweisen
            (`KUNRE` und `KUN RE`); beide bilden einen Topf.
  Mengenart `gesamt` nimmt `quantity`, `akzeptiert` nimmt
            `accepted_quantity`.
  Nenner    Kunde und intern: gelieferte Menge aus `delivery_records`.
            Auch für interne Reklamationen bewusst die Kundenlieferungen —
            eine andere Bezugsgröße gibt es nicht.
            Lieferant: Wareneingänge **ohne** Warengruppe DIENST/SERVIC.
            Werkbänke: Wareneingänge **mit** genau diesen Warengruppen.
  Quote     Zähler / Nenner. Nenner 0 ergibt NULL, nicht 0.

„On Quality" ist `1 − Quote` und wird in der Oberfläche gebildet; die
Datenbank liefert die Fehlerquote. Zähler und Nenner haben verschiedene
Datumsfelder: eine Reklamation kann in einem anderen Zeitraum liegen als die
Lieferung, auf die sie sich bezieht. Das ist im Altprojekt so und bleibt so.
"""
from alembic import op

revision = "0008_reklamationsquote"
down_revision = "0007_zielwerte"
branch_labels = None
depends_on = None

UPGRADE = """
create table public.goods_receipt_records (
    id               integer generated always as identity primary key,
    vorgang_nr       varchar(50) not null,
    pos              integer     not null,
    upos             integer     not null default 0,
    typ              varchar(10),
    entry_date       date,
    -- Eingangsdatum. Dritte Bedeutung der Quellspalte „Lieferdatum".
    receipt_date     date,
    supplier_id      varchar(50),
    supplier_name    varchar(255),
    supplier_city    varchar(255),
    article_number   varchar(50),
    article_version  varchar(50),
    article_name     varchar(255),
    quantity         numeric(15, 3),
    unit             varchar(20),
    price            numeric(15, 4),
    position_value   numeric(15, 2),
    order_nr         varchar(100),
    -- Warengruppe. Trennt Material von Dienstleistung und damit Lieferanten
    -- von Werkbänken.
    material_group   varchar(50),
    purchase_account varchar(50),
    upload_batch_id  integer references public.upload_batches (id) on delete set null,
    imported_at      timestamptz not null default now(),
    raw              jsonb,
    constraint uq_goods_receipt_records unique (vorgang_nr, pos, upos)
);
create index ix_goods_receipt_receipt_date on public.goods_receipt_records (receipt_date);
create index ix_goods_receipt_material_group on public.goods_receipt_records (material_group);

alter table public.goods_receipt_records enable row level security;
grant select on public.goods_receipt_records to authenticated;

create policy goods_receipt_records_read on public.goods_receipt_records
    for select to authenticated using (public.app_level('kpi') is not null);

-- ---------------------------------------------------------------------------
-- Kennzahlen
-- ---------------------------------------------------------------------------

-- Warengruppen, die eine Dienstleistung kennzeichnen. Alles andere ist
-- Material. An einer Stelle, damit eine dritte Gruppe nicht an vier Stellen
-- nachgetragen werden muss.
create or replace function public.dienstleistungs_warengruppen()
returns text[]
language sql
immutable
as $$ select array['DIENST', 'SERVIC']; $$;

-- Die Reklamationscodes je Art. Die Quelle schreibt beide Schreibweisen.
create or replace function public.reklamations_codes(p_art text)
returns text[]
language sql
immutable
as $$
    select case p_art
        when 'kunde'     then array['KUNRE', 'KUN RE']
        when 'intern'    then array['INT RE', 'INRE']
        when 'lieferant' then array['LIE RE', 'LIERE']
        when 'werkbank'  then array['UA RE', 'UARE']
        else array[]::text[]
    end;
$$;

-- Die Parameter tragen ein `p_`, weil `art` und `mengenart` sonst die
-- gleichnamige Spalte in `quality_records` verdecken: eine SQL-Funktion loest
-- einen Namen zuerst als Spalte auf, und die Funktion zaehlte still null.
create or replace function public.kpi_qualitaet_reklamationen(
    p_art       text default 'kunde',
    p_mengenart text default 'gesamt',
    von         date default null,
    bis         date default null
)
returns table (
    quote            numeric,
    reklamiert       numeric,
    bezugsmenge      numeric
)
language sql
stable
as $$
    with zaehler as (
        select coalesce(sum(
            case when p_mengenart = 'akzeptiert' then q.accepted_quantity else q.quantity end
        ), 0) as menge
        from public.quality_records q
        where q.art = any (public.reklamations_codes(p_art))
          and q.report_date is not null
          and (von is null or q.report_date >= von)
          and (bis is null or q.report_date <= bis)
    ),
    nenner as (
        select case
            when p_art in ('kunde', 'intern') then (
                select coalesce(sum(d.quantity), 0)
                from public.delivery_records d
                where d.delivery_date is not null
                  and (von is null or d.delivery_date >= von)
                  and (bis is null or d.delivery_date <= bis)
            )
            when p_art = 'lieferant' then (
                select coalesce(sum(w.quantity), 0)
                from public.goods_receipt_records w
                where w.receipt_date is not null
                  and coalesce(w.material_group, '') <> all (public.dienstleistungs_warengruppen())
                  and (von is null or w.receipt_date >= von)
                  and (bis is null or w.receipt_date <= bis)
            )
            when p_art = 'werkbank' then (
                select coalesce(sum(w.quantity), 0)
                from public.goods_receipt_records w
                where w.receipt_date is not null
                  and w.material_group = any (public.dienstleistungs_warengruppen())
                  and (von is null or w.receipt_date >= von)
                  and (bis is null or w.receipt_date <= bis)
            )
            else 0
        end as menge
    )
    select case when nenner.menge > 0 then zaehler.menge / nenner.menge else null end,
           zaehler.menge,
           nenner.menge
    from zaehler, nenner;
$$;

create or replace function public.kpi_qualitaet_reklamationen_verlauf(
    p_art       text default 'kunde',
    p_mengenart text default 'gesamt',
    von         date default null,
    bis         date default null,
    takt        text default 'month'
)
returns table (
    bucket      date,
    quote       numeric,
    reklamiert  numeric,
    bezugsmenge numeric
)
language sql
stable
as $$
    with takt_sicher as (
        select case when takt in ('day', 'week', 'month', 'quarter', 'year') then takt else 'month' end as t
    ),
    zaehler as (
        select date_trunc((select t from takt_sicher), q.report_date)::date as bucket,
               sum(case when p_mengenart = 'akzeptiert' then q.accepted_quantity else q.quantity end) as menge
        from public.quality_records q
        where q.art = any (public.reklamations_codes(p_art))
          and q.report_date is not null
          and (von is null or q.report_date >= von)
          and (bis is null or q.report_date <= bis)
        group by 1
    ),
    nenner as (
        select date_trunc((select t from takt_sicher), d.delivery_date)::date as bucket,
               sum(d.quantity) as menge
        from public.delivery_records d
        where p_art in ('kunde', 'intern')
          and d.delivery_date is not null
          and (von is null or d.delivery_date >= von)
          and (bis is null or d.delivery_date <= bis)
        group by 1
        union all
        select date_trunc((select t from takt_sicher), w.receipt_date)::date,
               sum(w.quantity)
        from public.goods_receipt_records w
        where w.receipt_date is not null
          and (
              (p_art = 'lieferant'
               and coalesce(w.material_group, '') <> all (public.dienstleistungs_warengruppen()))
              or (p_art = 'werkbank'
                  and w.material_group = any (public.dienstleistungs_warengruppen()))
          )
          and (von is null or w.receipt_date >= von)
          and (bis is null or w.receipt_date <= bis)
        group by 1
    )
    select coalesce(z.bucket, n.bucket),
           case when coalesce(n.menge, 0) > 0 then coalesce(z.menge, 0) / n.menge else null end,
           coalesce(z.menge, 0),
           coalesce(n.menge, 0)
    from zaehler z
    full outer join nenner n on n.bucket = z.bucket
    order by 1;
$$;

grant execute on function
    public.dienstleistungs_warengruppen(),
    public.reklamations_codes(text),
    public.kpi_qualitaet_reklamationen(text, text, date, date),
    public.kpi_qualitaet_reklamationen_verlauf(text, text, date, date, text)
to authenticated;

insert into public.zielwerte (schluessel, bereich, label, beschreibung, wert, einheit, richtung, sortierung)
values
    ('qualitaet_reklamation_kunde', 'qualitaet', 'Fehlerquote Kunde',
     'Höchster Anteil reklamierter an gelieferter Menge.', 0.02, 'anteil', 'max', 40),
    ('qualitaet_reklamation_intern', 'qualitaet', 'Fehlerquote intern',
     'Bezugsgröße ist ebenfalls die Kundenlieferung.', 0.04, 'anteil', 'max', 41),
    ('qualitaet_reklamation_lieferant', 'qualitaet', 'Fehlerquote Lieferanten',
     'Bezugsgröße sind die Wareneingänge ohne Dienstleistungen.', 0.02, 'anteil', 'max', 42),
    ('qualitaet_reklamation_werkbank', 'qualitaet', 'Fehlerquote Werkbänke',
     'Bezugsgröße sind die Wareneingänge der Warengruppen DIENST und SERVIC.',
     0.05, 'anteil', 'max', 43);
"""

DOWNGRADE = """
delete from public.zielwerte where schluessel like 'qualitaet_reklamation_%';
drop function if exists public.kpi_qualitaet_reklamationen_verlauf(text, text, date, date, text);
drop function if exists public.kpi_qualitaet_reklamationen(text, text, date, date);
drop function if exists public.reklamations_codes(text);
drop function if exists public.dienstleistungs_warengruppen();
drop table if exists public.goods_receipt_records;
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
