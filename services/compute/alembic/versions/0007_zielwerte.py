"""Zielwerte der Kennzahlen — pflegbar statt fest verdrahtet.

Revision ID: 0007_zielwerte
Revises: 0006_qualitaet
Create Date: 2026-09-10

Drei Kennzahlen tragen ihren Zielwert bislang als Konstante im Frontend, weil
die Einstellungen aus dem Altprojekt noch nicht portiert sind. Jede weitere
Kennzahl mit Ziellinie wäre die vierte. Deshalb hier der Mechanismus, aber
bewusst schmal.

Nicht der 67-spaltige Singleton des Altprojekts, sondern eine Zeile je
Zielwert. Der Unterschied ist praktisch: ein neues Modul fügt eine Zeile ein,
statt eine Migration mit einer neuen Spalte zu brauchen, und die Oberfläche
kann alle Zielwerte über einen Kamm rendern.

Anteile stehen als Bruch in der Datenbank (0.98 = 98 %), so wie im
Altprojekt. Die Oberfläche zeigt und nimmt Prozent — die Umrechnung passiert
an genau einer Stelle, damit sie nicht je Dashboard neu erfunden wird.

Was das Altprojekt nicht konnte: einen Zielwert auf leer setzen. Das bleibt
so, aber aus einem anderen Grund — hier ist `wert` schlicht `not null`. Jede
Kennzahl hat einen sinnvollen Ausgangswert; „kein Ziel" wäre eine eigene
Funktion und keine leere Zelle.
"""
from alembic import op

revision = "0007_zielwerte"
down_revision = "0006_qualitaet"
branch_labels = None
depends_on = None

UPGRADE = """
-- Reicht die Rechtestufe? `app_level` gibt den Text zurück, für einen
-- Vergleich braucht es die Reihenfolge. Bisher stand sie in jeder Policy
-- als `is not null` — das genügt beim Lesen, nicht beim Schreiben.
create or replace function public.app_mindestens(p_app text, p_stufe text)
returns boolean
language sql
stable
as $$
    select coalesce(
        array_position(array['viewer', 'editor', 'admin'], public.app_level(p_app))
            >= array_position(array['viewer', 'editor', 'admin'], p_stufe),
        false
    );
$$;

grant execute on function public.app_mindestens(text, text) to authenticated, anon;

create table public.zielwerte (
    schluessel    varchar(64) primary key,
    bereich       varchar(32) not null,
    label         varchar(128) not null,
    beschreibung  text,
    wert          numeric not null,
    -- `anteil` steht als Bruch in der Spalte, die Oberfläche zeigt Prozent.
    einheit       varchar(16) not null check (einheit in ('anzahl', 'anteil')),
    -- Ist ein hoher Wert gut (OTD) oder schlecht (Verzug)? Entscheidet, ob
    -- die Kachel bei Überschreitung warnt oder bei Unterschreitung.
    richtung      varchar(8) not null check (richtung in ('min', 'max')),
    sortierung    integer not null default 0,
    geaendert_am  timestamptz not null default now(),
    geaendert_von uuid references auth.users (id) on delete set null
);

alter table public.zielwerte enable row level security;
grant select on public.zielwerte to authenticated;
grant update on public.zielwerte to authenticated;

-- Lesen darf, wer die Kennzahlen sieht: ohne Zielwert fehlt der Kachel die
-- Einordnung. Ändern darf nur, wer die Einstellungen bearbeiten darf.
create policy zielwerte_read on public.zielwerte
    for select to authenticated using (public.app_level('kpi') is not null);
create policy zielwerte_write on public.zielwerte
    for update to authenticated
    using (public.app_mindestens('settings', 'editor'))
    with check (public.app_mindestens('settings', 'editor'));

insert into public.zielwerte (schluessel, bereich, label, beschreibung, wert, einheit, richtung, sortierung)
values
    ('einkauf_otd', 'einkauf', 'Liefertermintreue',
     'Anteil der Lieferpositionen, die pünktlich ankommen sollen.',
     0.98, 'anteil', 'min', 10),
    ('produktion_verzug', 'produktion', 'Verzugsquote',
     'Höchster Anteil an Aufträgen, die zu spät fertig werden.',
     0.10, 'anteil', 'max', 20),
    ('qualitaet_audit_level1', 'qualitaet', 'Audit-Findings Level 1',
     'Höchstzahl schwerwiegender Befunde im Zeitraum.',
     0, 'anzahl', 'max', 30),
    ('qualitaet_audit_level2', 'qualitaet', 'Audit-Findings Level 2',
     'Höchstzahl leichter Befunde im Zeitraum.',
     5, 'anzahl', 'max', 31);

-- Die Kachel gibt es seit 0001 unter der Kennung `settings`; nur der Pfad
-- zieht auf die deutsche Schreibweise um, wie bei den übrigen Seiten.
update public.apps set path = '/einstellungen' where id = 'settings';
"""

DOWNGRADE = """
update public.apps set path = '/settings' where id = 'settings';
drop table if exists public.zielwerte;
drop function if exists public.app_mindestens(text, text);
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
