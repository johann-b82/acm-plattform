"""Einkauf: Bestellung auf Lager — Ladenhüter.

Revision ID: 0011_ladenhueter
Revises: 0010_materialkosten
Create Date: 2026-09-10

Rechenweg nach docs/kpi-rechenwege.md, Abschnitt „Bestellung auf Lager":

  Lagerartikel  Artikelnummer beginnt mit `L`.
  Bestand       SUM(bewegungsmenge) über **alle** Bewegungen des Artikels —
                kein Zeitfenster, kein Buchtyp-Filter. Der Bestand ist ein
                Stichtagswert, keine Zeitraumgröße.
  Letzte Bewegung  MAX(buch_datum).
  Ladenhüter    letzte Bewegung länger als `tage_ohne_bewegung` her **und**
                Bestand größer null.
  Wert          Bestand × Stückpreis, absteigend, höchstens 20 Zeilen.

Zwei Dinge, die diese Kennzahl von allen anderen unterscheidet:

* Der Zeitraum des Dashboards wird **ignoriert**. Stichtag ist immer heute.
  Ein Bestand von gestern sagt nichts darüber, was im März im Regal lag.
* Der Preis kommt aus einer eigenen Preisliste (`AswLagBew`-Konditionen),
  nicht aus den Wareneingängen. Ein Lagerartikel muss nie eingekauft worden
  sein — er kann aus der eigenen Fertigung kommen.

Artikel ohne Preiszeile fallen still heraus. Das ist im Altprojekt so und
bleibt so; anders als bei der Materialkostenquote gibt es hier keine Quote,
die dadurch geschönt würde.
"""
from alembic import op

revision = "0011_ladenhueter"
down_revision = "0010_materialkosten"
branch_labels = None
depends_on = None

UPGRADE = """
create table public.stock_article_prices (
    artnr        varchar(50) primary key,
    -- Wert geteilt durch Preismenge: der Rohwert gilt je 100 oder 1000 Stück.
    unit_price   numeric(15, 5) not null,
    price_unit   varchar(20),
    article_name varchar(255),
    updated_at   timestamptz not null default now()
);

alter table public.stock_article_prices enable row level security;
grant select on public.stock_article_prices to authenticated;

create policy stock_article_prices_read on public.stock_article_prices
    for select to authenticated using (public.app_level('kpi') is not null);

create or replace function public.kpi_einkauf_ladenhueter(
    tage_ohne_bewegung integer default 28,
    grenze             integer default 20
)
returns table (
    artnr           varchar,
    article_name    varchar,
    bestand         numeric,
    letzte_bewegung date,
    tage_liegend    integer,
    stueckpreis     numeric,
    wert            numeric
)
language sql
stable
as $$
    with bestand as (
        select m.artikelnr,
               sum(m.bewegungsmenge) as menge,
               max(m.buch_datum) as letzte
        from public.material_movements m
        where m.artikelnr like 'L%'
        group by m.artikelnr
    )
    select b.artikelnr,
           p.article_name,
           b.menge,
           b.letzte,
           (current_date - b.letzte)::integer,
           p.unit_price,
           b.menge * p.unit_price
    from bestand b
    -- Innerer Verbund: ohne Preis kein Wert, und ohne Wert keine Reihung.
    join public.stock_article_prices p on p.artnr = b.artikelnr
    where b.menge > 0
      and b.letzte is not null
      and b.letzte < current_date - coalesce(tage_ohne_bewegung, 28)
    order by b.menge * p.unit_price desc
    limit least(greatest(coalesce(grenze, 20), 1), 100);
$$;

grant execute on function public.kpi_einkauf_ladenhueter(integer, integer) to authenticated;
"""

DOWNGRADE = """
drop function if exists public.kpi_einkauf_ladenhueter(integer, integer);
drop table if exists public.stock_article_prices;
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
