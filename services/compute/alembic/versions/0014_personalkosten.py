"""Finanzen: Personalkostenquote.

Revision ID: 0014_personalkosten
Revises: 0013_hr_grundlage
Create Date: 2026-09-10

Rechenweg nach docs/kpi-rechenwege.md, Abschnitt „Personalkostenquote":

    Quote = Personalkosten(Fenster) / Umsatz(Fenster)

  Festangestellte  Monatsbrutto, Monat für Monat anteilig nach aktiven Tagen
                   (aktiv = eingetreten und nicht ausgetreten). Ein voller
                   Monat zählt einmal das Monatsbrutto, ein halber die Hälfte.
  Stundenlöhner    Stundensatz mal tatsächlich geleisteter Stunden aus den
                   Anwesenheiten.
  Wer keins von beidem hat, trägt nichts bei.
  Umsatz           SUMME `revenues.wert_eur` — Rechnungsumsatz, derselbe
                   Nenner wie die Materialkostenquote. **Nicht** `auftraege`.

Bruttowerte ohne Arbeitgeberzuschlag, so wie im Altprojekt.

Die Gehälter stehen in `personio_employees.raw_json` und sind der aktuelle
Stand — es gibt keine Gehaltshistorie. Ein Fenster im März wird also mit den
heutigen Gehältern bewertet. Das ist im Altprojekt so, bleibt so, und steht
hier, damit niemand die Zahl für etwas hält, das sie nicht ist.

**Zur Aufteilung nach Abteilung.** Das Altprojekt gibt jede Abteilung
einzeln heraus. Eine Abteilung mit einer Person ist damit deren Gehalt,
sichtbar für jeden mit dem Recht `kpi`. Hier werden Abteilungen mit weniger
als `MINDESTGROESSE` beitragenden Personen zu „Übrige" zusammengefasst —
die Gesamtsumme bleibt richtig, die einzelne Person verschwindet darin.
"""
from alembic import op

revision = "0014_personalkosten"
down_revision = "0013_hr_grundlage"
branch_labels = None
depends_on = None

UPGRADE = """
-- Personio liefert Gehälter als Text, mal `1.234,56`, mal `1234.56`.
create or replace function public.hr_zahl(p_text text)
returns numeric
language sql
immutable
as $$
    select case
        when p_text is null or btrim(p_text) = '' then null
        -- Beide Trennzeichen: Punkt ist Tausender, Komma ist Dezimal.
        when p_text like '%.%' and p_text like '%,%'
            then nullif(replace(replace(btrim(p_text), '.', ''), ',', '.'), '')::numeric
        when p_text like '%,%'
            then nullif(replace(btrim(p_text), ',', '.'), '')::numeric
        else nullif(btrim(p_text), '')::numeric
    end;
$$;

grant execute on function public.hr_zahl(text) to authenticated;

-- Kosten je Person im Fenster. Eine Zeile je beitragender Person; die
-- Kennzahlfunktionen darüber geben nur Summen heraus.
create or replace function public.hr_personalkosten_je_person(
    p_von date,
    p_bis date
)
returns table (
    employee_id integer,
    department  varchar,
    kosten      numeric
)
language sql
stable
security definer
set search_path = public
as $$
    with gehalt as (
        select e.id,
               e.department,
               e.hire_date,
               e.termination_date,
               public.hr_zahl(e.raw_json #>> '{attributes,fix_salary,value}')    as fix_monat,
               public.hr_zahl(e.raw_json #>> '{attributes,hourly_salary,value}') as pro_stunde
        from public.personio_employees e
    ),
    -- Festgehalt: Monat für Monat anteilig nach aktiven Tagen.
    fest as (
        select g.id,
               sum(
                   g.fix_monat
                   * (
                       least(
                           (date_trunc('month', m)::date + interval '1 month' - interval '1 day')::date,
                           p_bis,
                           coalesce(g.termination_date, p_bis)
                       )
                       - greatest(
                           date_trunc('month', m)::date,
                           p_von,
                           coalesce(g.hire_date, p_von)
                       )
                       + 1
                   )::numeric
                   / extract(day from (date_trunc('month', m) + interval '1 month' - interval '1 day'))
               ) as kosten
        from gehalt g
        cross join generate_series(
            date_trunc('month', p_von::timestamp),
            date_trunc('month', p_bis::timestamp),
            interval '1 month'
        ) m
        where g.fix_monat > 0
          -- Nur Monate, in denen die Person überhaupt aktiv war.
          and least(
                  (date_trunc('month', m)::date + interval '1 month' - interval '1 day')::date,
                  p_bis, coalesce(g.termination_date, p_bis)
              )
              >= greatest(
                  date_trunc('month', m)::date, p_von, coalesce(g.hire_date, p_von)
              )
        group by g.id
    ),
    -- Stundenlohn: Satz mal geleistete Stunden.
    stunde as (
        select g.id,
               g.pro_stunde * coalesce(sum(t.ist_stunden), 0) as kosten
        from gehalt g
        left join public.hr_ist_stunden_tag t
               on t.employee_id = g.id
              and t.datum between p_von and p_bis
        where coalesce(g.fix_monat, 0) <= 0
          and g.pro_stunde > 0
        group by g.id, g.pro_stunde
    )
    select g.id,
           coalesce(g.department, '—')::varchar,
           coalesce(fest.kosten, stunde.kosten)
    from gehalt g
    left join fest   on fest.id = g.id
    left join stunde on stunde.id = g.id
    where coalesce(fest.kosten, stunde.kosten, 0) > 0;
$$;

-- Absichtlich nicht an `authenticated` freigegeben: eine Zeile je Person ist
-- bei kleinen Abteilungen ein Gehalt. Die Funktionen darunter rufen sie als
-- `security definer` auf und geben nur Summen heraus.
revoke execute on function public.hr_personalkosten_je_person(date, date) from public, anon, authenticated;

create or replace function public.kpi_finanzen_personalkosten(
    p_von date,
    p_bis date
)
returns table (
    personalkosten numeric,
    umsatz         numeric,
    quote          numeric,
    personen       bigint
)
language sql
stable
security definer
set search_path = public
as $$
    with kosten as (
        select coalesce(sum(kosten), 0) as summe, count(*) as personen
        from public.hr_personalkosten_je_person(p_von, p_bis)
    ),
    erloes as (
        select coalesce(sum(r.wert_eur), 0) as summe
        from public.revenues r
        where r.datum between p_von and p_bis
    )
    select round(kosten.summe, 2),
           erloes.summe,
           case when erloes.summe > 0 then kosten.summe / erloes.summe else null end,
           kosten.personen
    from kosten, erloes;
$$;

-- Aufteilung nach Abteilung — mit Schwelle.
--
-- Eine Abteilung mit einer Person ist deren Gehalt. Abteilungen unter
-- `p_mindestgroesse` beitragenden Personen wandern deshalb nach „Übrige".
-- Die Gesamtsumme bleibt richtig, die einzelne Person verschwindet darin.
-- Die Schwelle lässt sich nicht unter 3 setzen: sonst wäre der Schutz mit
-- einem Aufrufparameter abzuschalten.
create or replace function public.kpi_finanzen_personalkosten_abteilung(
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

create or replace function public.kpi_finanzen_personalkosten_verlauf(
    p_von  date,
    p_bis  date,
    p_takt text default 'month'
)
returns table (
    bucket         date,
    quote          numeric,
    personalkosten numeric,
    umsatz         numeric
)
language sql
stable
security definer
set search_path = public
as $$
    select b.start::date,
           k.quote,
           k.personalkosten,
           k.umsatz
    from (
        select g as start,
               least(g + (('1 ' || p_takt)::interval) - interval '1 day', p_bis) as ende
        from generate_series(p_von, p_bis, ('1 ' || p_takt)::interval) g
    ) b
    cross join lateral public.kpi_finanzen_personalkosten(b.start::date, b.ende::date) k
    order by b.start;
$$;

grant execute on function public.kpi_finanzen_personalkosten(date, date) to authenticated;
grant execute on function public.kpi_finanzen_personalkosten_abteilung(date, date, integer) to authenticated;
grant execute on function public.kpi_finanzen_personalkosten_verlauf(date, date, text) to authenticated;

insert into public.zielwerte (schluessel, bereich, label, beschreibung, wert, einheit, richtung, sortierung)
values
    ('finanzen_personalkostenquote', 'finanzen', 'Personalkostenquote',
     'Höchster Anteil der Personalkosten am Rechnungsumsatz.',
     0.35, 'anteil', 'max', 61);
"""

DOWNGRADE = """
delete from public.zielwerte where schluessel = 'finanzen_personalkostenquote';
drop function if exists public.kpi_finanzen_personalkosten_verlauf(date, date, text);
drop function if exists public.kpi_finanzen_personalkosten_abteilung(date, date, integer);
drop function if exists public.kpi_finanzen_personalkosten(date, date);
drop function if exists public.hr_personalkosten_je_person(date, date);
drop function if exists public.hr_zahl(text);
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
