"""ATR: Lieferungen und ihre Positionen.

Revision ID: 0023_atr_lieferungen
Revises: 0022_atr_katalog
Create Date: 2026-09-10

Zweiter Teil des ATR-Moduls. Ein eingelesener Lieferschein wird zur
**Lieferung**; ihre Positionen sind die Zeilen, aus denen später das
ATR-Dokument entsteht.

**Eine Position steht auf eigenen Füßen.** Sie trägt Bezeichnung, Zeichnung
und Gewicht selbst, auch wenn sie einem Katalogteil zugeordnet ist. Das ist
Absicht: der Katalog ändert sich, ein freigegebener ATR nicht. Wird ein Teil
später umbenannt oder neu gewogen, bleibt die Lieferung, wie sie freigegeben
wurde — und der Fremdschlüssel auf das Katalogteil steht auf
`on delete set null`, damit ein aufgeräumter Katalog keine Lieferung mitreißt.

**Zwei Zustände, nicht mehr.** Ein Entwurf wartet auf Durchsicht, eine
freigegebene Lieferung ist fertig. Im Altprojekt gibt es dazu einen
Zwischenzustand, der aus dem automatischen Ordner-Scan stammt; der kommt mit
dem Scan wieder, wenn es ihn braucht.
"""
from alembic import op

revision = "0023_atr_lieferungen"
down_revision = "0022_atr_katalog"
branch_labels = None
depends_on = None

UPGRADE = """
create table public.atr_lieferungen (
    id                uuid primary key default gen_random_uuid(),
    quelle_dateiname  varchar(255) not null,
    lieferschein_nr   varchar(40),
    datum             date,
    ba_auftrag        varchar(40),
    bestellnummer     varchar(60),
    programm          varchar(20),
    programm_grund    varchar(200),
    bereich           varchar(8),
    msn               varchar(20),
    bettvariante      varchar(8),
    satz_titel        varchar(100),
    atr_nummer        varchar(80),
    containernummer   varchar(40),
    wiegedatum        date,
    pruefdatum        date,
    qs_unterschrift   varchar(100),
    max_gewicht_kg    numeric(8, 3) check (max_gewicht_kg is null or max_gewicht_kg >= 0),
    status            varchar(16) not null default 'entwurf'
                      check (status in ('entwurf', 'freigegeben')),
    hinweise          jsonb not null default '[]'::jsonb,
    erstellt_am       timestamptz not null default now(),
    geaendert_am      timestamptz not null default now()
);

create index atr_lieferungen_status_idx on public.atr_lieferungen (status, erstellt_am desc);
create index atr_lieferungen_nr_idx on public.atr_lieferungen (lieferschein_nr);

create table public.atr_positionen (
    id                uuid primary key default gen_random_uuid(),
    lieferung_id      uuid not null references public.atr_lieferungen (id) on delete cascade,
    reihenfolge       smallint not null,
    pos               smallint,
    lieferantennummer varchar(40),
    teilenummer       varchar(60),
    -- Wie im Katalog: erzeugt, nicht geschrieben.
    teilenummer_norm  text generated always as
                      (public.atr_teilenummer_norm(teilenummer)) stored,
    -- Nur der Hinweis, woher die Werte stammen. Die Position traegt sie selbst.
    teil_id           uuid references public.atr_teile (id) on delete set null,
    bezeichnung       varchar(200),
    zeichnung         varchar(60),
    kategorie         varchar(40),
    menge             smallint not null default 1 check (menge >= 1),
    gewicht_kg        numeric(8, 3) check (gewicht_kg is null or gewicht_kg >= 0),
    bestellposition   varchar(20),
    seriennummern     text[] not null default '{}',
    erstellt_am       timestamptz not null default now(),
    geaendert_am      timestamptz not null default now(),
    unique (lieferung_id, reihenfolge)
);

create index atr_positionen_lieferung_idx on public.atr_positionen (lieferung_id, reihenfolge);

alter table public.atr_lieferungen enable row level security;
alter table public.atr_positionen enable row level security;

grant select, insert, update, delete
    on public.atr_lieferungen, public.atr_positionen to authenticated;

create policy atr_lieferungen_read on public.atr_lieferungen
    for select to authenticated using (public.app_level('atr') is not null);
create policy atr_lieferungen_schreiben on public.atr_lieferungen
    for all to authenticated
    using (public.app_mindestens('atr', 'editor'))
    with check (public.app_mindestens('atr', 'editor'));

create policy atr_positionen_read on public.atr_positionen
    for select to authenticated using (
        exists (select 1 from public.atr_lieferungen l where l.id = lieferung_id)
    );
create policy atr_positionen_schreiben on public.atr_positionen
    for all to authenticated
    using (public.app_mindestens('atr', 'editor'))
    with check (public.app_mindestens('atr', 'editor'));

create trigger atr_lieferungen_beruehrt before update on public.atr_lieferungen
    for each row execute function public.atr_beruehrt();
create trigger atr_positionen_beruehrt before update on public.atr_positionen
    for each row execute function public.atr_beruehrt();

-- Eine freigegebene Lieferung wird nicht mehr angefasst. Im Altprojekt haengt
-- das an der Oberflaeche; hier an der Tabelle, damit es auch ueber PostgREST
-- gilt. Zuruecknehmen der Freigabe bleibt moeglich — sonst waere ein Tippfehler
-- endgueltig.
create or replace function public.atr_freigegeben_ist_fest()
returns trigger
language plpgsql
as $$
declare
    zustand text;
begin
    select l.status into zustand
      from public.atr_lieferungen l
     where l.id = coalesce(new.lieferung_id, old.lieferung_id);
    if zustand = 'freigegeben' then
        raise exception 'Die Lieferung ist freigegeben und wird nicht mehr geändert'
            using errcode = '23514';
    end if;
    return coalesce(new, old);
end;
$$;

create trigger atr_positionen_fest
    before insert or update or delete on public.atr_positionen
    for each row execute function public.atr_freigegeben_ist_fest();
"""

DOWNGRADE = """
drop trigger if exists atr_positionen_fest on public.atr_positionen;
drop function if exists public.atr_freigegeben_ist_fest();
drop table if exists public.atr_positionen;
drop table if exists public.atr_lieferungen;
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
