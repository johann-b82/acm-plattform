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

-- Nur die Spalten, auf die die Plattform zugreift. Weicht die echte Tabelle
-- ab, fällt es hier auf, statt erst in Produktion.
create table auth.users (
    id              uuid primary key default gen_random_uuid(),
    email           text,
    created_at      timestamptz default now(),
    last_sign_in_at timestamptz
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

-- ---------------------------------------------------------------------------
-- Schema `storage`, so weit die Migrationen es beruehren (ab 0019_feedback).
-- In einer echten Instanz legt der Storage-Dienst das selbst an; hier steht
-- nur, worauf die Migrationen und die Policy-Tests zugreifen.
-- ---------------------------------------------------------------------------
create role supabase_storage_admin nologin noinherit;

create schema if not exists storage authorization supabase_storage_admin;
grant usage on schema storage to anon, authenticated;

create table storage.buckets (
    id                 text primary key,
    name               text not null,
    public             boolean not null default false,
    file_size_limit    bigint,
    allowed_mime_types text[],
    created_at         timestamptz not null default now()
);

create table storage.objects (
    id         uuid primary key default gen_random_uuid(),
    bucket_id  text references storage.buckets (id),
    name       text,
    owner      uuid,
    metadata   jsonb,
    created_at timestamptz not null default now()
);

-- Wie im Original: der Pfad ohne den Dateinamen. Aus `<kennung>/bild.png`
-- wird `{<kennung>}`, sodass `[1]` den Ordner nennt.
create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
as $$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1];
$$;

alter table storage.objects enable row level security;

grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.buckets to authenticated;
grant execute on function storage.foldername(text) to anon, authenticated;

-- Der echte Speicher verbietet ein direktes `delete` auf `storage.objects`;
-- geloescht wird ueber den Dienst, der auch die Datei wegraeumt. Ohne diesen
-- Waechter wuerde ein Test durchlaufen, den die echte Instanz abweist.
create or replace function storage.protect_delete()
returns trigger
language plpgsql
as $$
begin
    if coalesce(current_setting('storage.allow_delete_query', true), 'false') <> 'true' then
        raise exception 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'
            using hint = 'This prevents accidental data loss from orphaned objects.',
                  errcode = '42501';
    end if;
    return null;
end;
$$;

create trigger protect_objects_delete
    before delete on storage.objects
    for each statement execute function storage.protect_delete();

-- ---------------------------------------------------------------------------
-- Schema `realtime`, so weit die Migrationen es beruehren (ab
-- 0057_realtime_konfliktschutz). In einer echten Instanz legt der
-- Realtime-Dienst das an (gepinnt: supabase/realtime v2.102.3); Spalten,
-- `topic()` und `send(jsonb, …)` sind dem Original nachgebildet. Der Dienst
-- prueft die Rechte eines Kanals, indem er mit gesetztem `realtime.topic`
-- aus `realtime.messages` liest (empfangen) bzw. hineinschreibt (Presence) —
-- genau das koennen die Tests hier nachstellen.
-- ---------------------------------------------------------------------------
create role supabase_realtime_admin nologin noinherit;

create schema if not exists realtime authorization supabase_realtime_admin;
grant usage on schema realtime to anon, authenticated;

create table realtime.messages (
    topic          text not null,
    extension      text not null,
    payload        jsonb,
    event          text,
    private        boolean default false,
    updated_at     timestamp not null default now(),
    inserted_at    timestamp not null default now(),
    id             uuid not null default gen_random_uuid(),
    binary_payload bytea
);

alter table realtime.messages enable row level security;
grant select, insert, update on realtime.messages to anon, authenticated;

create or replace function realtime.topic()
returns text
language sql
stable
as $$
    select nullif(current_setting('realtime.topic', true), '')::text;
$$;

create or replace function realtime.send(payload jsonb, event text, topic text, private boolean default true)
returns void
language plpgsql
as $$
declare
    generated_id uuid;
    final_payload jsonb;
begin
    begin
        generated_id := gen_random_uuid();
        if payload ? 'id' then
            final_payload := payload;
        else
            final_payload := jsonb_set(payload, '{id}', to_jsonb(generated_id));
        end if;
        execute format('set local realtime.topic to %L', topic);
        insert into realtime.messages (id, payload, event, topic, private, extension)
        values (generated_id, final_payload, event, topic, private, 'broadcast');
    exception
        when others then
            raise warning 'ErrorSendingBroadcastMessage: %', sqlerrm;
    end;
end;
$$;

grant execute on function realtime.topic() to anon, authenticated;
