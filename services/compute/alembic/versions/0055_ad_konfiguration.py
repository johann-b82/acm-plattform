"""Active-Directory-Anbindung: Konfiguration je Plattform (ADR-0004, Weg LDAPS).

Revision ID: 0055_ad_konfiguration
Revises: 0054_sensor_faktor
Create Date: 2026-09-13

Eine Zeile wie `plattform_logo`. Sie sagt `compute`, gegen welches AD es das
Passwort per LDAPS-Bind prüft. Das Dienstkonto-Passwort steht **nicht** hier,
sondern Fernet-verschlüsselt in `geheimnisse` (Schlüssel `ad_dienst`) — was in
der Tabelle steht, steht in jeder Sicherung.

`groups.source in ('manual','ad')` und `groups.external_id` sind seit dem
Rechtemodell (0001) vorbereitet; AD-Gruppen wandern ohne Schemaänderung hinein.
Rechte je App vergibt weiter ein Admin über „Nutzer und Gruppen"; diese Zeile
schaltet nur die Anmeldung.
"""
from alembic import op

revision = "0055_ad_konfiguration"
down_revision = "0054_sensor_faktor"
branch_labels = None
depends_on = None

UPGRADE = """
create table public.ad_konfiguration (
    id                boolean primary key default true check (id),
    aktiv             boolean not null default false,
    -- Domain-Controller, üblich Port 636 (LDAPS).
    host              text,
    port              integer not null default 636 check (port between 1 and 65535),
    -- Anmeldename wird zu `<benutzer>@<upn_suffix>`, falls kein Dienstkonto sucht.
    upn_suffix        text,
    -- Wo Nutzer und Gruppen gesucht werden (z. B. „DC=firma,DC=local").
    basis_dn          text,
    -- Optionales Read-Only-Dienstkonto, das den Nutzer erst sucht (DN).
    dienst_konto_dn   text,
    -- Nur AD-Gruppen unter diesem DN werden übernommen; leer = alle memberOf.
    gruppen_basis_dn  text,
    -- Zertifikat des DC nicht prüfen (nur für erste Tests, nicht für Produktion).
    tls_pruefen       boolean not null default true,
    geaendert_am      timestamptz not null default now()
);

insert into public.ad_konfiguration (id) values (true);

alter table public.ad_konfiguration enable row level security;

-- Lesen und Ändern nur die Plattform-Verwaltung (Einstellungsseite). Ob AD an
-- ist, sagt der öffentliche Anmelde-Status-Endpunkt in `compute`, der mit dem
-- service_role-Schlüssel liest und RLS ohnehin umgeht — der anonyme Browser
-- bekommt Host und DN nicht zu sehen.
grant select, update on public.ad_konfiguration to authenticated;

create policy ad_konfiguration_lesen on public.ad_konfiguration
    for select to authenticated using (public.app_mindestens('platform', 'admin'));
create policy ad_konfiguration_pflegen on public.ad_konfiguration
    for update to authenticated
    using (public.app_mindestens('platform', 'admin'))
    with check (public.app_mindestens('platform', 'admin'));
"""

DOWNGRADE = """
drop table if exists public.ad_konfiguration;
"""


def upgrade() -> None:
    op.execute(UPGRADE)


def downgrade() -> None:
    op.execute(DOWNGRADE)
