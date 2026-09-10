"""Einarbeitung: Katalog, Abteilungsmatrix — und das Firmenlogo für die Formblätter.

Revision ID: 0032_einarbeitung
Revises: 0031_onboarding
Create Date: 2026-09-11

Ein Einarbeitungsinhalt gehört einem Ansprechpartner, nicht einer Abteilung;
welche Inhalte eine Abteilung braucht, sagt eine Matrix. Daraus entsteht der
persönliche Einarbeitungsbogen.

**Nur Rasterformate für das Logo.** Im Altprojekt darf es PNG oder SVG sein,
und der SVG-Weg braucht eine eigene Reinigung (`nh3`), weil eine SVG-Datei
Skripte tragen kann. Gebraucht wird es aber nur in den erzeugten Formblättern,
und dort kann openpyxl ohnehin kein SVG einbetten — die dortige Doku sagt
selbst „für die Dokumente ein PNG hochladen". Also gilt hier: PNG oder JPEG.
Damit entfällt die Reinigung, weil der Fall entfällt.
"""
from alembic import op

revision = "0032_einarbeitung"
down_revision = "0031_onboarding"
branch_labels = None
depends_on = None

UPGRADE = """
create table public.einarbeitung_katalog (
    id              uuid primary key default gen_random_uuid(),
    inhalt          text not null,
    -- Wer sie durchführt. Freitext, auch Externe.
    ansprechpartner text,
    -- Erscheint im Bogen als „Abteilung". Leer heißt: die Abteilung aus der
    -- Matrix einsetzen.
    bereich         text,
    reihenfolge     integer not null default 0,
    erstellt_am     timestamptz not null default now()
);

create table public.einarbeitung_pflicht (
    id              uuid primary key default gen_random_uuid(),
    einarbeitung_id uuid not null
                    references public.einarbeitung_katalog(id) on delete cascade,
    abteilung       varchar(120) not null,
    constraint einarbeitung_pflicht_eindeutig unique (einarbeitung_id, abteilung)
);

create index einarbeitung_pflicht_abteilung on public.einarbeitung_pflicht (abteilung);

-- ---------------------------------------------------------------------------
-- Das Firmenlogo. Eine Zeile, ein Bild — es steht auf jedem erzeugten
-- Formblatt.
-- ---------------------------------------------------------------------------
create table public.plattform_logo (
    id           boolean primary key default true check (id),
    pfad         text,
    dateiname    text,
    -- Nur Raster: openpyxl kann kein SVG einbetten, und ein SVG müsste
    -- gereinigt werden, weil es Skripte tragen kann.
    mime         varchar(64) check (mime in ('image/png', 'image/jpeg')),
    geaendert_am timestamptz not null default now()
);

insert into public.plattform_logo (id) values (true);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('plattform', 'plattform', false, 5242880,
        array['image/png', 'image/jpeg'])
on conflict (id) do nothing;

create policy plattform_datei_hoch on storage.objects
    for insert to authenticated
    with check (
        bucket_id = 'plattform'
        and public.app_mindestens('platform', 'admin')
        and (storage.foldername(name))[1] = auth.uid()::text
    );
create policy plattform_datei_lesen on storage.objects
    for select to authenticated using (bucket_id = 'plattform');
create policy plattform_datei_weg on storage.objects
    for delete to authenticated
    using (bucket_id = 'plattform' and public.app_mindestens('platform', 'admin'));

alter table public.einarbeitung_katalog enable row level security;
alter table public.einarbeitung_pflicht enable row level security;
alter table public.plattform_logo enable row level security;

grant select on public.einarbeitung_katalog, public.einarbeitung_pflicht,
                public.plattform_logo to authenticated;
grant insert, update, delete on public.einarbeitung_katalog,
                public.einarbeitung_pflicht to authenticated;
grant update on public.plattform_logo to authenticated;

create policy einarbeitung_katalog_lesen on public.einarbeitung_katalog
    for select to authenticated using (public.app_level('hr') is not null);
create policy einarbeitung_katalog_pflegen on public.einarbeitung_katalog
    for all to authenticated
    using (public.app_mindestens('hr', 'editor'))
    with check (public.app_mindestens('hr', 'editor'));
create policy einarbeitung_pflicht_lesen on public.einarbeitung_pflicht
    for select to authenticated using (public.app_level('hr') is not null);
create policy einarbeitung_pflicht_pflegen on public.einarbeitung_pflicht
    for all to authenticated
    using (public.app_mindestens('hr', 'editor'))
    with check (public.app_mindestens('hr', 'editor'));

-- Das Logo sieht jeder Angemeldete (es steht auf jedem Formblatt); ändern darf
-- es die Plattform-Verwaltung.
create policy plattform_logo_lesen on public.plattform_logo
    for select to authenticated using (true);
create policy plattform_logo_pflegen on public.plattform_logo
    for update to authenticated
    using (public.app_mindestens('platform', 'admin'))
    with check (public.app_mindestens('platform', 'admin'));
"""

DOWNGRADE = """
drop policy if exists plattform_datei_weg on storage.objects;
drop policy if exists plattform_datei_lesen on storage.objects;
drop policy if exists plattform_datei_hoch on storage.objects;
delete from storage.buckets where id = 'plattform';
drop table if exists public.plattform_logo;
drop table if exists public.einarbeitung_pflicht;
drop table if exists public.einarbeitung_katalog;
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
