"""HR: Personio-Abgleich, Überstunden-, Krankheits- und Fluktuationsquote.

Revision ID: 0013_hr_grundlage
Revises: 0012_vertriebsaktivitaet
Create Date: 2026-09-10

Alles Zeitliche hängt an **einer** Größe: dem Personio-Arbeitszeitmodell
(`raw_json.attributes.work_schedule.value.attributes`, Sollzeit je Wochentag
als `HH:MM`). An den echten Daten nachgesehen: alle 75 aktiven Personen haben
eines, und es ist nicht flach — ein typisches Modell lautet Mo–Do 08:45 und
Fr 05:00. Ein pauschales Tagessoll von acht Stunden läge am Freitag um drei
Stunden daneben und am Wochenende um acht.

Daraus folgt für jede Kennzahl dieselbe Regel: `hr_tagessoll(person, tag)`.
Fehlt das Modell, gilt `weekly_working_hours / 5`, sonst 8 h.

Gegenüber dem Altprojekt ändert sich damit **eine** Rechnung wirklich:

  **Krankstunden.** Das Altprojekt prüft `time_unit = 'hours'`, Personio
  schreibt aber `'hour'` — der Zweig lief nie an. Stundenbasierte
  Abwesenheiten (Freizeitausgleich) wurden über Kalendertage mal Tagessatz
  gerechnet, Wochenenden eingeschlossen. Hier zählt das Präfix `hour`, und
  tagesbasierte Abwesenheiten werden über das Modell verteilt statt über
  Kalendertage. Der Unterschied ist an echten Daten gemessen und steht in der
  PR-Beschreibung.

Die Überstundenquote ist dagegen ein treuer Nachbau: das Altprojekt hat sie
mit `f4dd26b` bereits auf Tagessummen und das exakte Modell umgestellt. Die
Notiz in `docs/kpi-rechenwege.md`, die von einer Rechnung „je Segment"
spricht, beschreibt einen Stand von vor dieser Korrektur und wird hier
mitberichtigt.

Unverändert übernommen, auch wo es angreifbar ist: keine Feiertagslogik, die
Fluktuation wird nicht annualisiert, und Personen ohne Arbeitszeitmodell und
ohne `weekly_working_hours` zählen mit acht Stunden je Werktag.
"""
from alembic import op

revision = "0013_hr_grundlage"
down_revision = "0012_vertriebsaktivitaet"
branch_labels = None
depends_on = None

UPGRADE = """
create table public.personio_employees (
    id                    integer primary key,
    first_name            varchar(128),
    last_name             varchar(128),
    email                 varchar(255),
    department            varchar(128),
    status                varchar(32),
    hire_date             date,
    termination_date      date,
    -- Personio traegt hier den TAGESwert ein (Vollzeit 40 h steht als 8).
    -- Der Name ist Personios, nicht unserer; er bleibt, damit die Spalte
    -- gegen die alte Datenbank vergleichbar ist.
    weekly_working_hours  numeric(6, 2),
    raw_json              jsonb,
    synced_at             timestamptz not null
);

create index personio_employees_dept_idx on public.personio_employees (department);
create index personio_employees_status_idx on public.personio_employees (status);

create table public.personio_attendance (
    id             varchar(64) primary key,
    employee_id    integer not null,
    datum          date not null,
    start_time     time,
    end_time       time,
    break_minutes  integer not null default 0,
    synced_at      timestamptz not null
);

create index personio_attendance_person_tag_idx
    on public.personio_attendance (employee_id, datum);
create index personio_attendance_tag_idx on public.personio_attendance (datum);

create table public.personio_absences (
    id               varchar(64) primary key,
    employee_id      integer not null,
    absence_type_id  integer,
    start_date       date not null,
    end_date         date not null,
    -- 'day', 'days', 'hour', 'hours' — Personio ist hier nicht einheitlich.
    time_unit        varchar(16),
    hours            numeric(8, 2),
    raw_json         jsonb,
    synced_at        timestamptz not null
);

create index personio_absences_person_idx on public.personio_absences (employee_id);
create index personio_absences_spanne_idx on public.personio_absences (start_date, end_date);

create table public.personio_sync_meta (
    id                 integer primary key generated always as identity,
    gelaufen_am        timestamptz not null default now(),
    status             varchar(16) not null,
    fehler             text,
    mitarbeiter        integer not null default 0,
    anwesenheiten      integer not null default 0,
    abwesenheiten      integer not null default 0,
    dauer_sekunden     numeric(8, 2)
);

create index personio_sync_meta_zeit_idx on public.personio_sync_meta (gelaufen_am desc);

alter table public.personio_employees   enable row level security;
alter table public.personio_attendance  enable row level security;
alter table public.personio_absences    enable row level security;
alter table public.personio_sync_meta   enable row level security;

grant select on public.personio_employees  to authenticated;
grant select on public.personio_attendance to authenticated;
grant select on public.personio_absences   to authenticated;
grant select on public.personio_sync_meta  to authenticated;

-- Personenbezogene Daten: sichtbar nur, wer das HR-Modul sehen darf. Die
-- Kennzahlenfunktionen unten sind `security definer` und geben ausschliesslich
-- Aggregate heraus — deshalb reicht dort das Recht `kpi`.
create policy personio_employees_read on public.personio_employees
    for select to authenticated using (public.app_level('hr') is not null);
create policy personio_attendance_read on public.personio_attendance
    for select to authenticated using (public.app_level('hr') is not null);
create policy personio_absences_read on public.personio_absences
    for select to authenticated using (public.app_level('hr') is not null);
create policy personio_sync_meta_read on public.personio_sync_meta
    for select to authenticated using (public.app_level('hr') is not null);

-- Die Kachel `hr` gibt es seit 0001. Sie bekommt nur einen sprechenderen
-- Namen; der Pfad `/hr` bleibt, weil HR eine eigene Berechtigung hat und
-- nicht unter dem KPI-Dashboard haengt — dort liegen Personendaten.
update public.apps set name = 'Personal' where id = 'hr';

-- ---------------------------------------------------------------------------
-- Einstellungen, die keine Zielwerte sind: welche Abwesenheitsarten als krank
-- gelten und welche Abteilungen zur Produktion zaehlen. Eine Zeile je
-- Schluessel, wie bei den Zielwerten — kein breites Singleton wie im
-- Altprojekt.
-- ---------------------------------------------------------------------------
create table public.hr_einstellungen (
    schluessel   varchar(64) primary key,
    beschreibung text not null,
    werte        text[] not null default '{}',
    geaendert_am timestamptz not null default now()
);

alter table public.hr_einstellungen enable row level security;
grant select on public.hr_einstellungen to authenticated;
grant update on public.hr_einstellungen to authenticated;

create policy hr_einstellungen_read on public.hr_einstellungen
    for select to authenticated using (public.app_level('kpi') is not null);
create policy hr_einstellungen_write on public.hr_einstellungen
    for update to authenticated
    using (public.app_mindestens('settings', 'editor'))
    with check (public.app_mindestens('settings', 'editor'));

insert into public.hr_einstellungen (schluessel, beschreibung) values
    ('krank_typ_ids', 'Personio-IDs der Abwesenheitsarten, die als Krankheit zählen. Ohne Angabe bleibt die Krankheitsquote leer.'),
    ('produktion_abteilungen', 'Abteilungen, die zur Produktion zählen. Grundlage für Umsatz je Produktionskopf.');

-- ---------------------------------------------------------------------------
-- Das Tagessoll ist die eine Groesse, an der alles haengt.
-- ---------------------------------------------------------------------------
create or replace function public.hr_tagessoll(
    p_raw           jsonb,
    p_wochenstunden numeric,
    p_tag           date
)
returns numeric
language sql
immutable
as $$
    with modell as (
        select p_raw -> 'attributes' -> 'work_schedule' -> 'value' -> 'attributes' as m
    ),
    tag as (
        select (select m from modell) ->> (
            case extract(isodow from p_tag)
                when 1 then 'monday'   when 2 then 'tuesday' when 3 then 'wednesday'
                when 4 then 'thursday' when 5 then 'friday'  when 6 then 'saturday'
                else 'sunday'
            end
        ) as hhmm,
        -- Ein Modell zaehlt nur, wenn ueberhaupt ein Tag darin belegt ist;
        -- sonst waere ein leeres Modell ein Soll von null an jedem Tag.
        exists (
            select 1
            from jsonb_each_text((select m from modell)) kv(k, v)
            where kv.k in ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')
              and kv.v ~ '^[0-9]{1,2}:[0-9]{2}$'
              and split_part(kv.v, ':', 1)::numeric + split_part(kv.v, ':', 2)::numeric / 60 > 0
        ) as brauchbar
    )
    select case
        when tag.brauchbar and tag.hhmm ~ '^[0-9]{1,2}:[0-9]{2}$'
            then split_part(tag.hhmm, ':', 1)::numeric
                 + split_part(tag.hhmm, ':', 2)::numeric / 60
        when tag.brauchbar then 0
        -- Kein brauchbares Modell: flach ueber die Werktage verteilen.
        when extract(isodow from p_tag) <= 5
            then coalesce(p_wochenstunden, 40) / 5
        else 0
    end
    from tag;
$$;

grant execute on function public.hr_tagessoll(jsonb, numeric, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Ist-Stunden je Person und Tag. Personio liefert Vor- und Nachmittag als
-- getrennte Segmente; erst summieren, dann gegen das Tagessoll halten.
-- ---------------------------------------------------------------------------
create or replace view public.hr_ist_stunden_tag as
    select a.employee_id,
           a.datum,
           sum(
               greatest(
                   0,
                   extract(epoch from (a.end_time - a.start_time)) / 3600.0
                       - coalesce(a.break_minutes, 0) / 60.0
               )
           ) as ist_stunden
    from public.personio_attendance a
    where a.start_time is not null
      and a.end_time is not null
    group by a.employee_id, a.datum;

grant select on public.hr_ist_stunden_tag to authenticated;

create or replace function public.kpi_hr_ueberstunden(
    p_von date,
    p_bis date
)
returns table (
    ist_stunden  numeric,
    ueberstunden numeric,
    quote        numeric,
    personen     bigint
)
language sql
stable
security definer
set search_path = public
as $$
    with tag as (
        select t.employee_id,
               t.ist_stunden,
               public.hr_tagessoll(e.raw_json, e.weekly_working_hours, t.datum) as soll
        from public.hr_ist_stunden_tag t
        join public.personio_employees e on e.id = t.employee_id
        where t.datum between p_von and p_bis
          and t.ist_stunden > 0
    )
    select coalesce(sum(ist_stunden), 0),
           coalesce(sum(greatest(0, ist_stunden - soll)), 0),
           case when coalesce(sum(ist_stunden), 0) > 0
                then sum(greatest(0, ist_stunden - soll)) / sum(ist_stunden)
                else null end,
           count(distinct employee_id)
    from tag;
$$;

-- Aktive Personen an einem Stichtag: eingetreten und nicht ausgetreten.
create or replace function public.hr_aktiv_am(p_tag date)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
    select count(*)
    from public.personio_employees e
    where e.hire_date is not null
      and e.hire_date <= p_tag
      and (e.termination_date is null or e.termination_date > p_tag);
$$;

create or replace function public.kpi_hr_krankheit(
    p_von date,
    p_bis date
)
returns table (
    krank_stunden numeric,
    soll_stunden  numeric,
    quote         numeric,
    eingerichtet  boolean
)
language sql
stable
security definer
set search_path = public
as $$
    with typen as (
        select array(
            select unnest(werte)::integer
            from public.hr_einstellungen
            where schluessel = 'krank_typ_ids'
        ) as ids
    ),
    krank as (
        select
            case
                -- Personio schreibt 'hour' oder 'hours'. Das Altprojekt prueft
                -- nur 'hours' und verfehlt den Zweig deshalb immer.
                when a.time_unit like 'hour%' and a.hours is not null then
                    a.hours
                    * (least(a.end_date, p_bis) - greatest(a.start_date, p_von) + 1)::numeric
                    / greatest(a.end_date - a.start_date + 1, 1)
                else (
                    -- Tagesbasiert: ueber das Arbeitszeitmodell verteilen.
                    -- Ein Krankheitstag am Samstag kostet damit null Stunden,
                    -- nicht acht.
                    select coalesce(sum(public.hr_tagessoll(e.raw_json, e.weekly_working_hours, d::date)), 0)
                    from generate_series(greatest(a.start_date, p_von),
                                         least(a.end_date, p_bis),
                                         interval '1 day') d
                )
            end as stunden
        from public.personio_absences a
        join public.personio_employees e on e.id = a.employee_id
        cross join typen
        where cardinality(typen.ids) > 0
          and a.absence_type_id = any (typen.ids)
          and a.start_date <= p_bis
          and a.end_date >= p_von
    ),
    soll as (
        select coalesce(sum(public.hr_tagessoll(e.raw_json, e.weekly_working_hours, d::date)), 0) as stunden
        from public.personio_employees e
        cross join generate_series(p_von, p_bis, interval '1 day') d
        where e.hire_date is not null
          and e.hire_date <= p_bis
          and (e.termination_date is null or e.termination_date > p_bis)
    )
    select coalesce((select sum(stunden) from krank), 0),
           soll.stunden,
           case when soll.stunden > 0 and (select cardinality(ids) from typen) > 0
                then coalesce((select sum(stunden) from krank), 0) / soll.stunden
                else null end,
           (select cardinality(ids) > 0 from typen)
    from soll;
$$;

create or replace function public.kpi_hr_fluktuation(
    p_von date,
    p_bis date
)
returns table (
    austritte       bigint,
    bestand_schnitt numeric,
    quote           numeric
)
language sql
stable
security definer
set search_path = public
as $$
    with bestand as (
        -- Durchschnitt ueber alle Kalendertage des Fensters, nicht Anfang
        -- gegen Ende. Ein Eintritt in der Mitte zaehlt anteilig.
        select avg(x.anzahl) as schnitt
        from (
            select (
                select count(*)
                from public.personio_employees e
                where e.hire_date is not null
                  and e.hire_date <= d::date
                  and (e.termination_date is null or e.termination_date > d::date)
            ) as anzahl
            from generate_series(p_von, p_bis, interval '1 day') d
        ) x
    ),
    ausgetreten as (
        select count(*) as anzahl
        from public.personio_employees e
        where e.termination_date between p_von and p_bis
    )
    select ausgetreten.anzahl,
           coalesce(bestand.schnitt, 0),
           case when coalesce(bestand.schnitt, 0) > 0
                then ausgetreten.anzahl / bestand.schnitt
                else null end
    from ausgetreten, bestand;
$$;

create or replace function public.kpi_hr_verlauf(
    p_von  date,
    p_bis  date,
    p_takt text default 'month'
)
returns table (
    bucket             date,
    ueberstunden_quote numeric,
    krankheits_quote   numeric
)
language sql
stable
security definer
set search_path = public
as $$
    select b.start::date,
           (select quote from public.kpi_hr_ueberstunden(b.start::date, b.ende::date)),
           (select quote from public.kpi_hr_krankheit(b.start::date, b.ende::date))
    from (
        select g as start,
               least(g + (('1 ' || p_takt)::interval) - interval '1 day', p_bis) as ende
        from generate_series(p_von, p_bis, ('1 ' || p_takt)::interval) g
    ) b
    order by b.start;
$$;

grant execute on function public.kpi_hr_ueberstunden(date, date) to authenticated;
grant execute on function public.kpi_hr_krankheit(date, date)    to authenticated;
grant execute on function public.kpi_hr_fluktuation(date, date)  to authenticated;
grant execute on function public.kpi_hr_verlauf(date, date, text) to authenticated;
grant execute on function public.hr_aktiv_am(date)               to authenticated;

-- ---------------------------------------------------------------------------
-- Der naechtliche Abgleich. pg_cron kann nur SQL; den HTTP-Aufruf macht
-- pg_net. Beides ist im Supabase-Image vorhanden, in der Testdatenbank
-- (schlichtes postgres-Image) nicht — die Migration muss auch ohne durchlaufen.
--
-- Das Geheimnis steht nicht in dieser Datei: die Migration liest es aus einer
-- Datenbank-Einstellung, die der Betreiber einmal setzt. Ein Geheimnis im
-- Migrationscode landete sonst in der Historie des Repos.
--
--   alter database postgres set acm.hr_sync_token = '<geheimnis>';
--
-- Ohne gesetzten Wert wird kein Job angelegt; der Abgleich laeuft dann nur
-- von Hand ueber die Oberflaeche.
-- ---------------------------------------------------------------------------
create or replace function public.hr_abgleich_anstossen()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
    geheim text := current_setting('acm.hr_sync_token', true);
    anfrage bigint;
begin
    if geheim is null or geheim = '' then
        raise notice 'acm.hr_sync_token ist nicht gesetzt — Abgleich uebersprungen';
        return null;
    end if;
    select net.http_post(
        url     := 'http://compute:8000/api/hr/sync/geplant',
        headers := jsonb_build_object('X-HR-Sync-Token', geheim),
        -- Der Abgleich dauert Minuten; pg_net wartet nicht darauf, sondern
        -- legt die Antwort spaeter in net._http_response ab.
        timeout_milliseconds := 5000
    ) into anfrage;
    return anfrage;
end;
$$;

revoke execute on function public.hr_abgleich_anstossen() from public, anon, authenticated;

do $$
begin
    if exists (select 1 from pg_available_extensions where name = 'pg_net')
       and exists (select 1 from pg_available_extensions where name = 'pg_cron') then
        execute 'create extension if not exists pg_net';
        execute 'create extension if not exists pg_cron';
        perform cron.schedule(
            'personio-abgleich',
            -- Vor dem Arbeitstag, nach Mitternacht: Personio hat dann den
            -- Vortag vollstaendig.
            '15 2 * * *',
            'select public.hr_abgleich_anstossen()'
        );
    end if;
end
$$;

insert into public.zielwerte (schluessel, bereich, label, beschreibung, wert, einheit, richtung, sortierung)
values
    ('hr_ueberstunden', 'personal', 'Überstunden-Quote',
     'Höchster Anteil an Überstunden gemessen an den geleisteten Stunden.',
     0.05, 'anteil', 'max', 50),
    ('hr_krankheit', 'personal', 'Krankheitsquote',
     'Höchster Anteil an Krankstunden gemessen an den Sollstunden.',
     0.04, 'anteil', 'max', 51),
    ('hr_fluktuation', 'personal', 'Fluktuation',
     'Höchster Anteil an Austritten am durchschnittlichen Personalbestand.',
     0.10, 'anteil', 'max', 52);
"""

DOWNGRADE = """
do $$
begin
    if exists (select 1 from pg_extension where extname = 'pg_cron') then
        perform cron.unschedule('personio-abgleich');
    end if;
exception when others then null;
end
$$;
drop function if exists public.hr_abgleich_anstossen();
delete from public.zielwerte where bereich = 'personal';
update public.apps set name = 'HR' where id = 'hr';
drop function if exists public.kpi_hr_verlauf(date, date, text);
drop function if exists public.kpi_hr_fluktuation(date, date);
drop function if exists public.kpi_hr_krankheit(date, date);
drop function if exists public.kpi_hr_ueberstunden(date, date);
drop function if exists public.hr_aktiv_am(date);
drop view if exists public.hr_ist_stunden_tag;
drop table if exists public.hr_einstellungen;
drop table if exists public.personio_sync_meta;
drop table if exists public.personio_absences;
drop table if exists public.personio_attendance;
drop table if exists public.personio_employees;
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
