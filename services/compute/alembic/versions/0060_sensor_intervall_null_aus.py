"""Sensoren: das globale Abfrageintervall darf 0 sein — 0 heißt aus.

Revision ID: 0060_sensor_intervall_null_aus
Revises: 0059_sensor_messwerte_bleiben
Create Date: 2026-09-20

Bis hierher verlangte `sensor_einstellungen.abfrage_sekunden` einen Wert
zwischen 5 und 86400. Der Mindestwert 5 ist überholt: das Intervall ist frei in
ganzen Sekunden wählbar, einschließlich **0 = aus**. Bei 0 stößt die Datenbank
keinen selbsttätigen Durchgang mehr an; von Hand messen bleibt möglich.

Zwei Änderungen:

- Der Bereich wird auf `between 0 and 86400` geweitet. Bestehende Werte (alle
  ≥ 5) erfüllen ihn weiterhin — die Migration verliert nichts.
- `sensoren_faellig()` bekommt den Fall 0 vorangestellt: dann ist nie etwas
  fällig. Ohne diesen Fall führte `now() - interval '0 seconds'` dazu, dass
  jeder Minutentakt sofort fällig wäre — also das Gegenteil von „aus".

Ein Wert unter 60 Sekunden wird **nicht** auf eine Minute aufgerundet; er wird
so gespeichert, wie er eingegeben wurde. Feiner als minütlich misst der Takt
gleichwohl nicht, weil `pg_cron` nur zur vollen Minute anklopft — das ist eine
effektive Untergrenze des Anstoßes, keine Rundung des Werts.
"""
from alembic import op

revision = "0060_sensor_intervall_null_aus"
down_revision = "0059_sensor_messwerte_bleiben"
branch_labels = None
depends_on = None

UPGRADE = """
alter table public.sensor_einstellungen
    drop constraint sensor_einstellungen_abfrage_sekunden;
alter table public.sensor_einstellungen
    add constraint sensor_einstellungen_abfrage_sekunden
    check (abfrage_sekunden between 0 and 86400);

create or replace function public.sensoren_faellig()
returns boolean
language sql
stable
set search_path = public
as $$
    select case
        -- 0 = aus: kein selbsttätiger Durchgang.
        when e.abfrage_sekunden = 0 then false
        else coalesce(
            greatest(e.letzter_anstoss,
                     (select max(v.versucht_am) from public.sensor_versuche v))
                <= now() - make_interval(secs => e.abfrage_sekunden)
                   + least(interval '30 seconds',
                           make_interval(secs => e.abfrage_sekunden / 2.0)),
            true)
    end
    from public.sensor_einstellungen e;
$$;

revoke all on function public.sensoren_faellig() from public;
"""

# Zurück: erst die Funktion, dann der engere Bereich. Der Bereich schlägt fehl,
# falls inzwischen ein Wert unter 5 (etwa 0 = aus) gespeichert wurde — dann muss
# er vor dem Downgrade von Hand angehoben werden.
DOWNGRADE = """
create or replace function public.sensoren_faellig()
returns boolean
language sql
stable
set search_path = public
as $$
    select coalesce(
        greatest(e.letzter_anstoss,
                 (select max(v.versucht_am) from public.sensor_versuche v))
            <= now() - make_interval(secs => e.abfrage_sekunden)
               + least(interval '30 seconds',
                       make_interval(secs => e.abfrage_sekunden / 2.0)),
        true)
    from public.sensor_einstellungen e;
$$;

revoke all on function public.sensoren_faellig() from public;

alter table public.sensor_einstellungen
    drop constraint sensor_einstellungen_abfrage_sekunden;
alter table public.sensor_einstellungen
    add constraint sensor_einstellungen_abfrage_sekunden
    check (abfrage_sekunden between 5 and 86400);
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
