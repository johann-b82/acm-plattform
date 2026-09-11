#!/usr/bin/env bash
# Legt den Break-Glass-Plattform-Admin an (GoTrue Admin-API) und hängt ihn in
# die Gruppe "Plattform-Admins" (app_grants: platform=admin).
#
# Idempotent — und zwar auch beim Passwort. Vorher war es das nicht: bei einem
# bereits vorhandenen Konto scheiterte das Anlegen, der Fehler wurde von
# `|| true` verschluckt, und das Skript meldete Erfolg, **ohne das Passwort
# gesetzt zu haben**. Wer sich dann mit dem übergebenen Passwort anmelden
# wollte, bekam „Anmeldung fehlgeschlagen" und hatte keinen Anhaltspunkt.
#
# Usage: scripts/bootstrap-admin.sh <email> <passwort>
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"
EMAIL="${1:?email}"; PASSWORD="${2:?passwort}"
set -a; . ./.env; set +a

KONG="http://127.0.0.1:${KONG_HTTP_PORT}"
AUTH=(-H "apikey: ${SERVICE_ROLE_KEY}" -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" -H "Content-Type: application/json")

kennung_aus() { python3 -c 'import json,sys; print(json.load(sys.stdin).get("id",""))'; }

# Anlegen. Gibt es das Konto schon, antwortet GoTrue mit 422 — das ist kein
# Fehler, sondern der zweite gültige Fall.
ANTWORT="$(curl -s -o /tmp/bootstrap-admin.json -w '%{http_code}' "${AUTH[@]}" \
  -X POST "${KONG}/auth/v1/admin/users" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\",\"email_confirm\":true}")"

if [ "${ANTWORT}" = "200" ] || [ "${ANTWORT}" = "201" ]; then
  USER_ID="$(kennung_aus < /tmp/bootstrap-admin.json)"
  echo "Konto ${EMAIL} angelegt."
else
  USER_ID="$(curl -sf "${AUTH[@]}" "${KONG}/auth/v1/admin/users?page=1&per_page=1000" \
    | python3 -c "import json,sys; print(next((u['id'] for u in json.load(sys.stdin)['users'] if u['email']=='${EMAIL}'),''))")"
  if [ -z "${USER_ID}" ]; then
    echo "Konto ${EMAIL} ließ sich weder anlegen (HTTP ${ANTWORT}) noch finden:" >&2
    head -c 400 /tmp/bootstrap-admin.json >&2; echo >&2
    exit 1
  fi
  # Das Konto gab es schon — Passwort setzen, sonst gilt still das alte.
  GESETZT="$(curl -s -o /tmp/bootstrap-admin.json -w '%{http_code}' "${AUTH[@]}" \
    -X PUT "${KONG}/auth/v1/admin/users/${USER_ID}" \
    -d "{\"password\":\"${PASSWORD}\",\"email_confirm\":true}")"
  if [ "${GESETZT}" != "200" ]; then
    echo "Passwort für ${EMAIL} ließ sich nicht setzen (HTTP ${GESETZT}):" >&2
    head -c 400 /tmp/bootstrap-admin.json >&2; echo >&2
    exit 1
  fi
  echo "Konto ${EMAIL} gab es schon — Passwort neu gesetzt."
fi
rm -f /tmp/bootstrap-admin.json

docker compose exec -T db psql -U postgres -d "${POSTGRES_DB}" -v ON_ERROR_STOP=1 -q <<SQL
insert into public.user_groups (user_id, group_id)
select '${USER_ID}'::uuid, id from public.groups where name = 'Plattform-Admins'
on conflict do nothing;
SQL

# Nachmessen statt behaupten: eine Anmeldung, die wirklich durchgeht.
PRUEFUNG="$(curl -s -o /dev/null -w '%{http_code}' \
  -H "apikey: ${ANON_KEY}" -H "Content-Type: application/json" \
  -X POST "${KONG}/auth/v1/token?grant_type=password" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}")"
if [ "${PRUEFUNG}" != "200" ]; then
  echo "Warnung: Anmeldung mit diesem Passwort schlägt fehl (HTTP ${PRUEFUNG})." >&2
  exit 1
fi

echo "Plattform-Admin ${EMAIL} (${USER_ID}) ist in 'Plattform-Admins'. Anmeldung geprüft."
