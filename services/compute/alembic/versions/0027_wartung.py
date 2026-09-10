"""Wartung: Maschinen, Wartungsaufgaben und der Nachweisbogen.

Revision ID: 0027_wartung
Revises: 0026_sensoren
Create Date: 2026-09-10

Eine Maschine, ihre wiederkehrenden Aufgaben und die Dateien dazu — der
Herstellerplan und die zurückgescannten, unterschriebenen Bögen.

**Das Intervall ist eine Regel, kein Termin.** Es gibt keine Tabelle mit
fälligen Terminen: der Bogen ist ein Raster über ein Halbjahr, und wer wartet,
zeichnet in der Spalte der Kalenderwoche ab. Das ist kein Rückschritt gegenüber
einer Terminverwaltung, sondern das, was in der Werkstatt an der Maschine
hängt. Alles Weitere wäre eine Terminliste, die niemand pflegt.

**`alle_n_wochen` braucht seine Zahl.** Eine Bedingung an der Tabelle sorgt
dafür, dass die Wochenzahl steht, wenn das Intervall sie verlangt — und dass
sie fehlt, wenn nicht. Im Altprojekt fehlt die zweite Hälfte, und eine
monatliche Aufgabe kann eine sinnlose „14" tragen.

**Die Dateien liegen im Eimer `wartung`**, nicht in einer Dateitabelle mit
Verweis auf Directus. Beim Löschen einer Maschine räumt die Kaskade die Zeilen;
die Dateien nimmt die Oberfläche mit, wie beim Newsletter.
"""
from alembic import op

revision = "0027_wartung"
down_revision = "0026_sensoren"
branch_labels = None
depends_on = None

UPGRADE = """
create table public.maschinen (
    id             uuid primary key default gen_random_uuid(),
    name           varchar(255) not null,
    inventarnummer varchar(64),
    standort       varchar(255),
    hersteller     varchar(255),
    modell         varchar(255),
    verantwortlich varchar(255),
    status         varchar(16) not null default 'aktiv'
                   check (status in ('aktiv', 'stillgelegt')),
    notizen        text not null default '',
    erstellt_am    timestamptz not null default now(),
    geaendert_am   timestamptz not null default now()
);

create index maschinen_name on public.maschinen (name);

create table public.wartungsaufgaben (
    id           uuid primary key default gen_random_uuid(),
    maschine_id  uuid not null references public.maschinen(id) on delete cascade,
    titel        varchar(255) not null,
    anleitung    text not null default '',
    intervall    varchar(16) not null
                 check (intervall in ('taeglich', 'woechentlich', 'monatlich',
                                      'quartalsweise', 'alle_n_wochen')),
    -- Nur bei `alle_n_wochen` — und dort verpflichtend. Im Altprojekt fehlt
    -- die zweite Haelfte dieser Bedingung.
    wochen       integer,
    erstellt_am  timestamptz not null default now(),
    geaendert_am timestamptz not null default now(),
    constraint wartungsaufgaben_wochen_passend check (
        (intervall = 'alle_n_wochen' and wochen is not null and wochen >= 1)
        or (intervall <> 'alle_n_wochen' and wochen is null)
    )
);

create index wartungsaufgaben_maschine
    on public.wartungsaufgaben (maschine_id, erstellt_am);

create table public.wartungsdateien (
    id            uuid primary key default gen_random_uuid(),
    maschine_id   uuid not null references public.maschinen(id) on delete cascade,
    -- `plan` ist der Herstellerplan, `nachweis` ein zurueckgescannter,
    -- unterschriebener Bogen.
    art           varchar(16) not null default 'plan'
                  check (art in ('plan', 'nachweis')),
    pfad          text not null unique,
    dateiname     varchar(255) not null,
    mime          varchar(127),
    hochgeladen_am timestamptz not null default now()
);

create index wartungsdateien_maschine
    on public.wartungsdateien (maschine_id, hochgeladen_am desc);

create or replace function public.wartung_beruehrt()
returns trigger
language plpgsql
as $$
begin
    new.geaendert_am := now();
    return new;
end;
$$;

create trigger maschinen_beruehrt before update on public.maschinen
    for each row execute function public.wartung_beruehrt();
create trigger wartungsaufgaben_beruehrt before update on public.wartungsaufgaben
    for each row execute function public.wartung_beruehrt();

alter table public.maschinen enable row level security;
alter table public.wartungsaufgaben enable row level security;
alter table public.wartungsdateien enable row level security;

grant select on public.maschinen to authenticated;
grant select on public.wartungsaufgaben to authenticated;
grant select on public.wartungsdateien to authenticated;
grant insert, update, delete on public.maschinen to authenticated;
grant insert, update, delete on public.wartungsaufgaben to authenticated;
grant insert, delete on public.wartungsdateien to authenticated;

create policy maschinen_lesen on public.maschinen
    for select to authenticated using (public.app_level('production') is not null);
create policy maschinen_pflegen on public.maschinen
    for all to authenticated
    using (public.app_mindestens('production', 'editor'))
    with check (public.app_mindestens('production', 'editor'));

create policy wartungsaufgaben_lesen on public.wartungsaufgaben
    for select to authenticated using (public.app_level('production') is not null);
create policy wartungsaufgaben_pflegen on public.wartungsaufgaben
    for all to authenticated
    using (public.app_mindestens('production', 'editor'))
    with check (public.app_mindestens('production', 'editor'));

create policy wartungsdateien_lesen on public.wartungsdateien
    for select to authenticated using (public.app_level('production') is not null);
create policy wartungsdateien_pflegen on public.wartungsdateien
    for all to authenticated
    using (public.app_mindestens('production', 'editor'))
    with check (public.app_mindestens('production', 'editor'));

-- ---------------------------------------------------------------------------
-- Der Eimer fuer Herstellerplaene und zurueckgescannte Nachweise.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wartung', 'wartung', false, 26214400,
        array['application/pdf', 'image/png', 'image/jpeg',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do nothing;

create policy wartung_datei_hoch on storage.objects
    for insert to authenticated
    with check (
        bucket_id = 'wartung'
        and public.app_mindestens('production', 'editor')
        and (storage.foldername(name))[1] = auth.uid()::text
    );

create policy wartung_datei_lesen on storage.objects
    for select to authenticated
    using (bucket_id = 'wartung' and public.app_level('production') is not null);

create policy wartung_datei_weg on storage.objects
    for delete to authenticated
    using (bucket_id = 'wartung' and public.app_mindestens('production', 'editor'));

-- Die Kachel zeigt auf die Seite, die es jetzt gibt.
update public.apps set path = '/produktion' where id = 'production';
"""

DOWNGRADE = """
update public.apps set path = '/production' where id = 'production';

drop policy if exists wartung_datei_weg on storage.objects;
drop policy if exists wartung_datei_lesen on storage.objects;
drop policy if exists wartung_datei_hoch on storage.objects;
delete from storage.buckets where id = 'wartung';

drop table if exists public.wartungsdateien;
drop table if exists public.wartungsaufgaben;
drop table if exists public.maschinen;
drop function if exists public.wartung_beruehrt();
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
