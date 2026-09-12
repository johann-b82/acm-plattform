"""Vertrieb: Kundenanteil ohne stille Grenze.

Revision ID: 0041_vertrieb_abgleich
Revises: 0040_bereich_hr
Create Date: 2026-09-12

`kpi_vertrieb_kundenanteil` schnitt immer nach `top_n` ab und fasste den Rest
zu „Übrige" zusammen. Die Tabelle „Kundenanteil am Umsatz" zeigte so nur zehn
Kunden — eine Grenze, die TAB-01 verbietet. Die beiden Säulendiagramme
(VER-03B) brauchen dagegen alle Kunden, um „Top 3" und „Top 14" samt Rest aus
derselben Menge zu bilden.

Neu: `top_n => null` liefert jeden Kunden, ohne Sammelzeile. Mit Zahl bleibt
es beim bisherigen Verhalten.

Zweite Änderung: Gleichstände sortieren nach dem Kundennamen. Vorher hing die
Reihenfolge zweier gleich großer Kunden vom Ausführungsplan ab — Säule,
Nummer und Farbe hätten zwischen zwei Abrufen tauschen können.

Rechenweg unverändert, wie im Altsystem (`compute_customer_share`): Summe
`wert_eur` je `customer_name` im Fenster, **kein** `> 0`-Filter; Gutschriften
gehen bei `revenues` negativ ein. Keine Tabelle neu, also keine neue Policy:
die Funktion läuft mit den Rechten des Aufrufers.
"""
from alembic import op

revision = "0041_vertrieb_abgleich"
down_revision = "0040_bereich_hr"
branch_labels = None
depends_on = None

UPGRADE = """
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
        select kunde, wert, row_number() over (order by wert desc, kunde) as platz from je_kunde
    )
    select kunde,
           wert,
           round(wert / (select summe from gesamt), 4)
      from rang
     where top_n is null or platz <= greatest(top_n, 1)
    union all
    select 'Übrige',
           sum(wert),
           round(sum(wert) / (select summe from gesamt), 4)
      from rang
     where top_n is not null and platz > greatest(top_n, 1)
    having sum(wert) is not null
     order by 2 desc, 1;
$$;
"""

DOWNGRADE = """
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
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
