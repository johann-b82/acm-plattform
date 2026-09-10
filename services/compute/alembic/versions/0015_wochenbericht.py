"""Personal: Wochenbericht — Saldo Mehrarbeit und Krankheit je Woche.

Revision ID: 0015_wochenbericht
Revises: 0014_personalkosten
Create Date: 2026-09-10

Rechenweg nach docs/kpi-rechenwege.md, Abschnitt „Weekly Report".

Der aufwendigste Teil des Personalmoduls, und der einzige mit Namen darin.
Deshalb steht das Recht in der Funktion selbst: ohne `hr:admin` kommen keine
Zeilen zurück. Die Zugriffsregeln an den Tabellen allein reichen nicht — sie
kennen nur „darf HR sehen", nicht „darf Namen neben Stunden sehen".

Vier Regeln, die den Bericht ausmachen:

1. **Erst je Tag summieren.** Personio liefert Vor- und Nachmittag getrennt.

2. **Entschuldigte Stunden über die Solltage verteilen, nicht über
   Kalendertage.** Personio liefert zu einer Abwesenheit eine Stundenzahl,
   die der Summe der Tagessolls über die Abwesenheitstage entspricht. Verteilt
   man sie über die Solltage der **ganzen** Spanne, entschuldigt ein voller
   Urlaub jeden betroffenen Solltag vollständig; Wochenenden und Folgewochen
   verwässern nichts, halbe Tage bleiben halb.

3. **Effektives Wochensoll** = Summe über die Wochentage von
   `max(0, Tagessoll − entschuldigt)`. Wer unentschuldigt fehlt, sammelt
   Fehlstunden — das ist gewollt.

4. **Die laufende Woche wird gekappt.** Ist der Sonntag der Woche noch nicht
   vor dem letzten Anwesenheitsdatum der Datenbank, zählt das Soll je Person
   nur bis zu ihrem letzten gestempelten Tag. Sonst stünde jede noch nicht
   fertig abgeglichene Woche künstlich tief im Minus. Eine abgeschlossene
   Woche wird voll gewertet; dort sind fehlende Tage echte Fehlstunden.

Zur Krankheit: Tage und Stunden werden über **Kalendertage** der Abwesenheit
verteilt, nicht über Solltage. Das ist im Altprojekt so und bleibt so — es
ist inkonsequent gegenüber Punkt 2, aber die Zahl „Krankheitstage der Woche"
meint Kalendertage, und eine Änderung wäre eine fachliche Entscheidung.
"""
from alembic import op

revision = "0015_wochenbericht"
down_revision = "0014_personalkosten"
branch_labels = None
depends_on = None

UPGRADE = """
-- Montag und Sonntag einer ISO-Woche.
create or replace function public.hr_wochengrenzen(p_jahr integer, p_woche integer)
returns table (montag date, sonntag date)
language sql
immutable
as $$
    select m, m + 6
    from (
        -- Der 4. Januar liegt immer in ISO-Woche 1.
        select (
            date_trunc('week', make_date(p_jahr, 1, 4)::timestamp)
            + ((p_woche - 1) || ' weeks')::interval
        )::date as m
    ) x;
$$;

grant execute on function public.hr_wochengrenzen(integer, integer) to authenticated;

create or replace function public.kpi_hr_wochenbericht(
    p_jahr  integer,
    p_woche integer
)
returns table (
    employee_id   integer,
    name          text,
    ist_stunden   numeric,
    soll_stunden  numeric,
    netto         numeric,
    krank_tage    numeric,
    krank_stunden numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
-- Die Ausgabespalten oben sind zugleich plpgsql-Variablen. Ohne diese Zeile
-- ist jedes `employee_id` in den Unterabfragen mehrdeutig und Postgres bricht
-- ab. Dieselbe Familie wie der Parameter, der eine Spalte verdeckt — nur
-- meldet sich dieser Fall wenigstens laut.
#variable_conflict use_column
declare
    v_montag  date;
    v_sonntag date;
    v_laufend boolean;
begin
    -- Namen neben Stunden: das ist der Bericht, den nur die Personalleitung
    -- sehen soll. Ohne das Recht kommt nichts zurueck, kein Fehler.
    if not public.app_mindestens('hr', 'admin') then
        return;
    end if;

    select w.montag, w.sonntag into v_montag, v_sonntag
    from public.hr_wochengrenzen(p_jahr, p_woche) w;

    -- Laufende Woche: der Abgleich hat sie noch nicht fertig.
    select v_sonntag >= coalesce(max(a.datum), v_sonntag)
    into v_laufend
    from public.personio_attendance a;

    return query
    with tage as (
        select generate_series(v_montag, v_sonntag, interval '1 day')::date as tag
    ),
    -- Nur Personen mit mindestens einer Stempelung in der Woche.
    beteiligt as (
        select t.employee_id,
               sum(t.ist_stunden) as ist,
               max(t.datum) as letzter_tag
        from public.hr_ist_stunden_tag t
        where t.datum between v_montag and v_sonntag
          and t.ist_stunden > 0
        group by t.employee_id
    ),
    -- Entschuldigte Stunden je (Person, Tag): die Stunden einer Abwesenheit
    -- proportional auf die Solltage der GANZEN Spanne verteilt.
    abwesenheit as (
        select a.id,
               a.employee_id,
               a.hours,
               d::date as tag,
               public.hr_tagessoll(e.raw_json, e.weekly_working_hours, d::date) as soll
        from public.personio_absences a
        join public.personio_employees e on e.id = a.employee_id
        cross join generate_series(a.start_date, a.end_date, interval '1 day') d
        where a.hours is not null
          and a.start_date <= v_sonntag
          and a.end_date >= v_montag
    ),
    -- Erst das Soll der ganzen Spanne je Abwesenheit, dann verteilen. Beides
    -- in einem Schritt ginge nicht: eine Aggregatfunktion darf keine
    -- Fensterfunktion enthalten.
    spanne_soll as (
        select id, sum(soll) as gesamt
        from abwesenheit
        group by id
    ),
    verteilt as (
        select a.employee_id, a.tag, a.hours * a.soll / s.gesamt as stunden
        from abwesenheit a
        join spanne_soll s on s.id = a.id
        where a.soll > 0
          and s.gesamt > 0
    ),
    entschuldigt as (
        select employee_id, tag, sum(stunden) as stunden
        from verteilt
        where tag between v_montag and v_sonntag
        group by employee_id, tag
    ),
    -- Effektives Wochensoll je Person, gekappt bei der laufenden Woche.
    soll_je_person as (
        select b.employee_id,
               sum(
                   greatest(
                       0,
                       public.hr_tagessoll(e.raw_json, e.weekly_working_hours, t.tag)
                       - coalesce(en.stunden, 0)
                   )
               ) as soll
        from beteiligt b
        join public.personio_employees e on e.id = b.employee_id
        cross join tage t
        left join entschuldigt en
               on en.employee_id = b.employee_id and en.tag = t.tag
        where public.hr_tagessoll(e.raw_json, e.weekly_working_hours, t.tag) > 0
          and (not v_laufend or t.tag <= b.letzter_tag)
        group by b.employee_id
    ),
    -- Krankheit: ueber Kalendertage verteilt, nicht ueber Solltage.
    krank as (
        select a.employee_id,
               sum(
                   coalesce(
                       (a.raw_json #>> '{attributes,days_count}')::numeric,
                       a.hours / 8
                   )
                   * (least(a.end_date, v_sonntag) - greatest(a.start_date, v_montag) + 1)
                   / greatest(a.end_date - a.start_date + 1, 1)
               ) as tage,
               sum(
                   a.hours
                   * (least(a.end_date, v_sonntag) - greatest(a.start_date, v_montag) + 1)
                   / greatest(a.end_date - a.start_date + 1, 1)
               ) as stunden
        from public.personio_absences a
        cross join (
            select array(
                select unnest(werte)::integer
                from public.hr_einstellungen
                where schluessel = 'krank_typ_ids'
            ) as ids
        ) typen
        where cardinality(typen.ids) > 0
          and a.absence_type_id = any (typen.ids)
          and a.hours is not null
          and a.start_date <= v_sonntag
          and a.end_date >= v_montag
        group by a.employee_id
    )
    select b.employee_id,
           nullif(btrim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')), '')
               as name,
           round(b.ist, 2),
           round(coalesce(s.soll, 0), 2),
           round(b.ist - coalesce(s.soll, 0), 2),
           round(coalesce(k.tage, 0), 2),
           round(coalesce(k.stunden, 0), 2)
    from beteiligt b
    join public.personio_employees e on e.id = b.employee_id
    left join soll_je_person s on s.employee_id = b.employee_id
    left join krank k on k.employee_id = b.employee_id
    order by b.ist - coalesce(s.soll, 0) desc;
end;
$$;

grant execute on function public.kpi_hr_wochenbericht(integer, integer) to authenticated;

-- Welche Wochen ueberhaupt Daten haben — fuer die Auswahl in der Oberflaeche.
create or replace function public.kpi_hr_wochen_mit_daten(p_grenze integer default 26)
returns table (iso_jahr integer, iso_woche integer, tage bigint)
language sql
stable
security definer
set search_path = public
as $$
    select extract(isoyear from a.datum)::integer,
           extract(week from a.datum)::integer,
           count(distinct a.datum)
    from public.personio_attendance a
    where public.app_mindestens('hr', 'admin')
    group by 1, 2
    order by 1 desc, 2 desc
    limit least(greatest(coalesce(p_grenze, 26), 1), 200);
$$;

grant execute on function public.kpi_hr_wochen_mit_daten(integer) to authenticated;
"""

DOWNGRADE = """
drop function if exists public.kpi_hr_wochen_mit_daten(integer);
drop function if exists public.kpi_hr_wochenbericht(integer, integer);
drop function if exists public.hr_wochengrenzen(integer, integer);
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
