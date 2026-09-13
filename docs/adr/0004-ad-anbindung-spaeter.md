# ADR-0004: Active-Directory-Anbindung wird vorbereitet, aber später umgesetzt

Status: teils umgesetzt (Weg LDAPS-Bind), 2026-09-13 — vorher vertagt 2026-09-09

## Kontext

Nutzer und Gruppen sollen aus dem lokalen AD kommen und Rechte für einzelne Apps erhalten. Supabase Auth (GoTrue) unterstützt kein LDAP. Ob AD FS oder Entra ID mit AD Connect vorhanden ist, ist nicht bekannt.

## Entscheidung

Jetzt: Supabase Auth mit E-Mail/Passwort. Das Rechtemodell (`apps`, `groups`, `user_groups`, `app_grants`) wird so angelegt, dass Gruppen aus dem AD ohne Schemaänderung nachrüstbar sind: `groups.source in ('manual','ad')`, `groups.external_id` (objectSid), `synced_at`. Ein Sync-Job-Skelett in `compute` bleibt `NotImplemented`.

Später einer von drei Wegen:

| Weg | Voraussetzung | Wirkung |
|---|---|---|
| SAML über AD FS | AD FS vorhanden, HTTPS auf der Plattform | GoTrue-SSO-Provider, Gruppen als SAML-Attribut, echtes SSO |
| Keycloak mit LDAP-Federation vor GoTrue (OIDC) | ein weiterer Container | SSO, MFA, Gruppen-Claims; auch ohne AD FS |
| Token-Austausch mit LDAPS-Bind in `compute` | Read-Only-Dienstkonto, LDAPS erreichbar | Passwort im App-Login, GoTrue erhält per Admin-API einen Nutzer, Claim aus `user_groups`; kein SSO |

## Konsequenzen

- Nutzer-Migration aus `directus_users` per Einladung, Passwörter nicht portierbar.
- Break-Glass-Admin bleibt lokal, unabhängig vom AD.
- Entscheidung über den Weg, sobald AD FS/Entra-Status und Netzwerkzugriff geklärt sind.

## Umsetzung (2026-09-13): Weg 3 — LDAPS-Bind in `compute`

Auf Nutzerwunsch ist der dritte Weg gebaut: `compute` prüft Benutzer+Passwort per LDAPS-Bind, provisioniert den GoTrue-Nutzer und spiegelt die AD-Gruppen (`source='ad'`, `external_id`=Gruppen-DN) in `groups`/`user_groups`. App-Rechte vergibt weiter ein Admin je Gruppe. Ein Einmalpasswort setzt die Supabase-Sitzung, ohne dem Browser je ein Geheimnis zu zeigen.

- Konfiguration: `ad_konfiguration` (Migration 0055) + Dienstkonto-Passwort in `geheimnisse`; Einstellungssektion „Active Directory".
- Anmeldung: `POST /api/anmeldung/ad` (öffentlich, ratenbegrenzt), Login-Maske mit lokaler Rückfallanmeldung für den Break-Glass-Admin.
- Getestet gegen eine LDAP-Attrappe (Provisionierung, Gruppen-Sync, Entfernen verwaister AD-Mitgliedschaften, Schutz handgepflegter Gruppen).
- **Offen:** Verifikation gegen ein echtes AD (LDAPS erreichbar, Dienstkonto). Kein SSO — dafür bleibt SAML/AD FS oder Keycloak (Weg 1/2) eine spätere Option. HTTPS/TLS am DC in Produktion Pflicht (`tls_pruefen`).
