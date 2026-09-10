"""Audit: Planung, Phasen-Checkliste und ein Verlauf, der wirklich hält.

Revision ID: 0028_audit
Revises: 0027_wartung
Create Date: 2026-09-10

Ein Audit wird geplant, läuft seine Phasen durch und wird formal
abgeschlossen. Dazu die Normmatrix als Stammdaten und Vorlagen für die
Phasenfolge.

Drei Dinge stehen hier bewusst anders als im Altprojekt — alle drei sind dort
als offen dokumentiert:

**Der Verlauf ist nicht mehr nur „nach Absprache" unveränderlich.** Im
Altprojekt schreibt ausschließlich ein Service in die Tabelle, und der
Router bietet kein UPDATE an; wer aber Tabellenrechte hat, kann trotzdem
ändern. Hier ist das Recht selbst entzogen: `authenticated` darf `insert`
und `select`, mehr nicht, und ein Trigger weist `update` und `delete`
zusätzlich ab. Was drinsteht, bleibt drin.

**Der Verlauf weiß jetzt, wer gehandelt hat.** Im Altprojekt trägt das Token
nur eine UUID; eine E-Mail hineinzuschreiben hätte eine Identität erfunden.
Hier stehen `auth.uid()` und die echte Adresse aus dem Token in der Zeile,
gesetzt vom Trigger — nicht vom Aufrufer.

**Geschrieben wird der Verlauf von der Datenbank, nicht von der Anwendung.**
Ein Trigger an `audits` und `audit_phasen` hält jede Statusänderung fest.
Damit kann kein Weg an ihm vorbeiführen — auch nicht der über PostgREST, den
es im Altprojekt noch nicht gab.

Und wie dort: **„überfällig" ist kein gespeicherter Status.** Es ist eine
Funktion des Datums und würde in dem Moment schal, in dem ein Tag ohne
Schreibvorgang vergeht. Die Sicht `audit_stand` rechnet es beim Lesen aus.
"""
from alembic import op

revision = "0028_audit"
down_revision = "0027_wartung"
branch_labels = None
depends_on = None

UPGRADE = """
-- ---------------------------------------------------------------------------
-- Stammdaten: die Normmatrix.
-- ---------------------------------------------------------------------------
create table public.audit_normen (
    id           uuid primary key default gen_random_uuid(),
    regelwerk    varchar(120) not null,
    revision     varchar(60) not null default '',
    klausel      varchar(60) not null,
    kurztext     text not null default '',
    gueltig_ab   date,
    gueltig_bis  date,
    -- Bleibt falsch, bis ein Mensch die Klausel gegen den konsolidierten Text
    -- geprüft hat. Die mitgelieferten Zeilen starten ungeprüft.
    geprueft     boolean not null default false,
    aktiv        boolean not null default true,
    erstellt_am  timestamptz not null default now(),
    geaendert_am timestamptz not null default now(),
    constraint audit_normen_eindeutig unique (regelwerk, revision, klausel)
);

create index audit_normen_regelwerk on public.audit_normen (regelwerk);

-- ---------------------------------------------------------------------------
-- Vorlagen für die Phasenfolge.
-- ---------------------------------------------------------------------------
create table public.audit_vorlagen (
    id           uuid primary key default gen_random_uuid(),
    name         varchar(255) not null,
    -- Leer heißt: passt zu jeder Art von Audit.
    kategorie    varchar(16) check (kategorie in ('system', 'prozess', 'produkt', 'lieferant')),
    beschreibung text not null default '',
    aktiv        boolean not null default true,
    erstellt_am  timestamptz not null default now(),
    geaendert_am timestamptz not null default now()
);

create table public.audit_vorlage_schritte (
    id           uuid primary key default gen_random_uuid(),
    vorlage_id   uuid not null references public.audit_vorlagen(id) on delete cascade,
    position     integer not null,
    titel        varchar(255) not null,
    beschreibung text not null default '',
    -- Eine Pflichtphase lässt sich nicht ohne Begründung überspringen.
    pflicht      boolean not null default true,
    constraint audit_vorlage_schritte_position unique (vorlage_id, position)
);

create index audit_vorlage_schritte_vorlage
    on public.audit_vorlage_schritte (vorlage_id, position);

-- ---------------------------------------------------------------------------
-- Das Audit selbst.
-- ---------------------------------------------------------------------------
create table public.audits (
    id                uuid primary key default gen_random_uuid(),
    nummer            varchar(64) not null unique,
    titel             varchar(255) not null,
    art               varchar(16) not null check (art in ('intern', 'extern')),
    bereich           varchar(255) not null default '',
    ziel              text not null default '',
    leitender_auditor varchar(255),
    team              text not null default '',
    geplant_von       date,
    geplant_bis       date,
    -- 1 = niedrig, 2 = mittel, 3 = hoch.
    prioritaet        integer not null default 2 check (prioritaet between 1 and 3),
    status            varchar(24) not null default 'geplant'
                      check (status in ('geplant', 'in_vorbereitung', 'in_durchfuehrung',
                                        'berichtet', 'massnahmen_offen', 'abgeschlossen',
                                        'verschoben', 'abgesagt')),
    -- Woher die Phasen kamen. Nur als Nachweis: sie werden beim Anlegen
    -- kopiert, eine spätere Änderung an der Vorlage schreibt keine Historie um.
    vorlage_id        uuid references public.audit_vorlagen(id) on delete set null,
    erstellt_am       timestamptz not null default now(),
    geaendert_am      timestamptz not null default now(),
    constraint audits_zeitraum check (
        geplant_bis is null or geplant_von is null or geplant_bis >= geplant_von
    )
);

create index audits_status on public.audits (status);
create index audits_beginn on public.audits (geplant_von);

-- Ein Audit ist oft mehreres zugleich — das interne Programm fährt Prozess-
-- und Produktaudit in derselben Sitzung. Deshalb eine Menge, keine Spalte.
create table public.audit_kategorien (
    audit_id  uuid not null references public.audits(id) on delete cascade,
    kategorie varchar(16) not null
              check (kategorie in ('system', 'prozess', 'produkt', 'lieferant')),
    primary key (audit_id, kategorie)
);

create table public.audit_normbezug (
    audit_id uuid not null references public.audits(id) on delete cascade,
    -- `restrict`: eine benutzte Norm wird stillgelegt, nicht gelöscht — sonst
    -- verlöre ein Audit still seine Grundlage.
    norm_id  uuid not null references public.audit_normen(id) on delete restrict,
    primary key (audit_id, norm_id)
);

create table public.audit_phasen (
    id                   uuid primary key default gen_random_uuid(),
    audit_id             uuid not null references public.audits(id) on delete cascade,
    position             integer not null,
    titel                varchar(255) not null,
    beschreibung         text not null default '',
    pflicht              boolean not null default true,
    status               varchar(20) not null default 'offen'
                         check (status in ('offen', 'in_arbeit', 'erledigt', 'nicht_zutreffend')),
    verantwortlich       varchar(255),
    faellig_am           date,
    erledigt_am          date,
    kommentar            text not null default '',
    uebersprungen_warum  text,
    erstellt_am          timestamptz not null default now(),
    geaendert_am         timestamptz not null default now(),
    constraint audit_phasen_position unique (audit_id, position),
    -- Kein Überspringen einer Pflichtphase ohne Begründung.
    constraint audit_phasen_grund check (
        status <> 'nicht_zutreffend' or pflicht is false
        or (uebersprungen_warum is not null and length(btrim(uebersprungen_warum)) > 0)
    ),
    -- Erledigt ohne Ist-Termin wäre eine Behauptung ohne Datum.
    constraint audit_phasen_erledigt check (
        status <> 'erledigt' or erledigt_am is not null
    )
);

create index audit_phasen_audit on public.audit_phasen (audit_id, position);
create index audit_phasen_faellig on public.audit_phasen (faellig_am);

-- ---------------------------------------------------------------------------
-- Der Verlauf. Anfügen ja, ändern nie.
-- ---------------------------------------------------------------------------
create table public.audit_verlauf (
    id           bigint generated always as identity primary key,
    -- Ohne Fremdschlüssel: der Verlauf muss die Zeile überleben, die er
    -- beschreibt. Leer bei Stammdaten, die zu keinem Audit gehören.
    audit_id     uuid,
    entitaet     varchar(40) not null,
    entitaet_id  uuid not null,
    aktion       varchar(20) not null
                 check (aktion in ('angelegt', 'geaendert', 'geloescht',
                                   'status', 'uebersprungen')),
    feld         varchar(60),
    alt          text,
    neu          text,
    grund        text,
    -- Wer. Anders als im Altprojekt steht hier eine echte Adresse: sie kommt
    -- aus dem Token, nicht aus einer erfundenen Zuordnung.
    wer          uuid,
    wer_email    text,
    wann         timestamptz not null default now()
);

create index audit_verlauf_audit on public.audit_verlauf (audit_id, wann desc);
create index audit_verlauf_entitaet on public.audit_verlauf (entitaet, entitaet_id);

-- Anfügen ist erlaubt, Ändern und Löschen nicht. Das Recht ist entzogen; der
-- Trigger fängt zusätzlich ab, was über eine Rolle mit mehr Rechten käme.
create or replace function public.audit_verlauf_ist_fest()
returns trigger
language plpgsql
as $$
begin
    raise exception 'Der Audit-Verlauf lässt sich nicht ändern oder löschen.';
end;
$$;

create trigger audit_verlauf_fest
    before update or delete on public.audit_verlauf
    for each row execute function public.audit_verlauf_ist_fest();

-- ---------------------------------------------------------------------------
-- Der Verlauf schreibt sich selbst.
-- ---------------------------------------------------------------------------
create or replace function public.audit_notieren()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    wer_id    uuid  := nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid;
    wer_mail  text  := nullif(current_setting('request.jwt.claims', true)::json->>'email', '');
    das_audit uuid;
    der_grund text;
begin
    -- Mit `if`, nicht mit `case`: plpgsql löst die Feldverweise eines
    -- Ausdrucks vorab auf, und `new.audit_id` gibt es an `audits` nicht.
    -- Aus demselben Grund je Zweig getrennt nach `new` und `old` gegriffen.
    if tg_table_name = 'audits' then
        if tg_op = 'DELETE' then das_audit := old.id; else das_audit := new.id; end if;
    else
        if tg_op = 'DELETE' then das_audit := old.audit_id; else das_audit := new.audit_id; end if;
    end if;

    if tg_op = 'INSERT' then
        insert into public.audit_verlauf
            (audit_id, entitaet, entitaet_id, aktion, wer, wer_email)
        values (das_audit, tg_table_name, new.id, 'angelegt', wer_id, wer_mail);
        return new;
    end if;

    if tg_op = 'DELETE' then
        insert into public.audit_verlauf
            (audit_id, entitaet, entitaet_id, aktion, wer, wer_email)
        values (das_audit, tg_table_name, old.id, 'geloescht', wer_id, wer_mail);
        return old;
    end if;

    -- Nur der Status wird Feld für Feld festgehalten. Alles andere als
    -- „geändert" — ein Verlauf, der jede Tippkorrektur aufzählt, wird nicht
    -- gelesen.
    if new.status is distinct from old.status then
        -- Auch hier getrennt: `new.uebersprungen_warum` gibt es an `audits`
        -- nicht, und plpgsql löst die Feldverweise vorab auf.
        der_grund := null;
        if tg_table_name = 'audit_phasen' and new.status = 'nicht_zutreffend' then
            der_grund := new.uebersprungen_warum;
        end if;
        insert into public.audit_verlauf
            (audit_id, entitaet, entitaet_id, aktion, feld, alt, neu, grund, wer, wer_email)
        values (das_audit, tg_table_name, new.id, 'status', 'status',
                old.status, new.status, der_grund, wer_id, wer_mail);
    elsif to_jsonb(new) - 'geaendert_am' is distinct from to_jsonb(old) - 'geaendert_am' then
        insert into public.audit_verlauf
            (audit_id, entitaet, entitaet_id, aktion, wer, wer_email)
        values (das_audit, tg_table_name, new.id, 'geaendert', wer_id, wer_mail);
    end if;
    return new;
end;
$$;

create trigger audits_notieren
    after insert or update or delete on public.audits
    for each row execute function public.audit_notieren();
create trigger audit_phasen_notieren
    after insert or update or delete on public.audit_phasen
    for each row execute function public.audit_notieren();

-- ---------------------------------------------------------------------------
-- Die Phasen entstehen beim Anlegen aus der Vorlage — in der Datenbank, damit
-- auch ein Anlegen über PostgREST sie bekommt.
-- ---------------------------------------------------------------------------
create or replace function public.audit_phasen_aus_vorlage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.vorlage_id is null then
        return new;
    end if;
    insert into public.audit_phasen
        (audit_id, position, titel, beschreibung, pflicht)
    select new.id, s.position, s.titel, s.beschreibung, s.pflicht
      from public.audit_vorlage_schritte s
     where s.vorlage_id = new.vorlage_id
     order by s.position;
    return new;
end;
$$;

create trigger audits_phasen_anlegen
    after insert on public.audits
    for each row execute function public.audit_phasen_aus_vorlage();

create or replace function public.audit_beruehrt()
returns trigger
language plpgsql
as $$
begin
    new.geaendert_am := now();
    return new;
end;
$$;

create trigger audits_beruehrt before update on public.audits
    for each row execute function public.audit_beruehrt();
create trigger audit_phasen_beruehrt before update on public.audit_phasen
    for each row execute function public.audit_beruehrt();
create trigger audit_normen_beruehrt before update on public.audit_normen
    for each row execute function public.audit_beruehrt();
create trigger audit_vorlagen_beruehrt before update on public.audit_vorlagen
    for each row execute function public.audit_beruehrt();

-- ---------------------------------------------------------------------------
-- Der Stand je Audit. „Überfällig" wird gerechnet, nicht gespeichert.
-- ---------------------------------------------------------------------------
create view public.audit_stand
with (security_invoker = true) as
select a.id                                                    as audit_id,
       count(p.*)                                              as phasen,
       count(p.*) filter (where p.status = 'erledigt')          as erledigt,
       count(p.*) filter (where p.status = 'nicht_zutreffend')  as entfaellt,
       count(p.*) filter (
           where p.status not in ('erledigt', 'nicht_zutreffend')
             and p.faellig_am is not null
             and p.faellig_am < current_date
       )                                                        as ueberfaellig,
       min(p.faellig_am) filter (
           where p.status not in ('erledigt', 'nicht_zutreffend')
       )                                                        as naechster_termin
from public.audits a
left join public.audit_phasen p on p.audit_id = a.id
group by a.id;

-- ---------------------------------------------------------------------------
-- Rechte. Sehen mit `quality`, pflegen ab `quality: editor`.
-- ---------------------------------------------------------------------------
alter table public.audit_normen enable row level security;
alter table public.audit_vorlagen enable row level security;
alter table public.audit_vorlage_schritte enable row level security;
alter table public.audits enable row level security;
alter table public.audit_kategorien enable row level security;
alter table public.audit_normbezug enable row level security;
alter table public.audit_phasen enable row level security;
alter table public.audit_verlauf enable row level security;

grant select on public.audit_normen, public.audit_vorlagen,
                public.audit_vorlage_schritte, public.audits,
                public.audit_kategorien, public.audit_normbezug,
                public.audit_phasen, public.audit_stand to authenticated;
grant insert, update, delete on public.audit_normen, public.audit_vorlagen,
                public.audit_vorlage_schritte, public.audits,
                public.audit_kategorien, public.audit_normbezug,
                public.audit_phasen to authenticated;
-- Der Verlauf: lesen und anfügen. Kein `update`, kein `delete`.
grant select, insert on public.audit_verlauf to authenticated;

do $$
declare
    t text;
begin
    foreach t in array array['audit_normen', 'audit_vorlagen', 'audit_vorlage_schritte',
                             'audits', 'audit_kategorien', 'audit_normbezug', 'audit_phasen']
    loop
        execute format(
            'create policy %I on public.%I for select to authenticated '
            'using (public.app_level(''quality'') is not null)', t || '_lesen', t);
        execute format(
            'create policy %I on public.%I for all to authenticated '
            'using (public.app_mindestens(''quality'', ''editor'')) '
            'with check (public.app_mindestens(''quality'', ''editor''))',
            t || '_pflegen', t);
    end loop;
end;
$$;

create policy audit_verlauf_lesen on public.audit_verlauf
    for select to authenticated using (public.app_level('quality') is not null);
create policy audit_verlauf_anfuegen on public.audit_verlauf
    for insert to authenticated with check (public.app_mindestens('quality', 'editor'));

-- Die Kachel zeigt auf die Seite, die es jetzt gibt.
update public.apps set path = '/qualitaet' where id = 'quality';
"""

DOWNGRADE = """
update public.apps set path = '/quality' where id = 'quality';

drop view if exists public.audit_stand;
drop table if exists public.audit_verlauf;
drop table if exists public.audit_phasen;
drop table if exists public.audit_normbezug;
drop table if exists public.audit_kategorien;
drop table if exists public.audits;
drop table if exists public.audit_vorlage_schritte;
drop table if exists public.audit_vorlagen;
drop table if exists public.audit_normen;
drop function if exists public.audit_phasen_aus_vorlage();
drop function if exists public.audit_notieren();
drop function if exists public.audit_verlauf_ist_fest();
drop function if exists public.audit_beruehrt();
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
