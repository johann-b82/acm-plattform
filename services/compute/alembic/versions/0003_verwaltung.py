"""Verwaltung: Nutzerliste für Plattform-Admins, Aufräumjob per pg_cron.

Revision ID: 0003_verwaltung
Revises: 0002_vertrieb
Create Date: 2026-09-09

Zwei Dinge:

1. `auth.users` gehört Supabase und ist für `authenticated` nicht lesbar. Die
   Rechteverwaltung braucht aber eine Liste, um Mitglieder zuzuordnen. Die
   Sicht `plattform_nutzer` gehört `postgres` (läuft also mit dessen Rechten)
   und filtert selbst auf Plattform-Admins. Ohne diesen Filter wäre die
   E-Mail-Liste aller Nutzer für jeden Angemeldeten lesbar.

2. Aufräumen gehört in die Datenbank, nicht in einen Anwendungsdienst. Im
   Altprojekt lag die Aufbewahrung im APScheduler des API-Prozesses; ein
   Neustart verschob sie, und die Frist stand auf 3650 Tagen. pg_cron läuft
   unabhängig vom Dienst.
"""
from alembic import op

revision = "0003_verwaltung"
down_revision = "0002_vertrieb"
branch_labels = None
depends_on = None

UPGRADE = """
-- Sicht auf die Nutzer. Bewusst OHNE security_invoker: sie soll mit den
-- Rechten ihres Eigentümers auf auth.users zugreifen dürfen. Der Schutz sitzt
-- in der WHERE-Bedingung.
create view public.plattform_nutzer as
    select u.id,
           u.email,
           u.created_at,
           u.last_sign_in_at
      from auth.users u
     where public.is_platform_admin();

grant select on public.plattform_nutzer to authenticated;

-- Aufbewahrung: Upload-Protokolle älter als ein Jahr verschwinden. Die
-- Nutzdaten (revenues, auftraege) bleiben, sie sind die Kennzahlenbasis.
create or replace function public.aufraeumen_upload_batches()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    geloescht integer;
begin
    delete from public.upload_batches where uploaded_at < now() - interval '365 days';
    get diagnostics geloescht = row_count;
    return geloescht;
end;
$$;

revoke execute on function public.aufraeumen_upload_batches() from public, anon, authenticated;

-- pg_cron ist im Supabase-Image vorgeladen und arbeitet in der Datenbank
-- `postgres`. In der Testdatenbank (schlichtes postgres-Image) fehlt es; die
-- Migration muss deshalb auch ohne durchlaufen.
do $$
begin
    if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
        execute 'create extension if not exists pg_cron';
        perform cron.schedule(
            'aufraeumen-upload-batches',
            '30 3 * * *',
            'select public.aufraeumen_upload_batches()'
        );
    else
        raise notice 'pg_cron nicht verfuegbar — Aufraeumjob nicht eingeplant (erwartet in der Testdatenbank).';
    end if;
end $$;
"""

DOWNGRADE = """
do $$
begin
    if exists (select 1 from pg_extension where extname = 'pg_cron') then
        perform cron.unschedule('aufraeumen-upload-batches');
    end if;
exception when others then
    null;
end $$;
drop function if exists public.aufraeumen_upload_batches();
drop view if exists public.plattform_nutzer;
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
