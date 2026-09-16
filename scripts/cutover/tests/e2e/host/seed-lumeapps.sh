#!/bin/bash
# Richtet /home/acm/lumeapps so ein, wie es am Produktionshost liegt, und
# startet es. Läuft als `acm` im Host-Container; up.sh ruft es auf.
#
# Eingaben (read-only eingehängt):
#   /seed/lumeapps-src.tar   git archive ffc9ba0 aus dem lumeapps-Repo
#   /seed/kpi.dump           pg_dump (custom) der lokalen Entwicklungsdatenbank
#   /seed/player/            gebautes Player-Bundle (frontend/dist/player)
#   /fixtures/               Override, Signage-Fixtures
#
# Wiederholbar: nach einem vollständigen Lauf liegt ~/.e2e-seeded, dann
# passiert nichts. Wer neu anfangen will, nimmt down.sh.
set -euo pipefail

APP=/home/acm/lumeapps
COMMIT=ffc9ba0

log() { printf '[seed] %s\n' "$*"; }

MARKER=/home/acm/.e2e-seeded

if [ -f "$MARKER" ]; then
  log "$APP ist schon eingerichtet — nichts zu tun"
  exit 0
fi
if [ -e "$APP" ]; then
  log "$APP liegt halb eingerichtet da (abgebrochener Lauf) — erst down.sh, dann up.sh"
  exit 1
fi

# --- 1. Quellbaum: kein Git, nur der entpackte Stand ------------------------
rm -rf "$APP.partial"
mkdir -p "$APP.partial"
tar -xf /seed/lumeapps-src.tar -C "$APP.partial"
echo "$COMMIT" > "$APP.partial/DEPLOYED_COMMIT"
cp /fixtures/docker-compose.override.yml "$APP.partial/"

# Laufzeitverzeichnisse, die am Host neben dem Quellbaum liegen.
mkdir -p "$APP.partial"/{directus_uploads,directus_extensions,directus_database,backups,caddy_data,caddy_config,frontend_node_modules}
mkdir -p "$APP.partial/backend/media/slides" "$APP.partial/frontend/dist"
cp -r /seed/player "$APP.partial/frontend/dist/player"
mv "$APP.partial" "$APP"
cd "$APP"

# --- 2. .env aus .env.example mit frischen Geheimnissen --------------------
cp .env.example .env
chmod 600 .env
python3 - <<'PY'
import base64, os, re, secrets
path = ".env"
text = open(path).read()
values = {
    "POSTGRES_USER": "kpi_user",
    "POSTGRES_PASSWORD": secrets.token_hex(24),
    "POSTGRES_DB": "kpi_db",
    "DIRECTUS_KEY": base64.b64encode(os.urandom(32)).decode(),
    "DIRECTUS_SECRET": base64.b64encode(os.urandom(32)).decode(),
    "DIRECTUS_ADMIN_EMAIL": "admin@example.com",
    "DIRECTUS_ADMIN_PASSWORD": secrets.token_hex(18),
    "DIRECTUS_ADMIN_TOKEN": secrets.token_urlsafe(48),
    "SIGNAGE_DEVICE_JWT_SECRET": secrets.token_urlsafe(64),
    # derselbe Schlüssel wie beim kopierten Bestand, sonst frisch
    "FERNET_KEY": (open("/seed/fernet_key").read().strip() if os.path.exists("/seed/fernet_key") else "")
                  or base64.urlsafe_b64encode(os.urandom(32)).decode(),
}
for key, value in values.items():
    line = f"{key}={value}"
    if re.search(rf"^{key}=", text, flags=re.M):
        text = re.sub(rf"^{key}=.*$", lambda _m: line, text, flags=re.M)
    else:
        text += f"\n{line}\n"
open(path, "w").write(text)
PY
set -a; . ./.env; set +a

# --- 3. Datenbank: zuerst allein, Bestand einspielen ------------------------
log "starte db"
docker compose up -d --wait db

psql_db() { docker compose exec -T db psql -v ON_ERROR_STOP=1 -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"; }

log "spiele Entwicklungsdatenbank ein"
docker compose exec -T db pg_restore --no-owner --no-privileges \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB" < /seed/kpi.dump

# Der Bestand bringt seinen Directus-Admin mit; E-Mail, Token und die
# Rollen-UUID an die neue .env anpassen. Das Passwort setzt Directus selbst.
psql_db -c "update directus_users set email = '$DIRECTUS_ADMIN_EMAIL', token = '$DIRECTUS_ADMIN_TOKEN'
            where id = (select id from directus_users order by email limit 1)"
admin_role=$(psql_db -Atc "select id from directus_roles where name = 'Administrator'")
sed -i "s/^DIRECTUS_ADMINISTRATOR_ROLE_UUID=.*/DIRECTUS_ADMINISTRATOR_ROLE_UUID=$admin_role/" .env
log "setze Directus-Admin-Passwort"
docker compose run --rm --no-deps -T --entrypoint node directus \
  cli.js users passwd --email "$DIRECTUS_ADMIN_EMAIL" --password "$DIRECTUS_ADMIN_PASSWORD" >/dev/null

# --- 4. Signage-Dateien: Upload, PPTX, abgeleitete Folien -------------------
python3 - <<'PY'
import base64, zipfile
# 1x1-PNG, rot
png = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="
)
open("directus_uploads/77777777-7777-4777-8777-777777777701.png", "wb").write(png)
with zipfile.ZipFile("directus_uploads/77777777-7777-4777-8777-777777777702.pptx", "w") as z:
    z.writestr("[Content_Types].xml", "<Types/>")
    z.writestr("ppt/presentation.xml", "<presentation/>")
import os
slides = "backend/media/slides/66666666-6666-4666-8666-666666666602"
os.makedirs(slides, exist_ok=True)
for i in (1, 2):
    open(f"{slides}/slide-{i:03d}.png", "wb").write(png)
PY

log "Signage-Fixtures"
psql_db < /fixtures/signage-fixtures.sql >/dev/null
psql_db < /fixtures/atr-fixtures.sql >/dev/null

# --- 5. Hochfahren wie am Host: schlicht `docker compose up -d` -------------
log "docker compose up -d (baut api und frontend, dauert)"
docker compose up -d

touch "$MARKER"
log "fertig"
