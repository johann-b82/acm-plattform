"""Einstellungen: Rechte-Policy, Erscheinungsbild, Personio-Takt und Nachweise, E-Mail, SVG-Logo.

Revision ID: 0051_einstellungen_hilfe
Revises: 0040_bereich_hr
Create Date: 2026-09-12

**SET-04 — `app_grants_read` war eine Tautologie.** In 0001 steht
`ug.group_id = group_id`; innerhalb der Unterabfrage bindet das unqualifizierte
`group_id` an `ug`, nicht an `app_grants`. Damit sah jede Person, die in
irgendeiner Gruppe ist, die Rechte aller Gruppen. Die Policy vergleicht jetzt
mit `app_grants.group_id`.

**SET-06 — App-Name und Farbrollen.** Zwei Spalten in der Plattformzeile. Die
Farben sind je Thema eine Hauptfarbe und die Schrift darauf; die Prüfung auf
sechsstellige Hexwerte steht hier und nicht nur in der Maske, weil die Werte
serverseitig als Stylesheet in den Dokumentkopf gehen. Vor der Anmeldung
braucht die Anmeldeseite Name und Farben — `anon` bekommt dafür eine Funktion,
nicht die Zeile.

**SET-08 — Personio-Takt.** Kein zweiter Planer: der bestehende pg_cron-Job
läuft jetzt stündlich und fragt `hr_abgleich_faellig()`, ob seit dem Beginn des
letzten Abgleichs das eingestellte Intervall vergangen ist. 0 heißt nur von
Hand. Vorgabe 24 Stunden — so lief der Job bisher (täglich 02:15).

**SET-09 — Nachweise nach Personio.** Schulungen und Kompetenzen ändert die
Oberfläche über PostgREST; es gibt keinen Dienst, an dem ein Aufruf hängen
könnte. Deshalb merken Trigger auf `schulung_teilnahmen` und
`kompetenz_bewertungen` einen Nachweis vor — nur bei eingeschaltetem Schalter
und hinterlegter Kategorie. Die lokale Änderung ist damit geschrieben, bevor
irgendetwas nach Personio geht. Je Person und Art steht höchstens ein offener
Auftrag (Teilindex); ein pg_cron-Job stößt `compute` an, wenn etwas offen ist.

**SET-16 — E-Mail.** Eine eigene Zeile ohne Rechte für `authenticated`: die
Maske spricht mit `compute`, weil dort auch das Client-Secret und das
Refresh-Token verschlüsselt werden (in `geheimnisse`).

**SET-07 — SVG-Logo.** `image/svg+xml` ist zugelassen. Weil eine SVG-Datei
Skripte tragen kann, lädt nur noch `compute` hoch: es prüft den Inhalt,
reinigt SVG und legt für die Formblätter ein PNG daneben (`raster_pfad`). Die
Browser-Regel zum Hochladen in den Eimer `plattform` entfällt, ebenso das
direkte Ändern der Logozeile.
"""
from alembic import op

revision = "0051_einstellungen_hilfe"
down_revision = "0040_bereich_hr"
branch_labels = None
depends_on = None

HEX = "'^#[0-9A-Fa-f]{6}$'"

UPGRADE = f"""
-- --- SET-04 --------------------------------------------------------------------
drop policy if exists app_grants_read on public.app_grants;
create policy app_grants_read on public.app_grants
    for select to authenticated
    using (public.is_platform_admin()
           or exists (select 1 from public.user_groups ug
                      where ug.group_id = app_grants.group_id and ug.user_id = auth.uid()));

-- --- SET-06, SET-08, SET-09: Spalten der Plattformzeile -------------------------
alter table public.plattform_einstellungen
    add column app_name varchar(60) not null default 'ACM-Plattform'
        check (length(btrim(app_name)) between 1 and 60),
    add column farben jsonb
        check (farben is null or (
            coalesce(farben #>> '{{hell,hauptfarbe}}', '') ~ {HEX}
            and coalesce(farben #>> '{{hell,textAufHauptfarbe}}', '') ~ {HEX}
            and coalesce(farben #>> '{{dunkel,hauptfarbe}}', '') ~ {HEX}
            and coalesce(farben #>> '{{dunkel,textAufHauptfarbe}}', '') ~ {HEX})),
    add column personio_sync_intervall_h integer not null default 24
        check (personio_sync_intervall_h in (0, 1, 6, 24, 168)),
    add column personio_nachweis_aktiv boolean not null default false,
    add column personio_nachweis_kategorie varchar(64);

create or replace function public.plattform_erscheinung()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    select jsonb_build_object('app_name', app_name, 'farben', farben)
    from public.plattform_einstellungen
    where id;
$$;

revoke all on function public.plattform_erscheinung() from public;
grant execute on function public.plattform_erscheinung() to anon, authenticated;

-- --- SET-08 --------------------------------------------------------------------
-- Fällig, wenn seit dem Beginn des letzten Abgleichs (Ende minus Dauer) das
-- Intervall vergangen ist. Zehn Minuten Spielraum, damit ein Lauf, der um
-- 12:15 begann, am nächsten Tag um 12:15 wieder dran ist und nicht erst 13:15.
-- Gezählt wird jeder Lauf, auch ein gescheiterter: sonst fragte ein falscher
-- Zugang Personio jede Stunde an.
create or replace function public.hr_abgleich_faellig(p_jetzt timestamptz default now())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select case
        when e.personio_sync_intervall_h = 0 then false
        else coalesce(
            (select max(m.gelaufen_am - make_interval(secs => coalesce(m.dauer_sekunden, 0)::double precision))
             from public.personio_sync_meta m)
                <= p_jetzt - make_interval(hours => e.personio_sync_intervall_h) + interval '10 minutes',
            true)
    end
    from public.plattform_einstellungen e
    where e.id;
$$;

revoke execute on function public.hr_abgleich_faellig(timestamptz) from public, anon, authenticated;

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
    if not public.hr_abgleich_faellig() then
        return null;
    end if;
    if geheim is null or geheim = '' then
        raise notice 'acm.hr_sync_token ist nicht gesetzt — Abgleich uebersprungen';
        return null;
    end if;
    select net.http_post(
        url     := 'http://compute:8000/api/hr/sync/geplant',
        headers := jsonb_build_object('X-HR-Sync-Token', geheim),
        timeout_milliseconds := 5000
    ) into anfrage;
    return anfrage;
end;
$$;

revoke execute on function public.hr_abgleich_anstossen() from public, anon, authenticated;

-- --- SET-09 --------------------------------------------------------------------
create table public.personio_nachweise (
    id           bigint generated always as identity primary key,
    employee_id  integer not null references public.personio_employees(id) on delete cascade,
    art          varchar(16) not null check (art in ('schulung', 'kompetenz')),
    angelegt_am  timestamptz not null default now(),
    erledigt_am  timestamptz,
    versuche     integer not null default 0,
    fehler       text,
    -- Prüfsumme des hochgeladenen Nachweises. Ist der nächste inhaltlich
    -- gleich, geht er nicht noch einmal hoch.
    inhalt_hash  varchar(64)
);

create unique index personio_nachweise_offen
    on public.personio_nachweise (employee_id, art) where erledigt_am is null;

alter table public.personio_nachweise enable row level security;
grant select on public.personio_nachweise to authenticated;
create policy personio_nachweise_lesen on public.personio_nachweise
    for select to authenticated using (public.app_mindestens('platform', 'admin'));

create or replace function public.personio_nachweis_vormerken()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_zeile record;
    v_mitarbeiter integer;
    v_art text;
begin
    if not exists (select 1 from public.plattform_einstellungen
                   where id and personio_nachweis_aktiv
                     and coalesce(btrim(personio_nachweis_kategorie), '') <> '') then
        return null;
    end if;
    if tg_op = 'DELETE' then
        v_zeile := old;
    else
        v_zeile := new;
    end if;
    if tg_table_name = 'schulung_teilnahmen' then
        v_mitarbeiter := v_zeile.employee_id;
        v_art := 'schulung';
    else
        select p.employee_id into v_mitarbeiter
        from public.kompetenz_personen p where p.id = v_zeile.person_id;
        v_art := 'kompetenz';
    end if;
    if v_mitarbeiter is null then
        return null;
    end if;
    insert into public.personio_nachweise (employee_id, art)
    values (v_mitarbeiter, v_art)
    on conflict (employee_id, art) where erledigt_am is null do nothing;
    return null;
end;
$$;

revoke execute on function public.personio_nachweis_vormerken() from public, anon, authenticated;

create trigger personio_nachweis_schulung
    after insert or update or delete on public.schulung_teilnahmen
    for each row execute function public.personio_nachweis_vormerken();
create trigger personio_nachweis_kompetenz
    after insert or update or delete on public.kompetenz_bewertungen
    for each row execute function public.personio_nachweis_vormerken();

create or replace function public.personio_nachweise_anstossen()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
    geheim text := current_setting('acm.hr_sync_token', true);
    anfrage bigint;
begin
    if not exists (select 1 from public.personio_nachweise
                   where erledigt_am is null and versuche < 5) then
        return null;
    end if;
    if geheim is null or geheim = '' then
        return null;
    end if;
    select net.http_post(
        url     := 'http://compute:8000/api/personio/nachweise/geplant',
        headers := jsonb_build_object('X-HR-Sync-Token', geheim),
        timeout_milliseconds := 5000
    ) into anfrage;
    return anfrage;
end;
$$;

revoke execute on function public.personio_nachweise_anstossen() from public, anon, authenticated;

do $$
begin
    if exists (select 1 from pg_available_extensions where name = 'pg_net')
       and exists (select 1 from pg_available_extensions where name = 'pg_cron') then
        execute 'create extension if not exists pg_net';
        execute 'create extension if not exists pg_cron';
        -- Derselbe Name ersetzt den täglichen Job aus 0013.
        perform cron.schedule('personio-abgleich', '15 * * * *',
                              'select public.hr_abgleich_anstossen()');
        perform cron.schedule('personio-nachweise', '*/10 * * * *',
                              'select public.personio_nachweise_anstossen()');
    end if;
end
$$;

-- --- SET-16 --------------------------------------------------------------------
create table public.email_einstellungen (
    id              boolean primary key default true check (id),
    aktiv           boolean not null default false,
    modus           varchar(16) not null default 'app' check (modus in ('app', 'delegiert')),
    tenant_id       varchar(64),
    client_id       varchar(64),
    absender        varchar(254),
    absender_name   varchar(120),
    -- Das Konto, mit dem sich jemand im delegierten Modus angemeldet hat.
    delegiert_konto varchar(254),
    geaendert_am    timestamptz not null default now(),
    geaendert_von   uuid references auth.users(id) on delete set null
);

insert into public.email_einstellungen (id) values (true);

alter table public.email_einstellungen enable row level security;
revoke all on public.email_einstellungen from public, anon, authenticated;

-- --- SET-07 --------------------------------------------------------------------
alter table public.plattform_logo drop constraint if exists plattform_logo_mime_check;
alter table public.plattform_logo
    add constraint plattform_logo_mime_check
        check (mime in ('image/png', 'image/jpeg', 'image/svg+xml')),
    add column raster_pfad text;

update storage.buckets
    set allowed_mime_types = array['image/png', 'image/jpeg', 'image/svg+xml']
    where id = 'plattform';

drop policy if exists plattform_datei_hoch on storage.objects;
drop policy if exists plattform_logo_pflegen on public.plattform_logo;
revoke update on public.plattform_logo from authenticated;
"""

DOWNGRADE = """
grant update on public.plattform_logo to authenticated;
create policy plattform_logo_pflegen on public.plattform_logo
    for update to authenticated
    using (public.app_mindestens('platform', 'admin'))
    with check (public.app_mindestens('platform', 'admin'));
create policy plattform_datei_hoch on storage.objects
    for insert to authenticated
    with check (
        bucket_id = 'plattform'
        and public.app_mindestens('platform', 'admin')
        and (storage.foldername(name))[1] = auth.uid()::text
    );
update storage.buckets set allowed_mime_types = array['image/png', 'image/jpeg']
    where id = 'plattform';
alter table public.plattform_logo drop column if exists raster_pfad;
alter table public.plattform_logo drop constraint if exists plattform_logo_mime_check;
alter table public.plattform_logo
    add constraint plattform_logo_mime_check check (mime in ('image/png', 'image/jpeg'));

drop table if exists public.email_einstellungen;

do $$
begin
    if exists (select 1 from pg_extension where extname = 'pg_cron') then
        perform cron.unschedule('personio-nachweise');
        perform cron.schedule('personio-abgleich', '15 2 * * *',
                              'select public.hr_abgleich_anstossen()');
    end if;
exception when others then null;
end
$$;

drop trigger if exists personio_nachweis_kompetenz on public.kompetenz_bewertungen;
drop trigger if exists personio_nachweis_schulung on public.schulung_teilnahmen;
drop function if exists public.personio_nachweise_anstossen();
drop function if exists public.personio_nachweis_vormerken();
drop table if exists public.personio_nachweise;

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
        timeout_milliseconds := 5000
    ) into anfrage;
    return anfrage;
end;
$$;
drop function if exists public.hr_abgleich_faellig(timestamptz);
drop function if exists public.plattform_erscheinung();

alter table public.plattform_einstellungen
    drop column if exists personio_nachweis_kategorie,
    drop column if exists personio_nachweis_aktiv,
    drop column if exists personio_sync_intervall_h,
    drop column if exists farben,
    drop column if exists app_name;

-- `app_grants_read` bleibt korrigiert: ein Rückbau soll die Lücke nicht
-- wieder öffnen.
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
