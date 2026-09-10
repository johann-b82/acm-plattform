"""Seiten-Feedback: melden, was auf einer Seite nicht stimmt.

Revision ID: 0019_feedback
Revises: 0018_kpi_bewertung
Create Date: 2026-09-10

Ein Knopf in jeder Ansicht: beschreiben, was nicht stimmt, und ein Bild der
Seite mitschicken. Zwei Dinge sind hier anders als im Altprojekt.

**Das Bild liegt im Speicher, nicht in der Zeile.** Im Altprojekt steckt der
Screenshot als `bytea` in der Tabelle; jede Liste, jede Sicherung und jeder
`pg_dump` schleppt ihn mit. Hier hält die Zeile nur den Pfad, die Bytes
liegen im Eimer `feedback` — dies ist der erste Verbraucher von Supabase
Storage im neuen Stack. Der Eimer ist nicht öffentlich: gelesen wird über
eine signierte, kurzlebige URL.

**Wer meldet, steht nicht im Formular.** Melder und E-Mail setzt ein Trigger
aus der Sitzung. Sonst wäre die Zuordnung eine Angabe des Aufrufers, und ein
Fehlerbericht ließe sich unter fremdem Namen einreichen.

Zum Recht: melden darf jede angemeldete Person — ein Fehlerbericht, den nur
Berechtigte schreiben dürfen, erreicht die Fehler nicht, die es zu finden
gilt. Lesen und bearbeiten darf die Plattform-Verwaltung; sie ist es, die
den Bericht abarbeitet.
"""
from alembic import op

revision = "0019_feedback"
down_revision = "0018_kpi_bewertung"
branch_labels = None
depends_on = None

UPGRADE = """
create table public.feedback (
    id           uuid primary key default gen_random_uuid(),
    -- Pfad der Seite, nicht die volle URL: der Host sagt nichts, und in einer
    -- Query-Zeichenkette koennen Daten stehen, die hier nichts verloren haben.
    seite        varchar(500) not null,
    beschreibung text not null check (btrim(beschreibung) <> ''),
    -- Objektname im Eimer `feedback`. NULL, wenn die Aufnahme misslang —
    -- ein Bericht ohne Bild ist besser als keiner.
    bild_pfad    text,
    browser      text,
    ansicht      varchar(32),
    status       varchar(16) not null default 'neu'
                 check (status in ('neu', 'erledigt')),
    gesehen_am   timestamptz,
    erstellt_am  timestamptz not null default now(),
    melder       uuid references auth.users (id) on delete set null,
    melder_email text
);

create index feedback_erstellt_idx on public.feedback (erstellt_am desc);
create index feedback_offen_idx on public.feedback (gesehen_am) where gesehen_am is null;

alter table public.feedback enable row level security;

grant select, insert, update, delete on public.feedback to authenticated;

-- Melden: jede angemeldete Person.
create policy feedback_insert on public.feedback
    for insert to authenticated with check (true);

-- Lesen und bearbeiten: die Plattform-Verwaltung.
create policy feedback_read on public.feedback
    for select to authenticated
    using (public.app_mindestens('platform', 'admin'));
create policy feedback_update on public.feedback
    for update to authenticated
    using (public.app_mindestens('platform', 'admin'))
    with check (public.app_mindestens('platform', 'admin'));
create policy feedback_delete on public.feedback
    for delete to authenticated
    using (public.app_mindestens('platform', 'admin'));

-- Melder und E-Mail kommen aus der Sitzung, nicht aus dem Formular.
create or replace function public.feedback_melder()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    new.melder := auth.uid();
    new.melder_email := auth.jwt() ->> 'email';
    return new;
end;
$$;

create trigger feedback_melder
    before insert on public.feedback
    for each row execute function public.feedback_melder();

-- ---------------------------------------------------------------------------
-- Der Eimer fuer die Bilder.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('feedback', 'feedback', false, 5242880,
        array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- Hochladen darf jede angemeldete Person, aber nur in den eigenen Ordner:
-- der erste Pfadabschnitt ist die eigene Kennung. Damit kann niemand ein
-- fremdes Bild ueberschreiben.
create policy feedback_bild_insert on storage.objects
    for insert to authenticated
    with check (
        bucket_id = 'feedback'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

-- Lesen und Loeschen: dieselbe Schranke wie fuer die Zeile. Wer hochlaedt,
-- liest sein Bild nicht zurueck — der Bericht geht an die Verwaltung.
create policy feedback_bild_read on storage.objects
    for select to authenticated
    using (
        bucket_id = 'feedback'
        and public.app_mindestens('platform', 'admin')
    );
create policy feedback_bild_delete on storage.objects
    for delete to authenticated
    using (
        bucket_id = 'feedback'
        and public.app_mindestens('platform', 'admin')
    );
"""

DOWNGRADE = """
drop policy if exists feedback_bild_delete on storage.objects;
drop policy if exists feedback_bild_read on storage.objects;
drop policy if exists feedback_bild_insert on storage.objects;
-- Eimer und Bilder bleiben stehen. Der Speicher verbietet ein direktes
-- `delete` auf `storage.objects` — geloescht wird ueber den Dienst, der auch
-- die Datei wegraeumt. Und eine zurueckgenommene Schemaaenderung ist kein
-- Grund, hochgeladene Dateien zu vernichten.
drop trigger if exists feedback_melder on public.feedback;
drop function if exists public.feedback_melder();
drop table if exists public.feedback;
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
