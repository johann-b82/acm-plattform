"""Übernommene Sensor-Faktoren invertieren (Divisor → Multiplikator).

Revision ID: 0054_sensor_faktor
Revises: 0053_matpreise_datenstand
Create Date: 2026-09-13

Das Altprojekt teilt den Rohwert durch die Skala (`raw / scale`), der neue
Stack multipliziert mit dem Faktor (`raw * faktor`, `app/sensoren/messen.py`).
Die Übernahme kopierte die alte Skala bisher **unverändert** als Faktor. Ein
Gerät, das Zehntelgrad als ganze Zahl liefert (Skala 10, `210 → 21,0`), stünde
im neuen Stack auf Faktor 10 und ergäbe beim nächsten Live-Read `210 * 10 =
2100` statt `210 * 0,1 = 21,0` — Faktor 100 daneben.

Die bereits gespeicherten Messwerte sind davon unberührt (sie wurden als fertig
skalierte Werte migriert), nur der Faktor für künftige Abfragen war falsch.
Diese Migration rechnet die vorhandenen Faktoren einmalig auf den neuen
Multiplikator um (`faktor = 1 / faktor`). Die Übernahme selbst invertiert ab
jetzt beim Import (`technik.py::_faktor_aus_skala`); auf einem frischen Stack
läuft diese Migration über eine leere Tabelle und tut nichts.
"""
from alembic import op

revision = "0054_sensor_faktor"
down_revision = "0053_matpreise_datenstand"
branch_labels = None
depends_on = None

UPGRADE = """
update public.sensoren
set temperatur_faktor = 1 / temperatur_faktor
where temperatur_faktor is not null and temperatur_faktor <> 0;

update public.sensoren
set feuchte_faktor = 1 / feuchte_faktor
where feuchte_faktor is not null and feuchte_faktor <> 0;
"""

DOWNGRADE = """
update public.sensoren
set temperatur_faktor = 1 / temperatur_faktor
where temperatur_faktor is not null and temperatur_faktor <> 0;

update public.sensoren
set feuchte_faktor = 1 / feuchte_faktor
where feuchte_faktor is not null and feuchte_faktor <> 0;
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
