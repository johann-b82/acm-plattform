"""Geheimnisse, die über die Oberfläche eingetragen werden.

Bisher standen die Personio-Zugangsdaten in der Umgebung von `compute`. Das
heißt: wer sie ändern will, braucht Zugang zum Server. Beim Altsystem trug
sie jemand in der Maske ein — und dorthin soll es zurück.

**Verschlüsselt, mit dem Schlüssel woanders.** Der Geheimtext steht hier, der
Schlüssel (`GEHEIM_SCHLUESSEL`) in der Umgebung von `compute`. Ein Abzug der
Datenbank allein gibt nichts her — und der ist der wahrscheinliche Fall: eine
Sicherung, die auf einem anderen Rechner liegt, ein Dump im Support-Ticket.

**Kein Leserecht, auch nicht auf den Geheimtext.** `authenticated` bekommt
nichts, `anon` bekommt nichts; RLS ist an, und es gibt keine Policy. PostgREST
kann die Tabelle damit nicht ausliefern, selbst wenn jemand später versehentlich
ein Recht erteilt. Wer den Klartext braucht, ist `compute` — und das spricht
mit der Datenbank nicht über PostgREST.

**Ein Datum und ein Name, sonst nichts.** Die Maske soll sagen können „am
9.9. von wem gesetzt", ohne das Geheimnis anzufassen. Deshalb stehen
`geaendert_am` und `geaendert_von` in derselben Zeile — eine eigene
Protokolltabelle wäre für zwei Felder zu viel.
"""
from alembic import op

revision = "0038_geheimnisse"
down_revision = "0037_datenstand"
branch_labels = None
depends_on = None

UPGRADE = """
create table public.geheimnisse (
    -- Sprechender Schlüssel statt einer UUID: es gibt je Sache genau eines,
    -- und `personio_client_secret` liest sich in einem Dump besser als eine
    -- Zufallszahl.
    schluessel    varchar(64) primary key,
    -- Fernet-Geheimtext. Nie im Klartext, auch nicht kurz.
    geheimtext    bytea not null,
    geaendert_am  timestamptz not null default now(),
    -- Wer es zuletzt gesetzt hat. `set null`, weil ein gelöschtes Konto kein
    -- Grund ist, ein gültiges Geheimnis mitzunehmen.
    geaendert_von uuid references auth.users(id) on delete set null
);

comment on table public.geheimnisse is
    'Verschlüsselte Zugangsdaten. Schlüssel in der Umgebung von compute, nicht hier.';

alter table public.geheimnisse enable row level security;

-- Keine Policy, keine Rechte: die Tabelle gehört compute allein.
revoke all on public.geheimnisse from public, anon, authenticated;
"""

DOWNGRADE = """
drop table if exists public.geheimnisse;
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
