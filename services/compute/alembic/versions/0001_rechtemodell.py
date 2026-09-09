"""Rechtemodell: apps, groups, user_groups, app_grants; RLS; Token-Hook.

Revision ID: 0001_rechtemodell
Revises:
Create Date: 2026-09-09

Siehe docs/plan.md § 3.3 und docs/adr/0004. `groups.source` ('manual'|'ad') und
`external_id` bereiten die AD-Anbindung vor, ohne dass sie jetzt gebaut wird.
"""
from alembic import op

revision = "0001_rechtemodell"
down_revision = None
branch_labels = None
depends_on = None

LEVELS = "array['viewer','editor','admin']"

UPGRADE = f"""
create table public.apps (
    id    text primary key,
    name  text not null,
    path  text not null,
    icon  text,
    sort  integer not null default 0
);

create table public.groups (
    id          uuid primary key default gen_random_uuid(),
    name        text not null unique,
    source      text not null default 'manual' check (source in ('manual', 'ad')),
    external_id text unique,
    synced_at   timestamptz,
    created_at  timestamptz not null default now()
);

create table public.user_groups (
    user_id  uuid not null references auth.users (id) on delete cascade,
    group_id uuid not null references public.groups (id) on delete cascade,
    primary key (user_id, group_id)
);
create index ix_user_groups_group on public.user_groups (group_id);

create table public.app_grants (
    group_id uuid not null references public.groups (id) on delete cascade,
    app_id   text not null references public.apps (id) on delete cascade,
    level    text not null check (level in ('viewer', 'editor', 'admin')),
    primary key (group_id, app_id)
);

-- Effektive Rechte eines Nutzers: höchstes Level je App über alle Gruppen.
create or replace function public.effective_apps(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(jsonb_object_agg(app_id, level), '{{}}'::jsonb)
    from (
        select ag.app_id,
               ({LEVELS})[max(array_position({LEVELS}, ag.level))] as level
        from public.app_grants ag
        join public.user_groups ug on ug.group_id = ag.group_id
        where ug.user_id = p_user_id
        group by ag.app_id
    ) g;
$$;

-- Von GoTrue bei jeder Token-Ausstellung aufgerufen (GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_*).
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    claims jsonb;
begin
    claims := coalesce(event->'claims', '{{}}'::jsonb);
    claims := jsonb_set(claims, '{{apps}}', public.effective_apps((event->>'user_id')::uuid), true);
    return jsonb_set(event, '{{claims}}', claims, true);
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
revoke execute on function public.effective_apps(uuid) from authenticated, anon, public;

-- Helfer für RLS und Policies: Level des aktuellen Nutzers für eine App.
-- Plattform-Admins ('platform' = 'admin') haben überall 'admin'.
create or replace function public.app_level(p_app text)
returns text
language sql
stable
as $$
    select case
        when coalesce(auth.jwt()->'apps'->>'platform', '') = 'admin' then 'admin'
        else auth.jwt()->'apps'->>p_app
    end;
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
as $$
    select coalesce(auth.jwt()->'apps'->>'platform', '') = 'admin';
$$;

grant execute on function public.app_level(text), public.is_platform_admin() to authenticated, anon;

-- RLS
alter table public.apps        enable row level security;
alter table public.groups      enable row level security;
alter table public.user_groups enable row level security;
alter table public.app_grants  enable row level security;

grant select on public.apps to authenticated;
grant select, insert, update, delete on public.groups, public.user_groups, public.app_grants to authenticated;

create policy apps_read on public.apps
    for select to authenticated using (true);

create policy groups_read on public.groups
    for select to authenticated
    using (public.is_platform_admin()
           or exists (select 1 from public.user_groups ug where ug.group_id = id and ug.user_id = auth.uid()));
create policy groups_admin on public.groups
    for all to authenticated
    using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy user_groups_read on public.user_groups
    for select to authenticated
    using (public.is_platform_admin() or user_id = auth.uid());
create policy user_groups_admin on public.user_groups
    for all to authenticated
    using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy app_grants_read on public.app_grants
    for select to authenticated
    using (public.is_platform_admin()
           or exists (select 1 from public.user_groups ug where ug.group_id = group_id and ug.user_id = auth.uid()));
create policy app_grants_admin on public.app_grants
    for all to authenticated
    using (public.is_platform_admin()) with check (public.is_platform_admin());

-- Seed: Launcher-Apps (aus lumeapps LauncherPage) und die Admin-Gruppe.
insert into public.apps (id, name, path, icon, sort) values
    ('platform',   'Plattform-Verwaltung', '/platform',   'shield',        0),
    ('kpi',        'KPI-Dashboard',        '/kpi',        'bar-chart-3',   10),
    ('newsletter', 'Newsletter',           '/newsletter', 'newspaper',     20),
    ('hr',         'HR',                   '/hr',         'users',         30),
    ('production', 'Produktion',           '/production', 'factory',       40),
    ('quality',    'Qualität',             '/quality',    'badge-check',   50),
    ('sensors',    'Sensoren',             '/sensors',    'thermometer',   60),
    ('atr',        'ATR',                  '/atr',        'scale',         70),
    ('fair',       'FAIR',                 '/fair',       'tent',          80),
    ('uploads',    'Uploads',              '/uploads',    'upload',        90),
    ('settings',   'Einstellungen',        '/settings',   'settings',      100);

insert into public.groups (name, source) values ('Plattform-Admins', 'manual');
insert into public.app_grants (group_id, app_id, level)
select id, 'platform', 'admin' from public.groups where name = 'Plattform-Admins';
"""

DOWNGRADE = """
drop policy if exists app_grants_admin on public.app_grants;
drop policy if exists app_grants_read on public.app_grants;
drop policy if exists user_groups_admin on public.user_groups;
drop policy if exists user_groups_read on public.user_groups;
drop policy if exists groups_admin on public.groups;
drop policy if exists groups_read on public.groups;
drop policy if exists apps_read on public.apps;
drop function if exists public.is_platform_admin();
drop function if exists public.app_level(text);
drop function if exists public.custom_access_token_hook(jsonb);
drop function if exists public.effective_apps(uuid);
drop table if exists public.app_grants;
drop table if exists public.user_groups;
drop table if exists public.groups;
drop table if exists public.apps;
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
