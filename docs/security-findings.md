# Sicherheitsbefunde aus der Analyse von `lumeapps` (2026-09-09)

21 Befunde: 5 hoch, 10 mittel, 6 niedrig. Ort bezieht sich auf `lumeapps @ ffc9ba0`. Spalte „Neu“ sagt, wie `acm-plattform` den Befund strukturell vermeidet; Spalte „Alt“ die Zwischenlösung im Altprojekt (Phase 0/5).

| # | Schwere | Befund | Ort | Neu | Alt |
|---|---|---|---|---|---|
| 1 | Hoch | Vite-Dev-Server in Produktion, `0.0.0.0:5173`, `allowedHosts: true` | `docker-compose.yml:90-105` | Nur gebautes Next.js hinter Caddy, keine Host-Ports außer Caddy | Prod-Compose-Override |
| 2 | Hoch | API mit `--reload`, als root, Quellcode rw gemountet, `0.0.0.0:8000` | `docker-compose.yml:57,68-71`, `backend/Dockerfile:26` | non-root `USER`, kein Mount, kein `--reload`, Ports nur intern | Prod-Override, `USER` im Dockerfile |
| 3 | Hoch | JWT-Prüfung ohne `issuer`, ohne Pflicht-`exp`, ohne Token-Typ; jedes Directus-signierte Token mit Rollen-UUID ist gültig | `security/directus_auth.py:46-66` | Supabase-JWT: `aud`, `iss`, `exp` verpflichtend, JWKS | `issuer="directus"`, `require=["exp","iat"]`, Share-/Reset-Claims ablehnen |
| 4 | Hoch | Öffentliche Personaldaten (Name, Geburtsdatum, Alter, Eintritt) und per ID enumerierbarer Foto-Proxy | `routers/hr_embed.py:40-203` | Signierter Embed-Token, Geburtsdatum aus Payload, Foto-Cache + Rate-Limit | dito |
| 5 | Hoch | Nur HTTP, keine Security-Header, kein Body-Limit, kein Rate-Limit | `caddy/Caddyfile` | TLS, `header`-Block (CSP, nosniff, frame-ancestors, Referrer-Policy), `request_body max_size` | TLS mit interner CA, Header-Block |
| 6 | Mittel | Rate-Limit sieht hinter Caddy nur die Proxy-IP (globaler Bucket), gilt für eine Route | `security/rate_limit.py:20-44` | `X-Forwarded-For` mit Trusted-Proxy, Store in Postgres, Pairing/Feedback/Uploads | dito |
| 7 | Mittel | Device-JWT ohne Ablauf, in Query-Strings, in Caddy-Logs | `services/signage_pairing.py:50-65`, `device_auth.py:44-55` | Signage-Repo: kurzes `exp`, Query-Token nur für SSE, Log-Redaction | Caddy `level ERROR` (PR #142) entfernt die Logspur |
| 8 | Mittel | Rolle nur aus JWT-Claim, kein Abgleich; Sperrung wirkt erst nach Ablauf; Audit-E-Mail ist Platzhalter | `directus_auth.py:54-74` | Supabase-Session, Claim per Hook bei jedem Refresh, echte E-Mail | Session-TTL verkürzen |
| 9 | Mittel | Cookie-Auth ohne CSRF-Schutz; Multipart-Uploads cross-site erreichbar, nur `SameSite=Lax` schützt | `directus_auth.py:35-42` | Custom-Header-Pflicht für Mutationen, `SameSite=Strict` | dito |
| 10 | Mittel | Uploads ohne Größenlimit vor pandas/openpyxl, kein `defusedxml`, Newsletter-8-MB-Limit erst nach vollständigem Lesen | `uploads.py`, `atr.py`, `kompetenzen.py`, `schulungen.py`, `newsletter.py` | `read(MAX+1)`-Muster, Caddy-Body-Limit, `defusedxml.defuse_stdlib()` | dito |
| 11 | Mittel | CI-Gate-Test überspringt Routen mit einer allowlisted Methode komplett; Allowlist-Einträge prüfen nichts | `tests/test_admin_gate_audit.py:152-159` | Prüfung je Methode, Allowlist-Routen müssen ein Auth-Dep tragen | dito |
| 12 | Mittel | TLS-Private-Key im Repo (mkcert, gültig bis 2028), `certs/` nicht ignoriert | `certs/internal.key` | Zertifikate je Umgebung außerhalb des Repos | Löschen, rotieren, `.gitignore` |
| 13 | Mittel | Nutzerdateien inline auf App-Origin mit DB-MIME; Newsletter vertraut Client-Content-Type | `settings.py:449`, `schulungen.py:1520`, `newsletter.py:378` | Storage-Bucket-Origin, `Content-Disposition: attachment`, nosniff, Magic-Bytes | dito |
| 14 | Mittel | `/health` gibt Exception-Text mit DB-Host/User aus | `main.py:143-150` | nacktes 503 | dito |
| 15 | Niedrig | `Content-Disposition` mit unsanitisierten Dateinamen an 6 Stellen | `onboarding.py:705`, `einarbeitung.py`, `zeugnisse.py` | ein `safe_filename()`-Helfer | dito |
| 16 | Niedrig | Admin-konfigurierbare SMB-/SNMP-Ziele (Post-Auth-SSRF, NTLM-Relay) | `settings.py:485`, `sensors.py` | Ziel-Allowlist auf Subnetze, als Admin-Fähigkeit dokumentiert | dito |
| 17 | Niedrig | `_unc()` filtert `..` nicht, Schutz liegt nur beim Aufrufer | `services/atr_fileserver.py:60-89` | `..` in `_unc()` ablehnen | dito |
| 18 | Niedrig | Backups 0644; `.env` komplett in jeden Container geladen | `backup/dump.sh`, `docker-compose.yml` | `umask 077`, `.env` je Dienst | dito |
| 19 | Niedrig | Device-JWT in Antwort auf unauthentifizierten GET mit Session-ID im Query | `signage_pair.py:119-167` | Signage-Repo: POST | mit Log-Redaction akzeptabel |
| 20 | Niedrig | Dev-Deps und Test-Suite im Prod-Image | `backend/Dockerfile:5-6` | Multi-Stage-Build | dito |
| 21 | Niedrig | QS-Rolle sieht KPI-Review-Kommentare (Gate ist nur `get_current_user`) | `kpi_review.py:54`, `feedback.py:50` | entfällt mit App-Rechten | `require_dashboard_read` |

Geprüft und unauffällig: keine SQL-String-Interpolation (beide `text()`-Blöcke parametrisiert), keine nutzergesteuerten `ORDER BY`, keine `os.system`/`shell=True`/`eval`/`pickle`, Pfad-Traversal in `main.py:130-140` und `signage_player.py:241-247` korrekt geblockt, Secrets Fernet-verschlüsselt und nie geloggt, `pyjwt` mit festem `algorithms=["HS256"]`, Pairing-Codes aus `secrets.choice` (31⁶ Kombinationen) mit atomarem Claim, Postgres und Directus nur auf `127.0.0.1`, kein `dangerouslySetInnerHTML`/`rehype-raw` im Frontend, Sidecar-Token `0600`.
