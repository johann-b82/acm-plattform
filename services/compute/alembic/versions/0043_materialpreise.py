"""Finanzen: Materialpreise als eigener Import, alle Abteilungen einzeln.

Revision ID: 0043_materialpreise
Revises: 0040_bereich_hr
Create Date: 2026-09-12

**Materialpreise (UPL-01, FIN-01).** Das Altsystem lädt `AswKpf_WE.txt`
zweimal hoch: als Wareneingang (Nenner der Reklamationsquote) und als
Materialpreise in eine eigene Tabelle. 0010 hatte das zu einer Sicht auf die
Wareneingänge vereinfacht — mit der Annahme, beide Uploads enthielten
dieselben Zeilen. Das stimmt nicht: die beiden Uploads laufen getrennt und
haben verschiedene Stände. In der Produktion fehlte in den Materialpreisen der
Wareneingang vom 03.09.; genau das ergab 114.954 € statt 117.091 €
Materialkosten im Jahr (siehe docs/kpi-rechenwege.md). Die Preisliste liest
deshalb wieder aus ihrer eigenen Tabelle, wie im Altsystem. Einen Rückfall auf
die Wareneingänge gibt es nicht: ein Artikel ohne Materialpreis zählt als
„ohne Preis", und welcher Stand gilt, entscheidet der Upload, nicht die Sicht.

Die Preisregel bleibt die aus 0010 und dem Altsystem
(`material_cost_aggregation._latest_prices`): je Artikel die Zeile mit dem
jüngsten Wareneingangsdatum (bei Gleichstand die höhere id), nur mit Datum,
Menge ≠ 0 und gesetztem Positionswert; Stückpreis = Positionswert / Menge.

**Prüftabelle ohne Grenze (TAB-01).** `kpi_finanzen_materialverbrauch` gab
höchstens 500 Zeilen zurück. Die Oberfläche blättert selbst und lädt
seitenweise; die Reihenfolge endet deshalb auf der Artikelnummer, damit sie
über Seitengrenzen eindeutig ist.

**Alle Abteilungen einzeln (FIN-05).** Nutzerentscheidung: die Sammelzeile
„Übrige" für Abteilungen unter drei Personen entfällt, wie im Altsystem. Die
Zeile je Person bleibt verschlossen (`hr_personalkosten_je_person`), heraus
kommen weiterhin nur Summen je Abteilung.
"""
from alembic import op

revision = "0043_materialpreise"
down_revision = "0040_bereich_hr"
branch_labels = None
depends_on = None

UPGRADE = """
create table public.material_prices (
    id              integer generated always as identity primary key,
    upload_batch_id integer references public.upload_batches (id) on delete set null,
    vorgang_nr      varchar(50)  not null,
    pos             integer      not null,
    upos            integer      not null default 0,
    typ             varchar(10),
    -- Wareneingangsdatum (erste Spalte „Datum"), bestimmt den neuesten Preis.
    datum           date,
    artnr           varchar(50)  not null,
    article_name    varchar(255),
    menge           numeric(15, 3),
    unit            varchar(20),
    -- Rohpreis, je nach Artikel für 1, 100 oder 1000 Stück. Nicht benutzt.
    preis           numeric(15, 4),
    pos_wert        numeric(15, 2),
    imported_at     timestamptz  not null default now(),
    raw             jsonb,
    constraint uq_material_prices_vorgang_pos unique (vorgang_nr, pos, upos)
);
create index ix_material_prices_artnr on public.material_prices (artnr);
create index ix_material_prices_datum on public.material_prices (datum);

alter table public.material_prices enable row level security;
grant select on public.material_prices to authenticated;

create policy material_prices_read on public.material_prices
    for select to authenticated using (public.app_level('kpi') is not null);

-- Die Spaltentypen ändern sich (varchar(50) statt der Länge der Wareneingänge),
-- das lässt `create or replace view` nicht zu.
drop view public.artikel_preise;

create view public.artikel_preise as
    select distinct on (p.artnr)
           p.artnr                as artikelnr,
           p.pos_wert / p.menge   as stueckpreis,
           p.datum                as stand
    from public.material_prices p
    where p.datum is not null
      and p.menge is not null and p.menge <> 0
      and p.pos_wert is not null
    order by p.artnr, p.datum desc, p.id desc;

alter view public.artikel_preise set (security_invoker = true);
grant select on public.artikel_preise to authenticated;

drop function public.kpi_finanzen_materialverbrauch(date, date, integer);

-- Prüftabelle. Artikel ohne Preis stehen am Ende, damit sie auffallen.
create function public.kpi_finanzen_materialverbrauch(
    von date default null,
    bis date default null
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
    order by (p.stueckpreis is null), (v.menge * p.stueckpreis) desc nulls last, v.artikelnr;
$$;

grant execute on function public.kpi_finanzen_materialverbrauch(date, date) to authenticated;

drop function public.kpi_finanzen_personalkosten_abteilung(date, date, integer);

-- Aufteilung nach Abteilung: jede einzeln, auch mit einer Person (FIN-05).
create function public.kpi_finanzen_personalkosten_abteilung(
    p_von date,
    p_bis date
)
returns table (
    abteilung varchar,
    kosten    numeric,
    personen  bigint
)
language sql
stable
security definer
set search_path = public
as $$
    select k.department::varchar,
           round(sum(k.kosten), 2),
           count(*)
    from public.hr_personalkosten_je_person(p_von, p_bis) k
    group by k.department
    order by sum(k.kosten) desc, k.department;
$$;

grant execute on function public.kpi_finanzen_personalkosten_abteilung(date, date) to authenticated;
"""

DOWNGRADE = """
drop function if exists public.kpi_finanzen_personalkosten_abteilung(date, date);

create function public.kpi_finanzen_personalkosten_abteilung(
    p_von            date,
    p_bis            date,
    p_mindestgroesse integer default 3
)
returns table (
    abteilung varchar,
    kosten    numeric,
    personen  bigint,
    gebuendelt boolean
)
language sql
stable
security definer
set search_path = public
as $$
    with je_abteilung as (
        select k.department as abteilung,
               sum(k.kosten) as kosten,
               count(*) as personen
        from public.hr_personalkosten_je_person(p_von, p_bis) k
        group by k.department
    ),
    mit_schwelle as (
        select case
                   when personen >= greatest(coalesce(p_mindestgroesse, 3), 3)
                   then abteilung
                   else 'Übrige'
               end as abteilung,
               kosten,
               personen,
               personen < greatest(coalesce(p_mindestgroesse, 3), 3) as gebuendelt
        from je_abteilung
    )
    select abteilung::varchar,
           round(sum(kosten), 2),
           sum(personen),
           bool_or(gebuendelt)
    from mit_schwelle
    group by abteilung
    order by sum(kosten) desc;
$$;

grant execute on function public.kpi_finanzen_personalkosten_abteilung(date, date, integer) to authenticated;

drop function if exists public.kpi_finanzen_materialverbrauch(date, date);

create function public.kpi_finanzen_materialverbrauch(
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

grant execute on function public.kpi_finanzen_materialverbrauch(date, date, integer) to authenticated;

drop view public.artikel_preise;

create view public.artikel_preise as
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

drop table public.material_prices;
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
