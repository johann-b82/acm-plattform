#!/usr/bin/env bash
# Legt den Break-Glass-Plattform-Admin an (GoTrue Admin-API) und hängt ihn in
# die Gruppe "Plattform-Admins" (app_grants: platform=admin). Idempotent.
# Usage: scripts/bootstrap-admin.sh <email> <passwort>
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"
EMAIL="${1:?email}"; PASSWORD="${2:?passwort}"
set -a; . ./.env; set +a

KONG="http://127.0.0.1:${KONG_HTTP_PORT}"
AUTH=(-H "apikey: ${SERVICE_ROLE_KEY}" -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" -H "Content-Type: application/json")

# Nutzer anlegen oder bestehenden finden
USER_ID=$(curl -sf "${AUTH[@]}" -X POST "${KONG}/auth/v1/admin/users" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\",\"email_confirm\":true}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin).get("id",""))' || true)
if [ -z "${USER_ID}" ]; then
  USER_ID=$(curl -sf "${AUTH[@]}" "${KONG}/auth/v1/admin/users?page=1&per_page=1000" \
    | python3 -c "import json,sys; print(next((u['id'] for u in json.load(sys.stdin)['users'] if u['email']=='${EMAIL}'),''))")
fi
[ -n "${USER_ID}" ] || { echo "Nutzer konnte nicht angelegt/gefunden werden" >&2; exit 1; }

docker compose exec -T db psql -U postgres -d "${POSTGRES_DB}" -v ON_ERROR_STOP=1 -q <<SQL
insert into public.user_groups (user_id, group_id)
select '${USER_ID}'::uuid, id from public.groups where name = 'Plattform-Admins'
on conflict do nothing;
SQL
echo "Plattform-Admin ${EMAIL} (${USER_ID}) ist in 'Plattform-Admins'."
