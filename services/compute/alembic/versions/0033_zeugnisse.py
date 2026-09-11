"""Zeugnisse: Stammdaten, Bewertung, Textbausteine und das fertige Dokument.

Revision ID: 0033_zeugnisse
Revises: 0032_einarbeitung
Create Date: 2026-09-11

Ein Arbeitszeugnis aus Noten und Freitexten, gesetzt auf der echten
ACM-Briefvorlage.

**Die Stammdaten werden eingefroren.** Ein Zeugnis, das im Mai ausgestellt
wurde, darf im September nicht anders aussehen, weil sich in Personio eine
Abteilung geändert hat. Name, Tätigkeit, Abteilung und Zeiten stehen deshalb
als Abschrift in der Zeugniszeile — danach von Hand änderbar, aber nie
automatisch.

**Die Note ist eine Schulnote.** 1 bis 4 je Dimension, daraus der Durchschnitt,
daraus die verkehrsübliche Zufriedenheitsformel. Die Zuordnung steht im
Baukasten, nicht in der Datenbank — sie ist Sprache, keine Konfiguration. Die
**Textbausteine** dagegen stehen hier und lassen sich pflegen; ohne Eintrag
greifen die Formulierungen aus dem Baukasten.

**Ein Zeugnis hängt an genau einer Person** — aus Personio oder aus der Liste
extern gepflegter Personen. Beides zugleich wäre eine widersprüchliche Zeile.
"""
from alembic import op

revision = "0033_zeugnisse"
down_revision = "0032_einarbeitung"
branch_labels = None
depends_on = None

UPGRADE = """
create table public.zeugnis_aussteller (
    id                   boolean primary key default true check (id),
    firma                text not null default '',
    standort             text,
    unterzeichner1_name  text,
    unterzeichner1_titel text,
    unterzeichner2_name  text,
    unterzeichner2_titel text,
    -- Die zweite Unterschrift kann auch eine Person aus Personio sein; Name
    -- und Titel werden dann beim Erzeugen aufgelöst.
    hr_employee_id       integer references public.personio_employees(id) on delete set null,
    geaendert_am         timestamptz not null default now()
);

insert into public.zeugnis_aussteller (id) values (true);

create table public.zeugnisse (
    id             uuid primary key default gen_random_uuid(),
    employee_id    integer references public.personio_employees(id) on delete set null,
    extern_id      uuid references public.externe_personen(id) on delete set null,

    -- Abschrift der Stammdaten, eingefroren beim Anlegen.
    name           text not null,
    -- Steuert Anrede und grammatische Formen im Text.
    geschlecht     varchar(1) check (geschlecht in ('m', 'w', 'd')),
    geburtsdatum   date,
    personalnummer text,
    abteilung      text,
    taetigkeit     text,
    eintritt       date,
    austritt       date,

    art            varchar(20) not null default 'qualifiziert'
                   check (art in ('qualifiziert', 'einfach', 'zwischenzeugnis',
                                  'ausbildungszeugnis', 'praktikumszeugnis')),
    anlass         text,
    fuehrungskraft boolean not null default false,
    ausstellungsdatum date,

    -- Eingang der Textbildung.
    taetigkeit_stichpunkte text,
    besondere_kompetenzen  text,
    besondere_erfolge      text,

    -- Ergebnis: die gerundete Durchschnittsnote und die fertigen Abschnitte.
    schlussnote    numeric(2, 1),
    abschnitte     jsonb,
    status         varchar(20) not null default 'entwurf'
                   check (status in ('entwurf', 'fertig')),
    erstellt_am    timestamptz not null default now(),
    geaendert_am   timestamptz not null default now(),

    constraint zeugnisse_eine_person check (
        num_nonnulls(employee_id, extern_id) <= 1
    )
);

create index zeugnisse_person on public.zeugnisse (employee_id);
create index zeugnisse_erstellt on public.zeugnisse (erstellt_am desc);

create table public.zeugnis_bewertungen (
    id         uuid primary key default gen_random_uuid(),
    zeugnis_id uuid not null references public.zeugnisse(id) on delete cascade,
    dimension  varchar(30) not null
               check (dimension in ('fachwissen', 'auffassungsgabe', 'arbeitsweise',
                                    'belastbarkeit', 'arbeitserfolg', 'sozialverhalten',
                                    'fuehrung')),
    -- Schulnote: 1 = sehr gut … 4 = ausreichend.
    note       integer not null check (note between 1 and 4),
    constraint zeugnis_bewertungen_eindeutig unique (zeugnis_id, dimension)
);

-- Ein benanntes Notenprofil zum Wiederverwenden.
create table public.zeugnis_notenvorlagen (
    id           uuid primary key default gen_random_uuid(),
    name         text not null unique,
    noten        jsonb not null,
    geaendert_am timestamptz not null default now()
);

-- Die pflegbaren Formulierungen. Ohne Eintrag greift der Baukasten.
create table public.zeugnis_bausteine (
    id           uuid primary key default gen_random_uuid(),
    dimension    varchar(30) not null,
    note         integer not null check (note between 1 and 4),
    text         text not null,
    geaendert_am timestamptz not null default now(),
    constraint zeugnis_bausteine_eindeutig unique (dimension, note)
);

alter table public.zeugnis_aussteller enable row level security;
alter table public.zeugnisse enable row level security;
alter table public.zeugnis_bewertungen enable row level security;
alter table public.zeugnis_notenvorlagen enable row level security;
alter table public.zeugnis_bausteine enable row level security;

grant select on public.zeugnis_aussteller, public.zeugnisse,
                public.zeugnis_bewertungen, public.zeugnis_notenvorlagen,
                public.zeugnis_bausteine to authenticated;
grant insert, update, delete on public.zeugnisse, public.zeugnis_bewertungen,
                public.zeugnis_notenvorlagen, public.zeugnis_bausteine to authenticated;
grant update on public.zeugnis_aussteller to authenticated;

-- Personenbezogene Leistungsdaten: sehen und pflegen ab `hr: editor`. Anders
-- als sonst gibt es hier keine reine Lesestufe — ein Zeugnisentwurf ist keine
-- Kennzahl.
do $$
declare
    t text;
begin
    foreach t in array array['zeugnisse', 'zeugnis_bewertungen',
                             'zeugnis_notenvorlagen', 'zeugnis_bausteine']
    loop
        execute format(
            'create policy %I on public.%I for all to authenticated '
            'using (public.app_mindestens(''hr'', ''editor'')) '
            'with check (public.app_mindestens(''hr'', ''editor''))',
            t || '_pflegen', t);
    end loop;
end;
$$;

create policy zeugnis_aussteller_lesen on public.zeugnis_aussteller
    for select to authenticated using (public.app_mindestens('hr', 'editor'));
create policy zeugnis_aussteller_pflegen on public.zeugnis_aussteller
    for update to authenticated
    using (public.app_mindestens('hr', 'editor'))
    with check (public.app_mindestens('hr', 'editor'));

create or replace function public.zeugnis_beruehrt()
returns trigger
language plpgsql
as $$
begin
    new.geaendert_am := now();
    return new;
end;
$$;

create trigger zeugnisse_beruehrt before update on public.zeugnisse
    for each row execute function public.zeugnis_beruehrt();
create trigger zeugnis_bausteine_beruehrt before update on public.zeugnis_bausteine
    for each row execute function public.zeugnis_beruehrt();
"""

DOWNGRADE = """
drop table if exists public.zeugnis_bausteine;
drop table if exists public.zeugnis_notenvorlagen;
drop table if exists public.zeugnis_bewertungen;
drop table if exists public.zeugnisse;
drop table if exists public.zeugnis_aussteller;
drop function if exists public.zeugnis_beruehrt();
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
