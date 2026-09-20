"""Sensoren: Messwerte bleiben dauerhaft, sie werden nie automatisch gelöscht.

Revision ID: 0059_sensor_messwerte_bleiben
Revises: 0058_atr_ablageziele
Create Date: 2026-09-20

`0026_sensoren` legte einen nächtlichen Aufräum-Job an, der die Zeitreihe nach
drei Jahren wegwarf (`delete from sensor_messungen where gemessen_am < now() -
interval '3 years'`). Das war zwar bewusst gesetzt, widerspricht aber der
Zusage, dass Sensormessdaten und ihre historischen Reihen **niemals**
selbsttätig verschwinden: eine Messung ist der einzige Beleg dafür, wie warm es
in einem Raum tatsächlich war — nachrechnen lässt sie sich nicht.

Der Aufräum-Job bleibt bestehen, aber nur noch für das **Betriebsprotokoll**
`sensor_versuche`: eine gescheiterte oder geglückte Abfrage sagt nach zwei
Wochen nichts mehr, was die Zeitreihe nicht auch sagt. Die Zeitreihe selbst
rührt er nicht mehr an.

**Diese Migration löscht nichts.** Sie tauscht nur den Funktionskörper
(`create or replace`) — bestehende Messwerte, auch die älter als drei Jahre,
bleiben unangetastet. Der Zeitplan (`sensoren-aufraeumen`, 03:20 Uhr) bleibt
unverändert; er ruft dieselbe Funktion, die jetzt weniger tut.
"""
from alembic import op

revision = "0059_sensor_messwerte_bleiben"
down_revision = "0058_atr_ablageziele"
branch_labels = None
depends_on = None

UPGRADE = """
create or replace function public.sensoren_aufraeumen()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    geloescht integer;
begin
    -- Die Zeitreihe bleibt für immer: Sensormessdaten werden nie automatisch
    -- gelöscht. Nur das Betriebsprotokoll der Abfrageversuche wird nach vierzehn
    -- Tagen gekürzt — es ist Protokoll, kein Messwert.
    delete from public.sensor_versuche
     where versucht_am < now() - interval '14 days';
    get diagnostics geloescht = row_count;
    return geloescht;
end;
$$;

revoke execute on function public.sensoren_aufraeumen() from public, anon, authenticated;
"""

# Der Weg zurück stellt den alten Körper wieder her — samt der Drei-Jahres-
# Löschung der Zeitreihe. Er scheitert nicht an vorhandenen Daten, weil er nur
# die Funktion ersetzt; die Löschung geschähe erst beim nächsten geplanten Lauf.
DOWNGRADE = """
create or replace function public.sensoren_aufraeumen()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    geloescht integer;
begin
    delete from public.sensor_messungen
     where gemessen_am < now() - interval '3 years';
    get diagnostics geloescht = row_count;
    delete from public.sensor_versuche
     where versucht_am < now() - interval '14 days';
    return geloescht;
end;
$$;

revoke execute on function public.sensoren_aufraeumen() from public, anon, authenticated;
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
