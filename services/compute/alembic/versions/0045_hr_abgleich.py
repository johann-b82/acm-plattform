"""HR im Systemvergleich: Umsatz je Produktionskopf, Mitarbeitertabelle, Foto im Organigramm.

Revision ID: 0045_hr_abgleich
Revises: 0040_bereich_hr
Create Date: 2026-09-12

**Umsatz je Produktionskopf (HR-04, SET-01).** Nachgebaut nach
`services/hr_kpi_aggregation.py::_revenue_per_production_employee` im
Altsystem. Der Docstring dort spricht von „revenue", gerechnet wird aber über
`aggregate_kpi_summary` — und das summiert seit v1.54 die **Aufträge** über
null (`auftraege.wert_eur > 0`, Fenster auf `datum`), nicht die Rechnungen.
Die Hilfe des Altsystems sagt es ausdrücklich: „Auftragswert, nicht
Rechnungsumsatz". An der lokalen Kopie nachgerechnet: 4.906.285,15 €
Aufträge 2026 durch 48 Produktionsköpfe ergibt genau die 102.214 €, die das
Altsystem anzeigt; mit den Rechnungen (4.760.703,11 €) wären es 99.181 €.
Übernommen wird deshalb der Auftragswert — die Kachel behält den Namen, die
Zeile darunter sagt, was gezählt wird.

Nenner sind die Beschäftigten der Abteilungen aus `produktion_abteilungen`, die
am letzten Tag des Zeitraums eingetreten und nicht ausgetreten sind
(`_headcount_at_eom`). Ohne Aufträge oder ohne Köpfe gibt es keinen Wert, wie
im Altsystem.

Der Zielwert 300 € ist der des Altsystems (`target_revenue_per_employee`).
Er steht als Euro in `zielwerte`; dafür bekommt die Spalte `einheit` den Wert
`euro` — sonst stünde in den Einstellungen „Stück" neben einem Betrag.

**Mitarbeitertabelle (HR-07, HR-08).** Die Liste sind jetzt alle Personen,
wie im Altsystem; nur die Stunden hängen am Zeitraum. Erst damit haben die
Auswahlen „Aktive" und „Alle" etwas zu zeigen. Dazu Position, Status und die
Wochenstunden. Die Wochenstunden kommen aus dem Arbeitszeitmodell — als Summe
von `hr_tagessoll` über eine Woche —, nicht aus `weekly_working_hours`: die
Spalte ist in Personio nicht verlässlich eine Wochenzahl (in der Kopie steht
bei einer Person 8 neben einem Modell von 40 Stunden, bei einer anderen 2
neben 56). Ohne Modell greift wie überall der Rückfall von `hr_tagessoll`.

**Organigramm (ORG-01).** Die Sicht sagt, ob Personio ein Profilbild führt.
Dieselbe Suche wie bei den Anzeigen (`routers/embed.py::hat_foto`): das Feld
mit der Beschriftung „Profile Picture", irgendwo in den Rohdaten.
"""
from alembic import op

revision = "0045_hr_abgleich"
down_revision = "0043_materialpreise"
branch_labels = None
depends_on = None

UPGRADE = """
create or replace function public.kpi_hr_umsatz_je_produktionskopf(
    p_von date,
    p_bis date
)
returns table (
    auftragswert numeric,
    koepfe       bigint,
    wert         numeric,
    eingerichtet boolean
)
language sql
stable
security definer
set search_path = public
as $$
    with abteilungen as (
        select coalesce(
            (select werte from public.hr_einstellungen where schluessel = 'produktion_abteilungen'),
            '{}'
        ) as namen
    ),
    summe as (
        select coalesce(sum(a.wert_eur), 0) as betrag
        from public.auftraege a
        where a.wert_eur > 0
          and a.datum between p_von and p_bis
    ),
    bestand as (
        -- Stand am letzten Tag des Zeitraums, wie `_headcount_at_eom`.
        select count(*) as anzahl
        from public.personio_employees e
        cross join abteilungen
        where e.department = any (abteilungen.namen)
          and e.hire_date <= p_bis
          and (e.termination_date is null or e.termination_date > p_bis)
    )
    select summe.betrag,
           bestand.anzahl,
           case when cardinality(abteilungen.namen) > 0
                     and bestand.anzahl > 0
                     and summe.betrag > 0
                then summe.betrag / bestand.anzahl
           end,
           cardinality(abteilungen.namen) > 0
    from summe, bestand, abteilungen;
$$;

create or replace function public.kpi_hr_umsatz_je_produktionskopf_verlauf(
    p_von  date,
    p_bis  date,
    p_takt text default 'month'
)
returns table (
    bucket date,
    wert   numeric
)
language sql
stable
security definer
set search_path = public
as $$
    -- Je Abschnitt eigener Nenner: der Stand am Ende dieses Abschnitts.
    select b.start::date,
           (select k.wert from public.kpi_hr_umsatz_je_produktionskopf(b.start::date, b.ende::date) k)
    from (
        select g as start,
               least(g + (('1 ' || p_takt)::interval) - interval '1 day', p_bis) as ende
        from generate_series(p_von, p_bis, ('1 ' || p_takt)::interval) g
    ) b
    order by b.start;
$$;

grant execute on function public.kpi_hr_umsatz_je_produktionskopf(date, date) to authenticated;
grant execute on function public.kpi_hr_umsatz_je_produktionskopf_verlauf(date, date, text) to authenticated;

alter table public.zielwerte drop constraint zielwerte_einheit_check;
alter table public.zielwerte add constraint zielwerte_einheit_check
    check (einheit in ('anzahl', 'anteil', 'euro'));

insert into public.zielwerte (schluessel, bereich, label, beschreibung, wert, einheit, richtung, sortierung)
values ('hr_umsatz_je_produktionskopf', 'personal', 'Umsatz / Produktions-MA',
        'Mindestens erwarteter Auftragswert je Beschäftigtem der Produktion im Zeitraum.',
        300, 'euro', 'min', 53)
on conflict (schluessel) do nothing;

-- Der Rückgabetyp ändert sich; `create or replace` kann das nicht.
drop function if exists public.kpi_hr_mitarbeiter(date, date);

create function public.kpi_hr_mitarbeiter(
    p_von date,
    p_bis date
)
returns table (
    employee_id   integer,
    name          text,
    department    varchar,
    -- In Anführungszeichen: `position` ist in Postgres ein Schlüsselwort.
    "position"    text,
    status        varchar,
    wochenstunden numeric,
    ist_stunden   numeric,
    ueberstunden  numeric,
    quote         numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
    -- Namen neben Stunden: dieselbe Schranke wie fuer die Personenzeilen.
    if public.app_level('hr') is null then
        return;
    end if;

    return query
    with je_tag as (
        select t.employee_id,
               t.ist_stunden,
               greatest(
                   0,
                   t.ist_stunden
                   - public.hr_tagessoll(e.raw_json, e.weekly_working_hours, t.datum)
               ) as ueber
        from public.hr_ist_stunden_tag t
        join public.personio_employees e on e.id = t.employee_id
        where t.datum between p_von and p_bis
          and t.ist_stunden > 0
    ),
    je_person as (
        select employee_id,
               sum(ist_stunden) as ist,
               sum(ueber) as ueber
        from je_tag
        group by employee_id
    )
    select e.id,
           nullif(btrim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')), ''),
           e.department,
           e.raw_json #>> '{attributes,position,value}',
           e.status,
           -- Eine beliebige ganze Woche: das Tagessoll haengt nur am Wochentag.
           (select round(sum(public.hr_tagessoll(e.raw_json, e.weekly_working_hours, d::date)), 2)
            from generate_series(date '2024-01-01', date '2024-01-07', interval '1 day') d),
           round(coalesce(p.ist, 0), 2),
           round(coalesce(p.ueber, 0), 2),
           -- Wie im Altprojekt: ohne Ueberstunden keine Quote, nicht null.
           case when p.ist > 0 and p.ueber > 0 then round(p.ueber / p.ist, 4) else null end
    from public.personio_employees e
    left join je_person p on p.employee_id = e.id
    order by coalesce(p.ueber, 0) desc, coalesce(p.ist, 0) desc, e.id;
end;
$$;

grant execute on function public.kpi_hr_mitarbeiter(date, date) to authenticated;

create or replace view public.organigramm
with (security_invoker = true) as
select e.id,
       nullif(trim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')), '')
           as name,
       e.raw_json #>> '{attributes,position,value}'              as position,
       e.department,
       e.raw_json #>> '{attributes,office,value,attributes,name}' as standort,
       nullif(e.raw_json #>> '{attributes,supervisor,value,attributes,id,value}', '')::integer
           as vorgesetzter_id,
       coalesce(
           jsonb_path_exists(
               e.raw_json,
               '$.** ? (@.label == "Profile Picture" && @.value != null && @.value != "")'
           ),
           false
       ) as hat_foto
from public.personio_employees e
where e.status = 'active';
"""

DOWNGRADE = """
drop view if exists public.organigramm;
create view public.organigramm
with (security_invoker = true) as
select e.id,
       nullif(trim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')), '')
           as name,
       e.raw_json #>> '{attributes,position,value}'              as position,
       e.department,
       e.raw_json #>> '{attributes,office,value,attributes,name}' as standort,
       nullif(e.raw_json #>> '{attributes,supervisor,value,attributes,id,value}', '')::integer
           as vorgesetzter_id
from public.personio_employees e
where e.status = 'active';
grant select on public.organigramm to authenticated;

drop function if exists public.kpi_hr_mitarbeiter(date, date);
create function public.kpi_hr_mitarbeiter(
    p_von date,
    p_bis date
)
returns table (
    employee_id  integer,
    name         text,
    department   varchar,
    ist_stunden  numeric,
    ueberstunden numeric,
    quote        numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
    if public.app_level('hr') is null then
        return;
    end if;

    return query
    with je_tag as (
        select t.employee_id,
               t.ist_stunden,
               greatest(
                   0,
                   t.ist_stunden
                   - public.hr_tagessoll(e.raw_json, e.weekly_working_hours, t.datum)
               ) as ueber
        from public.hr_ist_stunden_tag t
        join public.personio_employees e on e.id = t.employee_id
        where t.datum between p_von and p_bis
          and t.ist_stunden > 0
    ),
    je_person as (
        select employee_id,
               sum(ist_stunden) as ist,
               sum(ueber) as ueber
        from je_tag
        group by employee_id
    )
    select p.employee_id,
           nullif(btrim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')), ''),
           e.department,
           round(p.ist, 2),
           round(p.ueber, 2),
           case when p.ist > 0 and p.ueber > 0 then round(p.ueber / p.ist, 4) else null end
    from je_person p
    join public.personio_employees e on e.id = p.employee_id
    order by p.ueber desc, p.ist desc;
end;
$$;
grant execute on function public.kpi_hr_mitarbeiter(date, date) to authenticated;

delete from public.zielwerte where schluessel = 'hr_umsatz_je_produktionskopf';
alter table public.zielwerte drop constraint zielwerte_einheit_check;
alter table public.zielwerte add constraint zielwerte_einheit_check
    check (einheit in ('anzahl', 'anteil'));

drop function if exists public.kpi_hr_umsatz_je_produktionskopf_verlauf(date, date, text);
drop function if exists public.kpi_hr_umsatz_je_produktionskopf(date, date);
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
