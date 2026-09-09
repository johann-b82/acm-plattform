# ADR-0004: Active-Directory-Anbindung wird vorbereitet, aber später umgesetzt

Status: vertagt, 2026-09-09

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
