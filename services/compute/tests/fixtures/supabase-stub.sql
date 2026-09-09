-- Minimale Nachbildung dessen, was Supabase in einer echten Instanz anlegt.
-- Nur für Tests: damit die Migrationen ohne den ganzen Supabase-Stack laufen.
--
-- Enthalten ist genau das, was die Migrationen berühren: die Rollen, das
-- Schema `auth` mit `users`, und `auth.uid()` / `auth.jwt()`, die in den
-- Policies vorkommen. Die Ansprüche werden aus `request.jwt.claims` gelesen,
-- so wie PostgREST sie setzt — Tests können sie per `set_config` vorgeben.

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role supabase_auth_admin nologin noinherit;

create schema if not exists auth authorization supabase_auth_admin;
grant usage on schema auth to anon, authenticated;

create table auth.users (
    id    uuid primary key default gen_random_uuid(),
    email text
);

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
    select coalesce(
        nullif(current_setting('request.jwt.claims', true), '')::jsonb,
        '{}'::jsonb
    );
$$;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
    select nullif(auth.jwt() ->> 'sub', '')::uuid;
$$;

grant execute on function auth.jwt(), auth.uid() to anon, authenticated;
