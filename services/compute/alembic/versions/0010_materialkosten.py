"""Finanzen: Materialkostenquote.

Revision ID: 0010_materialkosten
Revises: 0009_pruefmengen
Create Date: 2026-09-10

Rechenweg nach docs/kpi-rechenwege.md, Abschnitt „Materialkostenquote":

  Preisliste   je Artikel die **neueste** Wareneingangszeile mit Menge ≠ 0
               und gesetztem Positionswert; Stückpreis = Wert / Menge.
               Fensterunabhängig: auch eine Auswertung über den Januar
               rechnet mit den heutigen Preisen. Das ist im Altprojekt so.
  Verbrauch    je Artikel im Fenster: −SUM(bewegungsmenge) über die
               Buchtypen M (Entnahme, negativ) und SM (Storno, positiv).
               Artikel mit Netto null fallen heraus.
  Kosten       Σ Verbrauch × Stückpreis, nur über Artikel **mit** Preis.
               Ein Artikel ohne Preis wird nicht mit 0 bewertet, sondern
               ausgelassen und gezählt — sonst sähe die Quote besser aus,
               als sie ist.
  Umsatz       SUM(revenues.wert_eur) im Fenster, netto.
  Quote        Kosten / Umsatz. Umsatz ≤ 0 ergibt NULL.

Eine Vereinfachung gegenüber dem Altprojekt: dort wird `AswKpf_WE.txt`
**zweimal** hochgeladen — einmal als Wareneingang, einmal als Preisliste in
eine eigene Tabelle. Beides sind dieselben Zeilen. Hier ist die Preisliste
eine Sicht auf die Wareneingänge, die es schon gibt.

Die Rohspalte `Preis` bleibt ungenutzt, auch das wie im Altprojekt: sie kann
sich je nach Artikel auf 100 oder 1000 Stück beziehen. Wert geteilt durch
Menge ist eindeutig.
"""
from alembic import op

revision = "0010_materialkosten"
down_revision = "0009_pruefmengen"
branch_labels = None
depends_on = None

UPGRADE = """
create table public.material_movements (
    id              integer generated always as identity primary key,
    artikelnr       varchar(50) not null,
    article_name    varchar(255),
    buch_datum      date,
    -- Vorzeichenbehaftet: Entnahmen (M) negativ, Stornos (SM) positiv.
    bewegungsmenge  numeric(15, 3),
    buchtyp         varchar(10),
    kommentar       text,
    upload_batch_id integer references public.upload_batches (id) on delete set null,
    imported_at     timestamptz not null default now(),
    raw             jsonb
);
create index ix_material_movements_datum on public.material_movements (buch_datum);
create index ix_material_movements_artikel on public.material_movements (artikelnr);

alter table public.material_movements enable row level security;
grant select on public.material_movements to authenticated;

create policy material_movements_read on public.material_movements
    for select to authenticated using (public.app_level('kpi') is not null);

-- ---------------------------------------------------------------------------
-- Preisliste
-- ---------------------------------------------------------------------------

-- Je Artikel die neueste brauchbare Wareneingangszeile. `distinct on` nimmt
-- die erste Zeile je Artikel in der angegebenen Sortierung — hier also die
-- mit dem jüngsten Eingangsdatum.
create or replace view public.artikel_preise as
    select distinct on (w.article_number)
           w.article_number as artikelnr,
           w.position_value / w.quantity as stueckpreis,
           w.receipt_date   as stand
    from public.goods_receipt_records w
    where w.article_number is not null
      and w.quantity is not null and w.quantity <> 0
      and w.position_value is not null
    order by w.article_number, w.receipt_date desc nulls last, w.id desc;

alter view public.artikel_preise set (security_invoker = true);
grant select on public.artikel_preise to authenticated;

-- ---------------------------------------------------------------------------
-- Kennzahlen
-- ---------------------------------------------------------------------------

create or replace function public.kpi_finanzen_materialkosten(
    von date default null,
    bis date default null
)
returns table (
    quote          numeric,
    materialkosten numeric,
    umsatz         numeric,
    ohne_preis     bigint
)
language sql
stable
as $$
    with verbrauch as (
        select m.artikelnr, -sum(m.bewegungsmenge) as menge
        from public.material_movements m
        where m.buchtyp in ('M', 'SM')
          and m.buch_datum is not null
          and (von is null or m.buch_datum >= von)
          and (bis is null or m.buch_datum <= bis)
        group by m.artikelnr
        having coalesce(-sum(m.bewegungsmenge), 0) <> 0
    ),
    bewertet as (
        select coalesce(sum(v.menge * p.stueckpreis), 0) as kosten,
               count(*) filter (where p.stueckpreis is null) as ohne_preis
        from verbrauch v
        left join public.artikel_preise p on p.artikelnr = v.artikelnr
    ),
    erloes as (
        select coalesce(sum(r.wert_eur), 0) as umsatz
        from public.revenues r
        where (von is null or r.datum >= von) and (bis is null or r.datum <= bis)
    )
    select case when erloes.umsatz > 0 then bewertet.kosten / erloes.umsatz else null end,
           bewertet.kosten,
           erloes.umsatz,
           bewertet.ohne_preis
    from bewertet, erloes;
$$;

create or replace function public.kpi_finanzen_materialkosten_verlauf(
    von  date default null,
    bis  date default null,
    takt text default 'month'
)
returns table (
    bucket         date,
    quote          numeric,
    materialkosten numeric,
    umsatz         numeric
)
language sql
stable
as $$
    with takt_sicher as (
        select case when takt in ('day', 'week', 'month', 'quarter', 'year') then takt else 'month' end as t
    ),
    kosten as (
        select date_trunc((select t from takt_sicher), m.buch_datum)::date as bucket,
               sum(-m.bewegungsmenge * p.stueckpreis) as betrag
        from public.material_movements m
        join public.artikel_preise p on p.artikelnr = m.artikelnr
        where m.buchtyp in ('M', 'SM')
          and m.buch_datum is not null
          and (von is null or m.buch_datum >= von)
          and (bis is null or m.buch_datum <= bis)
        group by 1
    ),
    erloes as (
        select date_trunc((select t from takt_sicher), r.datum)::date as bucket,
               sum(r.wert_eur) as betrag
        from public.revenues r
        where (von is null or r.datum >= von) and (bis is null or r.datum <= bis)
        group by 1
    )
    select coalesce(k.bucket, e.bucket),
           case when coalesce(e.betrag, 0) > 0 then coalesce(k.betrag, 0) / e.betrag else null end,
           coalesce(k.betrag, 0),
           coalesce(e.betrag, 0)
    from kosten k
    full outer join erloes e on e.bucket = k.bucket
    order by 1;
$$;

-- Prüftabelle. Artikel ohne Preis stehen am Ende, damit sie auffallen.
create or replace function public.kpi_finanzen_materialverbrauch(
    von    date default null,
    bis    date default null,
    grenze integer default 500
)
returns table (
    artikelnr    varchar,
    article_name varchar,
    menge        numeric,
    stueckpreis  numeric,
    kosten       numeric
)
language sql
stable
as $$
    with verbrauch as (
        select m.artikelnr,
               max(m.article_name) as article_name,
               -sum(m.bewegungsmenge) as menge
        from public.material_movements m
        where m.buchtyp in ('M', 'SM')
          and m.buch_datum is not null
          and (von is null or m.buch_datum >= von)
          and (bis is null or m.buch_datum <= bis)
        group by m.artikelnr
        having coalesce(-sum(m.bewegungsmenge), 0) <> 0
    )
    select v.artikelnr, v.article_name, v.menge, p.stueckpreis,
           v.menge * p.stueckpreis
    from verbrauch v
    left join public.artikel_preise p on p.artikelnr = v.artikelnr
    order by (p.stueckpreis is null), (v.menge * p.stueckpreis) desc nulls last
    limit least(greatest(coalesce(grenze, 500), 1), 500);
$$;

grant execute on function
    public.kpi_finanzen_materialkosten(date, date),
    public.kpi_finanzen_materialkosten_verlauf(date, date, text),
    public.kpi_finanzen_materialverbrauch(date, date, integer)
to authenticated;

insert into public.zielwerte (schluessel, bereich, label, beschreibung, wert, einheit, richtung, sortierung)
values
    ('finanzen_materialkostenquote', 'finanzen', 'Materialkostenquote',
     'Höchster Anteil der Materialkosten am Umsatz.', 0.35, 'anteil', 'max', 60);
"""

DOWNGRADE = """
delete from public.zielwerte where schluessel = 'finanzen_materialkostenquote';
drop function if exists public.kpi_finanzen_materialverbrauch(date, date, integer);
drop function if exists public.kpi_finanzen_materialkosten_verlauf(date, date, text);
drop function if exists public.kpi_finanzen_materialkosten(date, date);
drop view if exists public.artikel_preise;
drop table if exists public.material_movements;
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
