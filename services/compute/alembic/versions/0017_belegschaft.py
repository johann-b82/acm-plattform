"""Personal: Belegschafts-Kennzahlen und Kompetenzentwicklung.

Revision ID: 0017_belegschaft
Revises: 0016_mitarbeitertabelle
Create Date: 2026-09-10

Die beiden letzten Teile des Personalmoduls. Beide sind Stichtagswerte auf
`personio_employees`, beide geben nur Aggregate her.

Rechenwege nach docs/kpi-rechenwege.md, Abschnitte „Belegschafts-KPIs" und
„Kompetenzentwicklung". Unverändert übernommen, samt der Einschränkung, die
dort steht und hier wiederholt wird, weil sie die Zahlen prägt:

    Die Verteilungen — Geschlecht, Beschäftigungsart, Abteilung — nutzen immer
    die **heutigen** Stammdaten der damals Beschäftigten. Personio liefert
    keine Historie. Nur Kopfzahl und Neu/Bestand sind echt stichtagsbezogen.

Die Kaskade der Beschäftigungsart ist so eigen, dass sie hier steht:

  1. `employment_type = external` → extern
  2. sonst das Feld mit dem **Label** „Art der Beschäftigung" (ein dynamisches
     Feld, der Schlüssel heißt `dynamic_NNNN` und ändert sich) — enthält es
     „geringf", „teilzeit" oder „vollzeit", entscheidet das
  3. sonst irgendein Feld mit „geringfügig" im Wert — das ist der
     Personengruppenschlüssel 109 für Minijobs ohne gepflegte Art
  4. sonst vollzeit — in der Praxis Geschäftsführung ohne Angabe
"""
from alembic import op

revision = "0017_belegschaft"
down_revision = "0016_mitarbeitertabelle"
branch_labels = None
depends_on = None

UPGRADE = """
insert into public.hr_einstellungen (schluessel, beschreibung) values
    ('kompetenz_attribute',
     'Personio-Felder, deren Inhalt als gepflegte Kompetenz zählt. Ohne Angabe bleibt die Kompetenzentwicklung leer.')
on conflict (schluessel) do nothing;

-- Beschaeftigungsart einer Person. Die Kaskade steht im Docstring der
-- Migration; hier ist sie eins zu eins nachgebaut.
create or replace function public.hr_beschaeftigungsart(p_raw jsonb)
returns text
language sql
immutable
as $$
    with attrs as (
        select coalesce(p_raw -> 'attributes', '{}'::jsonb) as a
    ),
    art as (
        select lower(coalesce(f.value ->> 'value', '')) as wert
        from attrs, jsonb_each((select a from attrs)) f(schluessel, value)
        where f.value ->> 'label' = 'Art der Beschäftigung'
        limit 1
    ),
    minijob as (
        select exists (
            select 1
            from attrs, jsonb_each((select a from attrs)) f(schluessel, value)
            where lower(coalesce(f.value ->> 'value', '')) like '%geringfügig%'
        ) as ja
    )
    select case
        when lower(coalesce((select a from attrs) #>> '{employment_type,value}', '')) = 'external'
            then 'extern'
        when (select wert from art) like '%geringf%'  then 'geringfuegig'
        when (select wert from art) like '%teilzeit%' then 'teilzeit'
        when (select wert from art) like '%vollzeit%' then 'vollzeit'
        when (select ja from minijob)                 then 'geringfuegig'
        else 'vollzeit'
    end;
$$;

create or replace function public.hr_geschlecht(p_raw jsonb)
returns text
language sql
immutable
as $$
    select case lower(coalesce(p_raw #>> '{attributes,gender,value}', ''))
        when 'male'    then 'maennlich'
        when 'female'  then 'weiblich'
        when 'diverse' then 'divers'
        else 'unbekannt'
    end;
$$;

grant execute on function public.hr_beschaeftigungsart(jsonb) to authenticated;
grant execute on function public.hr_geschlecht(jsonb) to authenticated;

-- Stichtag und Periodenbeginn. Ohne Jahr: heute, Periode ab Quartalsbeginn.
create or replace function public.hr_belegschaft_zeitraum(
    p_jahr    integer default null,
    p_quartal integer default null
)
returns table (stichtag date, beginn date, aktuell boolean)
language sql
stable
as $$
    select case when p_jahr is null then current_date
                else least(ende, current_date) end,
           beginn,
           p_jahr is null
    from (
        select case
                   when p_jahr is null then date_trunc('quarter', current_date)::date
                   when p_quartal is null then make_date(p_jahr, 1, 1)
                   else make_date(p_jahr, (p_quartal - 1) * 3 + 1, 1)
               end as beginn,
               case
                   when p_jahr is null then current_date
                   when p_quartal is null then make_date(p_jahr, 12, 31)
                   else (make_date(p_jahr, (p_quartal - 1) * 3 + 1, 1)
                         + interval '3 months' - interval '1 day')::date
               end as ende
    ) x;
$$;

grant execute on function public.hr_belegschaft_zeitraum(integer, integer) to authenticated;

-- Kopfzahl, Neuzugaenge und Bestand. Nur Aggregate — deshalb `kpi`, nicht `hr`.
create or replace function public.kpi_hr_belegschaft(
    p_jahr    integer default null,
    p_quartal integer default null
)
returns table (
    stichtag date,
    gesamt   bigint,
    neu      bigint,
    bestand  bigint
)
language sql
stable
security definer
set search_path = public
as $$
    with z as (
        select * from public.hr_belegschaft_zeitraum(p_jahr, p_quartal)
    ),
    menge as (
        select e.hire_date
        from public.personio_employees e, z
        where public.app_level('kpi') is not null
          -- „Aktuell" geht ueber den Status, ein Stichtag ueber Ein- und
          -- Austritt. So macht es das Altprojekt, und die beiden Wege koennen
          -- auseinanderlaufen: ein `inactive` ohne Austrittsdatum zaehlt im
          -- Stichtagsmodus mit.
          and (
              (z.aktuell and e.status = 'active')
              or (not z.aktuell
                  and e.hire_date is not null
                  and e.hire_date <= z.stichtag
                  and (e.termination_date is null or e.termination_date > z.stichtag))
          )
    )
    -- Der Zeitraum treibt die Zeile, nicht die Menge: sonst kaeme bei leerer
    -- Belegschaft gar keine Zeile zurueck statt einer mit Null, und das
    -- Dashboard zeigte nichts statt „0".
    select z.stichtag,
           (select count(*) from menge),
           (select count(*) from menge
             where menge.hire_date between z.beginn and z.stichtag),
           -- Bestand ist der Rest; wer kein Eintrittsdatum hat, zaehlt dazu.
           (select count(*) from menge
             where menge.hire_date is null or menge.hire_date < z.beginn)
    from z;
$$;

-- Die drei Verteilungen in einer Funktion: dieselbe Grundmenge, dreimal
-- gruppiert. Getrennte Funktionen haetten die Grundmenge dreimal gebaut.
create or replace function public.kpi_hr_belegschaft_verteilung(
    p_jahr    integer default null,
    p_quartal integer default null
)
returns table (
    art       text,
    kategorie text,
    anzahl    bigint
)
language sql
stable
security definer
set search_path = public
as $$
    with z as (
        select * from public.hr_belegschaft_zeitraum(p_jahr, p_quartal)
    ),
    menge as (
        select e.raw_json, coalesce(e.department, 'Sonstige') as abteilung
        from public.personio_employees e, z
        where public.app_level('kpi') is not null
          and (
              (z.aktuell and e.status = 'active')
              or (not z.aktuell
                  and e.hire_date is not null
                  and e.hire_date <= z.stichtag
                  and (e.termination_date is null or e.termination_date > z.stichtag))
          )
    )
    select 'geschlecht', public.hr_geschlecht(raw_json), count(*)
    from menge group by 2
    union all
    select 'beschaeftigung', public.hr_beschaeftigungsart(raw_json), count(*)
    from menge group by 2
    union all
    select 'abteilung', abteilung, count(*)
    from menge group by 2
    order by 1, 3 desc, 2;
$$;

create or replace function public.kpi_hr_kompetenz(p_stichtag date default null)
returns table (
    mit_kompetenz bigint,
    aktive        bigint,
    quote         numeric,
    eingerichtet  boolean
)
language sql
stable
security definer
set search_path = public
as $$
    with felder as (
        select array(
            select unnest(werte)
            from public.hr_einstellungen
            where schluessel = 'kompetenz_attribute'
        ) as keys
    ),
    tag as (select coalesce(p_stichtag, current_date) as d),
    aktive as (
        select e.raw_json
        from public.personio_employees e, tag
        where public.app_level('kpi') is not null
          and e.hire_date is not null
          and e.hire_date <= tag.d
          and (e.termination_date is null or e.termination_date > tag.d)
    ),
    gezaehlt as (
        select count(*) as gesamt,
               count(*) filter (
                   where exists (
                       select 1
                       from unnest((select keys from felder)) k
                       where nullif(btrim(coalesce(
                           aktive.raw_json #>> array['attributes', k, 'value'], '')), '') is not null
                   )
               ) as mit
        from aktive
    )
    select gezaehlt.mit,
           gezaehlt.gesamt,
           case when gezaehlt.gesamt > 0 and cardinality((select keys from felder)) > 0
                then gezaehlt.mit::numeric / gezaehlt.gesamt
                else null end,
           cardinality((select keys from felder)) > 0
    from gezaehlt;
$$;

grant execute on function public.kpi_hr_belegschaft(integer, integer) to authenticated;
grant execute on function public.kpi_hr_belegschaft_verteilung(integer, integer) to authenticated;
grant execute on function public.kpi_hr_kompetenz(date) to authenticated;
"""

DOWNGRADE = """
drop function if exists public.kpi_hr_kompetenz(date);
drop function if exists public.kpi_hr_belegschaft_verteilung(integer, integer);
drop function if exists public.kpi_hr_belegschaft(integer, integer);
drop function if exists public.hr_belegschaft_zeitraum(integer, integer);
drop function if exists public.hr_geschlecht(jsonb);
drop function if exists public.hr_beschaeftigungsart(jsonb);
delete from public.hr_einstellungen where schluessel = 'kompetenz_attribute';
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
