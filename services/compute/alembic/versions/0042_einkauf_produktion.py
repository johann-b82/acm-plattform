"""Einkauf und Produktion: vollständige Tabellen, Liefermenge, offene Aufträge.

Revision ID: 0042_einkauf_produktion
Revises: 0040_bereich_hr
Create Date: 2026-09-12

Aus dem Systemvergleich (EIN-03, PRO-02, TAB-01). Keine neue Tabelle.

* `kpi_einkauf_positionen` liefert Menge, Einheit und Adress-Nr. und hat
  keine Grenze mehr. Die 500 stammten aus dem Altprojekt; die Tabelle blättert
  jetzt selbst und lädt große Mengen seitenweise.
* `kpi_einkauf_ladenhueter` gibt ohne `grenze` alle Ladenhüter zurück. Mit
  Angabe bleibt die Deckelung — eine Rangliste darf ein Aufrufer kürzen.
* Die Sicht `auftrag_verzug` trägt die Adress-Nr. des Kunden (angehängt, damit
  `create or replace` genügt).
* `kpi_produktion_verzug` zählt die überfälligen offenen Aufträge selbst
  (`offen`). Vorher zählte die Oberfläche „davon N offen" aus der auf 500
  gekappten Liste — bei „Alles" also zu wenig.
* `kpi_produktion_verzug_liste` liefert die Adress-Nr. und hat keine Grenze.

Jede Liste sortiert zuletzt nach ihrem Schlüssel: seitenweises Laden über
`range` darf keine Zeile doppelt und keine gar nicht bringen.

Rechte: die Funktionen laufen wie bisher mit den Rechten des Aufrufers, die
Sicht mit `security_invoker`. Es gelten die Policies aus 0004, 0005 und 0011.
"""
from alembic import op

revision = "0042_einkauf_produktion"
down_revision = "0040_bereich_hr"
branch_labels = None
depends_on = None

UPGRADE = """
-- ---------------------------------------------------------------------------
-- Einkauf
-- ---------------------------------------------------------------------------

drop function public.kpi_einkauf_positionen(date, date, integer);

create function public.kpi_einkauf_positionen(
    von date default null,
    bis date default null
)
returns table (
    auftrag        varchar,
    pos            integer,
    upos           integer,
    adr_nr         varchar,
    supplier_name  varchar,
    article_number varchar,
    article_name   varchar,
    target_date    date,
    delivered_date date,
    verzug_tage    integer,
    -- Liefermenge der Position (Spalte „Menge"), nicht der Lagerbestand.
    quantity       numeric,
    unit           varchar
)
language sql
stable
as $$
    select d.auftrag, d.pos, d.upos, d.adr_nr, d.supplier_name, d.article_number,
           d.article_name, d.target_date, d.delivered_date, d.verzug_tage,
           d.quantity, d.unit
    from public.delivery_reliability d
    where d.delivered_date is not null
      and (von is null or d.delivered_date >= von)
      and (bis is null or d.delivered_date <= bis)
    order by d.verzug_tage desc nulls first, d.delivered_date desc, d.auftrag, d.pos, d.upos;
$$;

drop function public.kpi_einkauf_ladenhueter(integer, integer);

create function public.kpi_einkauf_ladenhueter(
    tage_ohne_bewegung integer default 28,
    grenze             integer default null
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
    order by b.menge * p.unit_price desc, b.artikelnr
    -- Ohne (positive) Grenze: alle. LIMIT NULL heißt in Postgres „keine Grenze".
    limit case when grenze > 0 then grenze end;
$$;

grant execute on function
    public.kpi_einkauf_positionen(date, date),
    public.kpi_einkauf_ladenhueter(integer, integer)
to authenticated;

-- ---------------------------------------------------------------------------
-- Produktion
-- ---------------------------------------------------------------------------

create or replace view public.auftrag_verzug as
    select z.vorgang_nr,
           z.ziel,
           z.customer_name,
           l.ist,
           (coalesce(l.ist, current_date) - z.ziel) as verzug_tage,
           (l.ist is not null) as geliefert,
           z.adr_nr
    from (
        select p.vorgang_nr,
               max(p.lieferdatum) as ziel,
               max(p.customer_name) as customer_name,
               max(p.customer_id) as adr_nr
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

drop function public.kpi_produktion_verzug(date, date);

create function public.kpi_produktion_verzug(
    von date default null,
    bis date default null
)
returns table (
    quote          numeric,
    in_verzug      bigint,
    gesamt         bigint,
    verzug_schnitt numeric,
    -- Davon ohne Lieferschein und mit verstrichenem Termin.
    offen          bigint
)
language sql
stable
as $$
    select case when count(*) = 0 then null
                else count(*) filter (where v.verzug_tage > 0)::numeric / count(*)
           end,
           count(*) filter (where v.verzug_tage > 0),
           count(*),
           case when count(*) = 0 then null else avg(v.verzug_tage) end,
           count(*) filter (where not v.geliefert and v.verzug_tage > 0)
    from public.auftrag_verzug v
    where (von is null or v.ziel >= von) and (bis is null or v.ziel <= bis);
$$;

drop function public.kpi_produktion_verzug_liste(date, date, integer);

-- Zwei Mengen, die zusammen die Aufträge in Verzug ergeben. Die Oberfläche
-- zeigt sie getrennt, wie die beiden Tabellen der Referenz:
--   art = 'verspaetet' — geliefert, aber zu spät. Verzug = Ist − Ziel.
--   art = 'offen'      — kein Lieferschein, Termin verstrichen. Heute − Ziel.
create function public.kpi_produktion_verzug_liste(
    von date default null,
    bis date default null
)
returns table (
    vorgang_nr    varchar,
    customer_name varchar,
    adr_nr        varchar,
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
           v.adr_nr,
           v.ziel,
           v.ist,
           v.verzug_tage,
           case when v.geliefert then 'verspaetet' else 'offen' end
    from public.auftrag_verzug v
    where v.verzug_tage > 0
      and (von is null or v.ziel >= von)
      and (bis is null or v.ziel <= bis)
    order by v.verzug_tage desc, v.vorgang_nr;
$$;

grant execute on function
    public.kpi_produktion_verzug(date, date),
    public.kpi_produktion_verzug_liste(date, date)
to authenticated;
"""

# Stellt die Fassungen aus 0004, 0005 und 0011 wieder her.
DOWNGRADE = """
drop function if exists public.kpi_produktion_verzug_liste(date, date);
drop function if exists public.kpi_produktion_verzug(date, date);

drop view public.auftrag_verzug;
create view public.auftrag_verzug as
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
    where l.ist is not null or z.ziel < current_date;
alter view public.auftrag_verzug set (security_invoker = true);
grant select on public.auftrag_verzug to authenticated;

create function public.kpi_produktion_verzug(
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

create function public.kpi_produktion_verzug_liste(
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
    public.kpi_produktion_verzug_liste(date, date, integer)
to authenticated;

drop function if exists public.kpi_einkauf_ladenhueter(integer, integer);
create function public.kpi_einkauf_ladenhueter(
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
    join public.stock_article_prices p on p.artnr = b.artikelnr
    where b.menge > 0
      and b.letzte is not null
      and b.letzte < current_date - coalesce(tage_ohne_bewegung, 28)
    order by b.menge * p.unit_price desc
    limit least(greatest(coalesce(grenze, 20), 1), 100);
$$;

drop function if exists public.kpi_einkauf_positionen(date, date);
create function public.kpi_einkauf_positionen(
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
    public.kpi_einkauf_ladenhueter(integer, integer),
    public.kpi_einkauf_positionen(date, date, integer)
to authenticated;
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
