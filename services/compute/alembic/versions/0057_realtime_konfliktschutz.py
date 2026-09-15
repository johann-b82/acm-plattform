"""Realtime und Konfliktschutz, Phase 1 (ADR-0006).

Revision ID: 0057_realtime_konfliktschutz
Revises: 0056_feedback_bearbeitung
Create Date: 2026-09-15

Mehrere Personen arbeiten gleichzeitig an denselben Datensaetzen. Bisher
gewann still, wer zuletzt speicherte, und offene Seiten sahen Aenderungen
anderer erst nach dem naechsten Laden.

**Version je Zeile.** `version` steigt bei jeder Aenderung — per Trigger, also
auch wenn `compute` oder ein Import schreibt, und auch wenn jemand die Version
selbst mitschickt. Die Oberflaeche speichert nur mit `version = <geladen>`;
trifft das nichts, war jemand anders schneller.

**Meldung ohne Inhalt.** Nach jeder Aenderung meldet ein Trigger auf dem
privaten Kanal `tabelle:<name>` nur Tabelle, Vorgang und Kennung. Offene Seiten
laden ueber PostgREST nach — die Leseregeln gelten also unveraendert. Der
Trigger laeuft als Eigentuemer (`postgres`, BYPASSRLS): schreiben darf in
`realtime.messages` sonst niemand eine Aenderungsmeldung.

**Kanalrechte.** `realtime_tabellen` sagt, welche Tabelle einen Kanal hat und
welches Recht er verlangt — dieselbe Schranke wie die Leseregel der Tabelle.
Die Policies auf `realtime.messages` sind die einzige Ausnahme von der Regel,
dass Alembic nur `public.*` anfasst (ADR-0006): Supabase sieht sie genau dort
vor. Keine Tabellen, Spalten oder Funktionen im Schema `realtime`.
"""
from alembic import op

revision = "0057_realtime_konfliktschutz"
down_revision = "0056_feedback_bearbeitung"
branch_labels = None
depends_on = None

# Tabelle, App, Mindeststufe (None: jede Stufe) — wie die Leseregel der Tabelle —
# und die Spalten, deren Aenderung allein die Version nicht hochzaehlt.
PHASE_1 = [
    ("atr_lieferungen", "atr", None, ()),
    ("atr_positionen", "atr", None, ()),
    ("audits", "quality", None, ()),
    ("audit_phasen", "quality", None, ()),
    ("maschinen", "production", None, ()),
    ("wartungsaufgaben", "production", None, ()),
    # Gesehen ist keine Aenderung am Inhalt: die Liste hakt ab, was sie
    # angezeigt hat, oft im selben Zug mit einem Statuswechsel — der sonst an
    # der eigenen Markierung scheiterte.
    ("feedback", "platform", "admin", ("gesehen_am",)),
]

GRUNDLAGE = """
create table public.realtime_tabellen (
    tabelle varchar(63) primary key,
    app     varchar(63) not null,
    stufe   varchar(20) check (stufe in ('viewer', 'editor', 'admin'))
);
comment on table public.realtime_tabellen is
    'Tabellen mit Realtime-Kanal und das Recht, das ihr Kanal verlangt (ADR-0006).';

alter table public.realtime_tabellen enable row level security;
create policy realtime_tabellen_lesen on public.realtime_tabellen
    for select to authenticated using (true);
grant select on public.realtime_tabellen to authenticated;

-- Darf die angemeldete Person diesen Kanal nutzen? `tabelle:<name>` und
-- `datensatz:<name>:<kennung>` verlangen dasselbe Recht wie die Tabelle.
create or replace function public.realtime_darf(p_thema text)
returns boolean
language sql
stable
set search_path = public
as $$
    select exists (
        select 1
          from public.realtime_tabellen t
         where t.tabelle = case
                   when p_thema like 'tabelle:%' then substr(p_thema, length('tabelle:') + 1)
                   when p_thema like 'datensatz:%' then split_part(p_thema, ':', 2)
               end
           and case
                   when t.stufe is null then public.app_level(t.app) is not null
                   else public.app_mindestens(t.app, t.stufe)
               end
    );
$$;
grant execute on function public.realtime_darf(text) to authenticated;

create or replace function public.zeile_versionieren()
returns trigger
language plpgsql
as $$
begin
    -- Die Trigger-Argumente nennen Spalten, deren Aenderung allein den Inhalt
    -- nicht aendert. Die Version bleibt nur stehen, wenn sich genau solche
    -- Spalten geaendert haben und sonst nichts — ein Update, das gar nichts
    -- aendert, zaehlt wie ueberall. Verglichen wird ohne die Version und ohne
    -- den Aenderungsstempel, den ein anderer Trigger vorher setzt.
    if tg_nargs > 0
       and (to_jsonb(new) - tg_argv - 'version' - 'geaendert_am')
         = (to_jsonb(old) - tg_argv - 'version' - 'geaendert_am')
       and (to_jsonb(new) - 'version' - 'geaendert_am')
        <> (to_jsonb(old) - 'version' - 'geaendert_am') then
        new.version := old.version;
        return new;
    end if;
    -- Von aussen gesetzte Werte zaehlen nicht: sonst liesse sich die Pruefung
    -- umgehen, indem man die erwartete Version gleich mitschreibt.
    new.version := old.version + 1;
    return new;
end;
$$;

create or replace function public.aenderung_melden()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    kennung uuid;
begin
    if tg_op = 'DELETE' then
        kennung := old.id;
    else
        kennung := new.id;
    end if;
    perform realtime.send(
        jsonb_build_object('tabelle', tg_table_name, 'op', tg_op, 'datensatz', kennung),
        'aenderung',
        'tabelle:' || tg_table_name,
        true
    );
    return null;
end;
$$;

-- Empfangen: Aenderungsmeldungen und Anwesenheit, wer die Tabelle lesen darf.
create policy realtime_empfangen on realtime.messages
    for select to authenticated
    using (
        extension in ('broadcast', 'presence')
        and public.realtime_darf(realtime.topic())
    );

-- Eintragen: nur Anwesenheit. Aenderungsmeldungen schreibt allein der
-- Trigger — sonst liesse sich allen offenen Seiten ein Neuladen aufzwingen.
create policy realtime_anwesend on realtime.messages
    for insert to authenticated
    with check (
        extension = 'presence'
        and public.realtime_darf(realtime.topic())
    );
"""

GRUNDLAGE_WEG = """
drop policy if exists realtime_anwesend on realtime.messages;
drop policy if exists realtime_empfangen on realtime.messages;
drop function if exists public.aenderung_melden();
drop function if exists public.zeile_versionieren();
drop function if exists public.realtime_darf(text);
drop table if exists public.realtime_tabellen;
"""


def freigeben(tabelle: str, app: str, stufe: str | None, ohne: tuple[str, ...]) -> str:
    wert = "null" if stufe is None else f"'{stufe}'"
    argumente = ", ".join(f"'{spalte}'" for spalte in ohne)
    return f"""
insert into public.realtime_tabellen (tabelle, app, stufe) values ('{tabelle}', '{app}', {wert});
alter table public.{tabelle} add column version integer not null default 1;
create trigger {tabelle}_version
    before update on public.{tabelle}
    for each row execute function public.zeile_versionieren({argumente});
create trigger {tabelle}_melden
    after insert or update or delete on public.{tabelle}
    for each row execute function public.aenderung_melden();
"""


def zuruecknehmen(tabelle: str) -> str:
    return f"""
drop trigger if exists {tabelle}_melden on public.{tabelle};
drop trigger if exists {tabelle}_version on public.{tabelle};
alter table public.{tabelle} drop column if exists version;
"""


def upgrade() -> None:
    op.execute(GRUNDLAGE)
    for tabelle, app, stufe, ohne in PHASE_1:
        op.execute(freigeben(tabelle, app, stufe, ohne))


def downgrade() -> None:
    for tabelle, *_rest in PHASE_1:
        op.execute(zuruecknehmen(tabelle))
    op.execute(GRUNDLAGE_WEG)
