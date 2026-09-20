"""FAIR: die fehlplatzierte Logo-Datei quarantänieren (reversibel).

Revision ID: 0064_fair_logo_quarantaene
Revises: 0063_fair_quarantaene
Create Date: 2026-09-20

`ACM_Logo_Blue_print.pdf` liegt ohne Kunde und ohne Teilenummer im FAIR-Bestand
— eine Nicht-Zeichnung, in der Abnahme vom 20.09.2026 als Fehlablage bestätigt.
Diese Migration nimmt sie aus der Liste, indem sie sie **quarantäniert**, nicht
löscht: die Zeile und etwaige Ballons/Prüfmaße bleiben vollständig erhalten.

Vorsichtig und umkehrbar:

- Nur die Datei mit **genau diesem Namen** und **leerem Kunden und leerer
  Teilenummer** wird erfasst — eine legitime, gleichnamige Zeichnung mit
  gepflegten Feldern bliebe unangetastet.
- Idempotent: `where quarantaene_am is null` — ein zweiter Lauf ändert nichts.
- Auf einer frischen Datenbank ohne diese Datei ist es ein reiner Leerlauf.
- Der Weg zurück (`downgrade`) hebt genau diese Quarantäne wieder auf (erkannt
  am Grund-Vermerk).
"""
from alembic import op

revision = "0064_fair_logo_quarantaene"
down_revision = "0063_fair_quarantaene"
branch_labels = None
depends_on = None

GRUND = "Fehlablage: Nicht-Zeichnung (Logo) ohne Kunde/Teilenummer, Abnahme 20.09.2026"

UPGRADE = f"""
update public.fair_zeichnungen
   set quarantaene_am = now(),
       quarantaene_grund = '{GRUND}'
 where name = 'ACM_Logo_Blue_print.pdf'
   and quarantaene_am is null
   and coalesce(btrim(teilenummer), '') = ''
   and coalesce(btrim(kunde), '') = '';
"""

DOWNGRADE = f"""
update public.fair_zeichnungen
   set quarantaene_am = null,
       quarantaene_grund = null
 where quarantaene_grund = '{GRUND}';
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
