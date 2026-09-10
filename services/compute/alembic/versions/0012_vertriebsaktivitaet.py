"""Vertrieb: Vertriebsaktivität je Kalenderwoche.

Revision ID: 0012_vertriebsaktivitaet
Revises: 0011_ladenhueter
Create Date: 2026-09-10

Rechenweg nach docs/kpi-rechenwege.md, Abschnitt „Vertriebsaktivität".
Fünf Balkendiagramme über dieselbe Wochenachse:

  Erstkontakte  `sales_contacts`, `status = 1`, `contact_type = 'ERS'`
  Besuche       dieselbe Tabelle, `'ORT'` (vor Ort) und `'ONL'` (online),
                im Diagramm gestapelt
  Angebote      `offers`, SUMME `wert_eur` — Euro, nicht Anzahl
  Aufträge      `auftraege`, SUMME `wert_eur`, **ohne** `> 0`-Filter
                (anders als die Kacheln des Dashboards)
  Interessenten `interessenten`, ANZAHL je Woche — global, ohne Vertriebler

Der Wochen-Eimer ist ISO-Jahr und ISO-Woche. Das ist nicht dasselbe wie
`extract(year …)`: der 31.12.2025 gehört zur ISO-Woche 1 des Jahres 2026.
`extract(isoyear …)` liefert dafür 2026, `extract(year …)` liefert 2025 —
und die Woche säße im falschen Jahr.

Warum drei neue Tabellen statt einer: die drei Exporte kommen aus
verschiedenen Ecken des ERP, haben verschiedene Schlüssel und werden
verschieden oft geliefert. `interessenten` ist eine Stammdaten-Momentaufnahme
und wird auf `adress_nr` aktualisiert — ein erneut gespeicherter Interessent
wandert mit seinem neuen `datum_save` rückwirkend in eine andere Woche. Das
ist im Altprojekt so und bleibt so.

Vertriebler ohne Kennung fallen überall heraus: eine Zeile ohne Erfasser
lässt sich keinem Balken zuordnen.
"""
from alembic import op

revision = "0012_vertriebsaktivitaet"
down_revision = "0011_ladenhueter"
branch_labels = None
depends_on = None

UPGRADE = """
create table public.sales_contacts (
    id              integer generated always as identity primary key,
    contact_date    date not null,
    -- Grossgeschrieben beim Import, damit die Gruppierung stabil ist.
    employee_token  varchar(64) not null,
    -- ERS, ORT, ONL, EMAIL, TEL, … — nur die ersten drei werden gezählt.
    contact_type    varchar(16),
    customer_group  varchar(64),
    -- 1 = erledigt. Alles andere zaehlt nicht mit.
    status          smallint not null default 0,
    customer_name   varchar(255),
    comment         text,
    external_id     varchar(50),
    upload_batch_id integer references public.upload_batches (id) on delete set null,
    imported_at     timestamptz not null,
    raw             jsonb
);

create index sales_contacts_datum_idx on public.sales_contacts (contact_date);
create index sales_contacts_token_idx on public.sales_contacts (employee_token);

create table public.offers (
    vorgang_nr      varchar(50) primary key,
    datum           date not null,
    adr_nr          varchar(50),
    customer_name   varchar(255),
    ort             varchar(128),
    erfasser        varchar(64),
    wert_eur        numeric(15, 2) not null,
    upload_batch_id integer references public.upload_batches (id) on delete set null,
    imported_at     timestamptz not null,
    raw             jsonb
);

create index offers_datum_idx on public.offers (datum);

create table public.interessenten (
    adress_nr       varchar(50) primary key,
    customer_name   varchar(255),
    datum_save      date,
    upload_batch_id integer references public.upload_batches (id) on delete set null,
    imported_at     timestamptz not null,
    raw             jsonb
);

create index interessenten_datum_idx on public.interessenten (datum_save);

alter table public.sales_contacts enable row level security;
alter table public.offers enable row level security;
alter table public.interessenten enable row level security;

grant select on public.sales_contacts to authenticated;
grant select on public.offers to authenticated;
grant select on public.interessenten to authenticated;

create policy sales_contacts_read on public.sales_contacts
    for select to authenticated using (public.app_level('kpi') is not null);
create policy offers_read on public.offers
    for select to authenticated using (public.app_level('kpi') is not null);
create policy interessenten_read on public.interessenten
    for select to authenticated using (public.app_level('kpi') is not null);

-- Eine Zeile je Woche und Vertriebler. Die Oberfläche summiert über die
-- Vertriebler für den Balken und zeigt die Aufteilung im Tooltip — das
-- spart eine zweite Abfrage für dieselben Zahlen.
create or replace function public.kpi_vertrieb_aktivitaet(
    p_von date,
    p_bis date
)
returns table (
    iso_jahr      integer,
    iso_woche     integer,
    erfasser      varchar,
    erstkontakte  bigint,
    besuche_ort   bigint,
    besuche_onl   bigint,
    angebote_eur  numeric,
    auftraege_eur numeric
)
language sql
stable
as $$
    with kontakte as (
        select extract(isoyear from c.contact_date)::integer as jahr,
               extract(week    from c.contact_date)::integer as woche,
               c.employee_token as wer,
               count(*) filter (where c.contact_type = 'ERS') as ers,
               count(*) filter (where c.contact_type = 'ORT') as ort,
               count(*) filter (where c.contact_type = 'ONL') as onl
        from public.sales_contacts c
        where c.status = 1
          and c.contact_date between p_von and p_bis
          and c.employee_token <> ''
        group by 1, 2, 3
    ),
    angebote as (
        select extract(isoyear from o.datum)::integer as jahr,
               extract(week    from o.datum)::integer as woche,
               btrim(o.erfasser) as wer,
               sum(o.wert_eur) as eur
        from public.offers o
        where o.datum between p_von and p_bis
          and btrim(coalesce(o.erfasser, '')) <> ''
        group by 1, 2, 3
    ),
    auftraege as (
        -- Bewusst ohne `wert_eur > 0`: Stornos gehoeren in die Wochensumme,
        -- sonst zeigt der Balken mehr Volumen an, als der Vertrieb geschrieben hat.
        select extract(isoyear from a.datum)::integer as jahr,
               extract(week    from a.datum)::integer as woche,
               btrim(a.erfasser) as wer,
               sum(a.wert_eur) as eur
        from public.auftraege a
        where a.datum between p_von and p_bis
          and btrim(coalesce(a.erfasser, '')) <> ''
        group by 1, 2, 3
    ),
    achsen as (
        select jahr, woche, wer from kontakte
        union
        select jahr, woche, wer from angebote
        union
        select jahr, woche, wer from auftraege
    )
    select x.jahr,
           x.woche,
           x.wer::varchar,
           coalesce(k.ers, 0),
           coalesce(k.ort, 0),
           coalesce(k.onl, 0),
           coalesce(g.eur, 0),
           coalesce(f.eur, 0)
    from achsen x
    left join kontakte  k on (k.jahr, k.woche, k.wer) = (x.jahr, x.woche, x.wer)
    left join angebote  g on (g.jahr, g.woche, g.wer) = (x.jahr, x.woche, x.wer)
    left join auftraege f on (f.jahr, f.woche, f.wer) = (x.jahr, x.woche, x.wer)
    order by x.jahr, x.woche, x.wer;
$$;

-- Eigene Funktion, weil die Quelldatei keine Vertriebler-Spalte hat: ein
-- Interessent gehoert zur Woche, nicht zu einer Person.
create or replace function public.kpi_vertrieb_interessenten(
    p_von date,
    p_bis date
)
returns table (
    iso_jahr  integer,
    iso_woche integer,
    anzahl    bigint
)
language sql
stable
as $$
    select extract(isoyear from i.datum_save)::integer,
           extract(week    from i.datum_save)::integer,
           count(*)
    from public.interessenten i
    where i.datum_save between p_von and p_bis
    group by 1, 2
    order by 1, 2;
$$;

grant execute on function public.kpi_vertrieb_aktivitaet(date, date) to authenticated;
grant execute on function public.kpi_vertrieb_interessenten(date, date) to authenticated;

insert into public.zielwerte (schluessel, bereich, label, beschreibung, wert, einheit, richtung, sortierung)
values
    ('vertrieb_erstkontakte', 'vertrieb', 'Erstkontakte je Woche',
     'Mindestzahl neuer Erstkontakte, die der Vertrieb pro Woche schafft.',
     50, 'anzahl', 'min', 40),
    ('vertrieb_besuche', 'vertrieb', 'Besuche je Woche',
     'Mindestzahl an Besuchen vor Ort und online zusammen.',
     3, 'anzahl', 'min', 41),
    ('vertrieb_interessenten', 'vertrieb', 'Interessenten je Woche',
     'Mindestzahl neu erfasster Interessenten.',
     5, 'anzahl', 'min', 42),
    ('vertrieb_angebote_eur', 'vertrieb', 'Angebotsvolumen je Woche',
     'Mindestsumme der in einer Woche geschriebenen Angebote, in Euro.',
     25000, 'anzahl', 'min', 43),
    ('vertrieb_auftraege_eur', 'vertrieb', 'Auftragsvolumen je Woche',
     'Mindestsumme des in einer Woche erfassten Auftragseingangs, in Euro.',
     50000, 'anzahl', 'min', 44);
"""

DOWNGRADE = """
delete from public.zielwerte where bereich = 'vertrieb';
drop function if exists public.kpi_vertrieb_interessenten(date, date);
drop function if exists public.kpi_vertrieb_aktivitaet(date, date);
drop table if exists public.interessenten;
drop table if exists public.offers;
drop table if exists public.sales_contacts;
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
