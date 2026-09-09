# ADR-0001: Supabase (self-hosted) ersetzt Directus als Identitäts- und CRUD-Schicht

Status: angenommen, 2026-09-09

## Kontext

`lumeapps` nutzt Directus 11 als Identity-Provider (HS256-Session-JWT) und als CRUD-Schicht für 11 Collections plus Dateiablage. Die Kopplung ist tief: 112 Auth-Dependency-Stellen, 6 Tabellen mit Directus-Datei-UUIDs, 4 nahezu identische Upload-Helfer, 4 Compose-Dienste nur für Directus, 3 CI-Guards. Die Auth-Prüfung im Backend ist unvollständig (kein Issuer, kein Pflicht-`exp`).

## Entscheidung

Supabase self-hosted (offizielles `supabase/docker`, gepinnt) liefert Auth (GoTrue), PostgREST, Storage und optional Realtime. Payload CMS wurde als Alternative bewertet und **nicht** als Plattform-Basis gewählt; es bleibt eine Option für den Signage-Stack (ADR-0005).

## Konsequenzen

- Postgres bleibt die eine Plattform-Datenbank. Alembic behält `public.*`, Supabase seine Schemata.
- Rechte über RLS und einen JWT-Claim `apps` (Custom Access Token Hook). Keine Rollen-UUIDs in `.env`.
- Kein Admin-Backend für Fachanwender; Pflegeseiten werden in Next.js gebaut.
- GoTrue kann kein LDAP; AD-Anbindung folgt über SAML oder Keycloak (ADR-0004).
- Rund ein Dutzend Container statt einem; `analytics` und `vector` werden deaktiviert.
- `service_role` nie im Browser; CI-Guard.
