"""ODBC-Worker über die Plattform steuern und überwachen.

Revision ID: 0068_odbc_worker_steuerung
Revises: 0067_odbc_datenquelle
Create Date: 2026-10-08

Der Windows-Worker (0067) läuft auf einer eigenen VM und hat nur ausgehende
Verbindungen — er kann keine Befehle entgegennehmen. Steuerung und Überwachung
laufen deshalb spiegelbildlich:

  - **Steuern (Pull):** die Plattform schreibt `odbc_worker_konfig`, der Worker
    liest sie zyklisch über `GET /api/odbc/konfig`. Intervall, aktive Arten und
    ein „jetzt synchronisieren"-Zeitstempel (`sync_angefordert_am`).
  - **Überwachen (Push):** der Worker meldet über `POST /api/odbc/status`.
    `compute` schreibt daraus `odbc_worker_status` (ein Herzschlag je VM) und je
    Art eine Zeile `odbc_sync_lauf` (letzter Lauf: Zeit, Zeilen, Dauer, Fehler).

Drei Tabellen:
  - `odbc_worker_konfig` — Singleton wie `ad_konfiguration`. Lesen und Ändern
    nur die Plattform-Verwaltung (die Datenquelle-Seite); der Worker liest über
    `compute` (service_role, umgeht RLS).
  - `odbc_worker_status` — Singleton, nur `compute` schreibt (service_role);
    Angemeldete mit `platform:admin` lesen den Herzschlag. Kein Update-Grant.
  - `odbc_sync_lauf` — eine Zeile je Art (letzter Stand, keine Historie), sonst
    wie `odbc_worker_status`.

Nichts davon ist geheim im Sinne von `geheimnisse`; das `ODBC_SYNC_TOKEN` bleibt
in der Umgebung von `compute`, nicht in der Datenbank.
"""
from alembic import op

revision = "0068_odbc_worker_steuerung"
down_revision = "0067_odbc_datenquelle"
branch_labels = None
depends_on = None

# Vorgabe der aktiven Arten: die im Worker verdrahteten (mit bestätigtem bzw.
# ableitbarem Mapping). Die drei offenen (kontakte/interessenten/liefertreue)
# sind bewusst nicht dabei.
AKTIVE_ARTEN_VORGABE = (
    '["umsatz","auftraege","angebote","lagerpreise","acht_d",'
    '"auftragspositionen","lieferscheine","wareneingaenge","materialpreise",'
    '"lagerbewegungen","pruefungen"]'
)

UPGRADE = f"""
create table public.odbc_worker_konfig (
    id                  boolean primary key default true check (id),
    -- Wie oft der Worker einen vollen Lauf macht (Minuten).
    intervall_min       integer not null default 60
                        check (intervall_min between 5 and 1440),
    -- Welche Arten der Worker ziehen soll (Teilmenge der REGISTRY-Schlüssel).
    aktive_arten        jsonb not null default '{AKTIVE_ARTEN_VORGABE}'::jsonb,
    -- Setzt die Oberfläche auf now(), wenn „jetzt synchronisieren" gedrückt
    -- wird. Der Worker läuft beim nächsten Poll außer der Reihe und meldet die
    -- Erledigung über odbc_worker_status.sync_bestaetigt_am zurück.
    sync_angefordert_am timestamptz,
    geaendert_am        timestamptz not null default now()
);

insert into public.odbc_worker_konfig (id) values (true);

alter table public.odbc_worker_konfig enable row level security;

grant select, update on public.odbc_worker_konfig to authenticated;

create policy odbc_worker_konfig_lesen on public.odbc_worker_konfig
    for select to authenticated using (public.app_mindestens('platform', 'admin'));
create policy odbc_worker_konfig_pflegen on public.odbc_worker_konfig
    for update to authenticated
    using (public.app_mindestens('platform', 'admin'))
    with check (public.app_mindestens('platform', 'admin'));


create table public.odbc_worker_status (
    id                  boolean primary key default true check (id),
    -- Letzter Herzschlag des Workers (jeder Status-Post aktualisiert ihn).
    gesehen_am          timestamptz,
    worker_version      text,
    host                text,
    -- Zeitstempel des zuletzt erledigten „jetzt synchronisieren"-Auftrags
    -- (gespiegelt aus odbc_worker_konfig.sync_angefordert_am).
    sync_bestaetigt_am  timestamptz,
    letzter_fehler      text,
    geaendert_am        timestamptz not null default now()
);

insert into public.odbc_worker_status (id) values (true);

alter table public.odbc_worker_status enable row level security;

-- Nur lesen; geschrieben wird ausschließlich von compute (service_role).
grant select on public.odbc_worker_status to authenticated;

create policy odbc_worker_status_lesen on public.odbc_worker_status
    for select to authenticated using (public.app_mindestens('platform', 'admin'));


create table public.odbc_sync_lauf (
    art           varchar(32) primary key,
    gelaufen_am   timestamptz not null default now(),
    status        varchar(8) not null check (status in ('ok', 'fehler')),
    zeilen        integer,
    dauer_ms      integer,
    fehler        text
);

alter table public.odbc_sync_lauf enable row level security;

grant select on public.odbc_sync_lauf to authenticated;

create policy odbc_sync_lauf_lesen on public.odbc_sync_lauf
    for select to authenticated using (public.app_mindestens('platform', 'admin'));
"""

DOWNGRADE = """
drop table if exists public.odbc_sync_lauf;
drop table if exists public.odbc_worker_status;
drop table if exists public.odbc_worker_konfig;
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
