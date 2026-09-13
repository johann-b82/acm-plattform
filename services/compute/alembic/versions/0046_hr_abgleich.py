"""HR-Abgleich mit dem Altsystem: Standort, Sammelabschluss, Ausstellerzeile.

Revision ID: 0046_hr_abgleich
Revises: 0040_bereich_hr
Create Date: 2026-09-12

Drei Dinge, die die Oberfläche braucht und die Datenbank noch nicht hergibt.

**Der Standort je Person** (SCH-02). Der Stand der Mitarbeiter lässt sich im
Altsystem nach Standort filtern; der Standort steht in Personio unter
`attributes.office` — derselbe Pfad wie im Organigramm. Die Sicht
`schulung_belegschaft` bekommt ihn als letzte Spalte, damit bestehende Abfragen
unverändert bleiben. Das Organigramm allein reicht nicht: es kennt nur
`active`, die Belegschaft auch `onboarding`.

**Der Sammelabschluss** (SCH-05). Eine Schulung, ein Datum, mehrere Teilnehmer.
Als Funktion und nicht als Schleife im Browser, weil es entweder für alle
Gewählten gilt oder für keinen: eine unbekannte Person bricht den ganzen Aufruf
ab, statt die Hälfte einzutragen. Wiederholtes Absenden legt nichts doppelt an
— die Eindeutigkeit je Schulung und Person trägt das `on conflict`. Ein
jüngerer Abschluss wird nicht durch einen älteren überschrieben; das Altsystem
tat das, und damit ließe sich eine Fälligkeit versehentlich vorziehen.
`security invoker`: die Regeln auf `schulung_teilnahmen` gelten wie beim
direkten Schreiben, ein Leser kann auch hierüber nichts eintragen.

**Die Zeile des Ausstellers** (ZEU-02). `zeugnis_aussteller` ist eine
Einzelzeile, angelegt in 0033. Die Übernahme leert ihre Zieltabellen, und im
Altsystem war die Tabelle leer — danach gibt es die Zeile nicht mehr, und die
Pflege lief ins Leere („Nicht gespeichert"). Die Zeile wird wieder angelegt,
und die Pflege darf sie künftig selbst anlegen (`insert` für `hr: editor`),
damit das nicht noch einmal geschieht.
"""
from alembic import op

revision = "0046_hr_abgleich"
down_revision = "0040_bereich_hr"
branch_labels = None
depends_on = None

UPGRADE = """
create or replace view public.schulung_belegschaft
with (security_invoker = true) as
select 'e:' || e.id                                    as schluessel,
       e.id                                            as employee_id,
       null::uuid                                      as extern_id,
       null::text                                      as personalnummer,
       nullif(trim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')), '')
           as name,
       e.department::text                              as abteilung,
       e.hire_date                                     as eintritt,
       'personio'::text                                as herkunft,
       e.raw_json #>> '{attributes,office,value,attributes,name}' as standort
from public.personio_employees e
where e.status in ('active', 'onboarding')

union all

select 'x:' || x.id,
       null::integer,
       x.id,
       null::text,
       x.name,
       x.abteilung::text,
       x.eintritt,
       'extern'::text,
       null::text
from public.externe_personen x

union all

select *
from (
    select distinct on (t.personalnummer)
           'p:' || t.personalnummer                    as schluessel,
           null::integer                               as employee_id,
           null::uuid                                  as extern_id,
           t.personalnummer::text                      as personalnummer,
           coalesce(t.mitarbeiter_name, t.personalnummer)::text as name,
           t.abteilung_kuerzel::text                   as abteilung,
           null::date                                  as eintritt,
           'ohne_zuordnung'::text                      as herkunft,
           null::text                                  as standort
    from public.schulung_teilnahmen t
    where t.employee_id is null
      and t.extern_id is null
      and t.personalnummer is not null
    order by t.personalnummer, t.geaendert_am desc
) as reste;

grant select on public.schulung_belegschaft to authenticated;

create or replace function public.schulung_sammelabschluss(
    p_schulung_id uuid,
    p_datum       date,
    p_personen    text[]
)
returns table (eingetragen integer, unveraendert integer)
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_schluessel  text;
    v_gesamt      integer := 0;
    v_eingetragen integer := 0;
    v_zeilen      integer;
    v_employee    integer;
    v_extern      uuid;
    v_name        text;
begin
    if p_datum is null then
        raise exception 'Ohne Datum lässt sich nichts eintragen.' using errcode = '22023';
    end if;
    if p_datum > current_date then
        raise exception 'Eine Schulung in der Zukunft ist noch nicht durchgeführt.'
            using errcode = '22023';
    end if;
    if not exists (select 1 from public.schulung_katalog where id = p_schulung_id) then
        raise exception 'Diese Schulung gibt es nicht.' using errcode = 'P0002';
    end if;
    if coalesce(cardinality(p_personen), 0) = 0 then
        raise exception 'Keine Teilnehmer gewählt.' using errcode = '22023';
    end if;

    for v_schluessel in select distinct unnest(p_personen) loop
        v_gesamt := v_gesamt + 1;
        v_employee := null;
        v_extern := null;
        v_name := null;

        if v_schluessel ~ '^e:[0-9]+$' then
            select e.id,
                   nullif(trim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')), '')
              into v_employee, v_name
              from public.personio_employees e
             where e.id = substring(v_schluessel from 3)::integer;
        elsif v_schluessel ~* '^x:[0-9a-f-]{36}$' then
            select x.id, x.name
              into v_extern, v_name
              from public.externe_personen x
             where x.id = substring(v_schluessel from 3)::uuid;
        end if;
        if v_employee is null and v_extern is null then
            raise exception 'Unbekannte Person: %', v_schluessel using errcode = 'P0002';
        end if;

        -- Fehlt die Teilnahme, entsteht sie mit diesem Datum als Erst- und
        -- letztem Termin. Gibt es sie, rückt nur ein jüngeres Datum nach.
        if v_employee is not null then
            insert into public.schulung_teilnahmen as t
                   (schulung_id, employee_id, mitarbeiter_name, initial_datum, aktuell_datum)
            values (p_schulung_id, v_employee, v_name, p_datum, p_datum)
            on conflict (schulung_id, employee_id) where employee_id is not null
            do update set aktuell_datum = excluded.aktuell_datum,
                          initial_datum = coalesce(t.initial_datum, excluded.initial_datum)
                    where t.aktuell_datum is null or t.aktuell_datum < excluded.aktuell_datum;
        else
            insert into public.schulung_teilnahmen as t
                   (schulung_id, extern_id, mitarbeiter_name, initial_datum, aktuell_datum)
            values (p_schulung_id, v_extern, v_name, p_datum, p_datum)
            on conflict (schulung_id, extern_id) where extern_id is not null
            do update set aktuell_datum = excluded.aktuell_datum,
                          initial_datum = coalesce(t.initial_datum, excluded.initial_datum)
                    where t.aktuell_datum is null or t.aktuell_datum < excluded.aktuell_datum;
        end if;
        get diagnostics v_zeilen = row_count;
        v_eingetragen := v_eingetragen + v_zeilen;
    end loop;

    return query select v_eingetragen, v_gesamt - v_eingetragen;
end;
$$;

grant execute on function public.schulung_sammelabschluss(uuid, date, text[]) to authenticated;

insert into public.zeugnis_aussteller (id) values (true) on conflict (id) do nothing;

grant insert on public.zeugnis_aussteller to authenticated;
create policy zeugnis_aussteller_anlegen on public.zeugnis_aussteller
    for insert to authenticated
    with check (public.app_mindestens('hr', 'editor'));
"""

DOWNGRADE = """
drop policy if exists zeugnis_aussteller_anlegen on public.zeugnis_aussteller;
revoke insert on public.zeugnis_aussteller from authenticated;

drop function if exists public.schulung_sammelabschluss(uuid, date, text[]);

-- Eine Spalte lässt sich aus einer Sicht nicht per `create or replace`
-- entfernen; die Sicht wird in der Fassung aus 0034 neu angelegt.
drop view public.schulung_belegschaft;

create view public.schulung_belegschaft
with (security_invoker = true) as
select 'e:' || e.id                                    as schluessel,
       e.id                                            as employee_id,
       null::uuid                                      as extern_id,
       null::text                                      as personalnummer,
       nullif(trim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')), '')
           as name,
       e.department::text                              as abteilung,
       e.hire_date                                     as eintritt,
       'personio'::text                                as herkunft
from public.personio_employees e
where e.status in ('active', 'onboarding')

union all

select 'x:' || x.id,
       null::integer,
       x.id,
       null::text,
       x.name,
       x.abteilung::text,
       x.eintritt,
       'extern'::text
from public.externe_personen x

union all

select *
from (
    select distinct on (t.personalnummer)
           'p:' || t.personalnummer                    as schluessel,
           null::integer                               as employee_id,
           null::uuid                                  as extern_id,
           t.personalnummer::text                      as personalnummer,
           coalesce(t.mitarbeiter_name, t.personalnummer)::text as name,
           t.abteilung_kuerzel::text                   as abteilung,
           null::date                                  as eintritt,
           'ohne_zuordnung'::text                      as herkunft
    from public.schulung_teilnahmen t
    where t.employee_id is null
      and t.extern_id is null
      and t.personalnummer is not null
    order by t.personalnummer, t.geaendert_am desc
) as reste;

grant select on public.schulung_belegschaft to authenticated;
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
