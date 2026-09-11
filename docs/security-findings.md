# Sicherheitsbefunde aus der Analyse von `lumeapps` (2026-09-09)

21 Befunde: 5 hoch, 10 mittel, 6 niedrig. Ort bezieht sich auf `lumeapps @ ffc9ba0`. Spalte „Neu“ sagt, wie `acm-plattform` den Befund strukturell vermeidet; Spalte „Alt“ die Zwischenlösung im Altprojekt.

**Stand 2026-09-10:** 18 der 21 Befunde sind im Altprojekt abgearbeitet (PRs #145–#151). Offen bleiben drei bewusst — sie stehen unten unter „Bewusst offen im Altprojekt“ mit Begründung. Spalte „Stand“: ✅ erledigt, ⏸ bewusst offen, 🔧 vor Ort.

| # | Schwere | Befund | Ort | Neu | Alt | Stand |
|---|---|---|---|---|---|---|
| 1 | Hoch | Vite-Dev-Server in Produktion, `0.0.0.0:5173`, `allowedHosts: true` | `docker-compose.yml:90-105` | Nur gebautes Next.js hinter Caddy, keine Host-Ports außer Caddy | Prod-Compose-Override | ✅ #146 |
| 2 | Hoch | API mit `--reload`, als root, Quellcode rw gemountet, `0.0.0.0:8000` | `docker-compose.yml:57,68-71`, `backend/Dockerfile:26` | non-root `USER`, kein Mount, kein `--reload`, Ports nur intern | Prod-Override, `USER` im Dockerfile | ✅ #146 |
| 3 | Hoch | JWT-Prüfung ohne `issuer`, ohne Pflicht-`exp`, ohne Token-Typ; jedes Directus-signierte Token mit Rollen-UUID ist gültig | `security/directus_auth.py:46-66` | Supabase-JWT: `aud`, `iss`, `exp` verpflichtend, JWKS | `issuer="directus"`, `require=["exp","iat"]`, Share-/Reset-Claims ablehnen | ✅ #145 |
| 4 | Hoch | Öffentliche Personaldaten (Name, Geburtsdatum, Alter, Eintritt) und per ID enumerierbarer Foto-Proxy | `routers/hr_embed.py:40-203` | Signierter Embed-Token, Geburtsdatum aus Payload, Foto-Cache + Rate-Limit | dito | ✅ #147 |
| 5 | Hoch | Nur HTTP, keine Security-Header, kein Body-Limit, kein Rate-Limit | `caddy/Caddyfile` | TLS, `header`-Block (CSP, nosniff, frame-ancestors, Referrer-Policy), `request_body max_size` | TLS mit interner CA, Header-Block | ✅ #148 (Header), 🔧 TLS vor Ort |
| 6 | Mittel | Rate-Limit sieht hinter Caddy nur die Proxy-IP (globaler Bucket), gilt für eine Route | `security/rate_limit.py:20-44` | `X-Forwarded-For` mit Trusted-Proxy, Store in Postgres, Pairing/Feedback/Uploads | dito | ✅ #147 |
| 7 | Mittel | Device-JWT ohne Ablauf, in Query-Strings, in Caddy-Logs | `services/signage_pairing.py:50-65`, `device_auth.py:44-55` | Signage-Repo: kurzes `exp`, Query-Token nur für SSE, Log-Redaction | Caddy `level ERROR` (PR #142) entfernt die Logspur | ✅ #142 |
| 8 | Mittel | Rolle nur aus JWT-Claim, kein Abgleich; Sperrung wirkt erst nach Ablauf; Audit-E-Mail ist Platzhalter | `directus_auth.py:54-74` | Supabase-Session, Claim per Hook bei jedem Refresh, echte E-Mail | Session-TTL verkürzen | ✅ #151 |
| 9 | Mittel | Cookie-Auth ohne CSRF-Schutz; Multipart-Uploads cross-site erreichbar, nur `SameSite=Lax` schützt | `directus_auth.py:35-42` | Custom-Header-Pflicht für Mutationen, `SameSite=Strict` | dito | ✅ #150 |
| 10 | Mittel | Uploads ohne Größenlimit vor pandas/openpyxl, kein `defusedxml`, Newsletter-8-MB-Limit erst nach vollständigem Lesen | `uploads.py`, `atr.py`, `kompetenzen.py`, `schulungen.py`, `newsletter.py` | `read(MAX+1)`-Muster, Caddy-Body-Limit, `defusedxml.defuse_stdlib()` | dito | ✅ #148 |
| 11 | Mittel | CI-Gate-Test überspringt Routen mit einer allowlisted Methode komplett; Allowlist-Einträge prüfen nichts | `tests/test_admin_gate_audit.py:152-159` | Prüfung je Methode, Allowlist-Routen müssen ein Auth-Dep tragen | dito | ✅ #150 |
| 12 | Mittel | TLS-Private-Key im Repo (mkcert, gültig bis 2028), `certs/` nicht ignoriert | `certs/internal.key` | Zertifikate je Umgebung außerhalb des Repos | Löschen, rotieren, `.gitignore` | ✅ #145, 🔧 Rotation vor Ort |
| 13 | Mittel | Nutzerdateien inline auf App-Origin mit DB-MIME; Newsletter vertraut Client-Content-Type | `settings.py:449`, `schulungen.py:1520`, `newsletter.py:378` | Storage-Bucket-Origin, `Content-Disposition: attachment`, nosniff, Magic-Bytes | dito | ✅ #149 |
| 14 | Mittel | `/health` gibt Exception-Text mit DB-Host/User aus | `main.py:143-150` | nacktes 503 | dito | ✅ #149 |
| 15 | Niedrig | `Content-Disposition` mit unsanitisierten Dateinamen an 6 Stellen | `onboarding.py:705`, `einarbeitung.py`, `zeugnisse.py` | ein `safe_filename()`-Helfer | dito | ✅ #149 |
| 16 | Niedrig | Admin-konfigurierbare SMB-/SNMP-Ziele (Post-Auth-SSRF, NTLM-Relay) | `settings.py:485`, `sensors.py` | Ziel-Allowlist auf Subnetze, als Admin-Fähigkeit dokumentiert | dito | ⏸ akzeptiert |
| 17 | Niedrig | `_unc()` filtert `..` nicht, Schutz liegt nur beim Aufrufer | `services/atr_fileserver.py:60-89` | `..` in `_unc()` ablehnen | dito | ✅ #150 |
| 18 | Niedrig | Backups 0644; `.env` komplett in jeden Container geladen | `backup/dump.sh`, `docker-compose.yml` | `umask 077`, `.env` je Dienst | dito | ✅ #151 (0600), ⏸ `.env` je Dienst |
| 19 | Niedrig | Device-JWT in Antwort auf unauthentifizierten GET mit Session-ID im Query | `signage_pair.py:119-167` | Signage-Repo: POST | mit Log-Redaction akzeptabel | ⏸ akzeptiert |
| 20 | Niedrig | Dev-Deps und Test-Suite im Prod-Image | `backend/Dockerfile:5-6` | Multi-Stage-Build | dito | ✅ #151 |
| 21 | Niedrig | QS-Rolle sieht KPI-Review-Kommentare (Gate ist nur `get_current_user`) | `kpi_review.py:54`, `feedback.py:50` | entfällt mit App-Rechten | `require_dashboard_read` | ✅ #150 |

## Bewusst offen im Altprojekt

Drei Befunde bleiben im Altsystem stehen. Nicht aus Versehen — jeder hat einen Grund, der schwerer wiegt als der Befund.

| # | Punkt | Warum offen |
|---|---|---|
| 16 | Admin-konfigurierbare SMB-/SNMP-Ziele | Ein Admin, der ein Dateiserver-Ziel einträgt, tut genau das, wofür die Maske da ist. Eine Subnetz-Allowlist nachzurüsten heißt, den ATR-Dateiweg auf einem System zu verändern, das in Kürze abgelöst wird — und ihn dabei vor Ort brechen zu können. Als Admin-Fähigkeit dokumentiert, nicht als Lücke. |
| 18b | `.env` komplett in jedem Container | Sauber aufzuteilen heißt, die Datei zu zerlegen, die der Betreiber beim Cutover einsetzt. Für einen niedrigen Befund das falsche Risiko zum falschen Zeitpunkt. Der neue Stack macht es je Dienst richtig. |
| 19 | Geräte-JWT in der Antwort auf einen GET | Der Kopplungsweg braucht ihn dort, und seit PR #142 loggt Caddy keine erfolgreichen Anfragen mehr — die Logspur, die den Befund gefährlich machte, ist weg. Der Signage-Stack löst es mit POST. |

Dazu vier Stellen, an denen die umgesetzte Lösung bewusst von der oben vorgeschlagenen abweicht:

- **Befund 4, signierter Embed-Token.** Nicht umgesetzt: er hieße, vor Ort jeden Signage-Playlist-Eintrag neu zu setzen. Stattdessen Datenminimierung (kein Geburtsdatum, kein Alter) und ein Foto-Weg, der nur für gerade gezeigte Personen antwortet. Rest-Risiko: Name, Abteilung und Geburtstag als Tag/Monat sind im LAN weiter ohne Anmeldung lesbar — genau das, was auch am Board im Flur hängt. **Im neuen Stack erledigt:** die Anzeigen unter `/embed/*` verlangen einen signierten, ablaufenden Token je Playlist-Eintrag; das Neusetzen der Einträge fällt beim Pi-Cutover ohnehin an. Siehe `docs/modules/anzeigen.md`.
- **Befund 10, `defusedxml`.** Nicht eingebaut: openpyxl liegt hier auf lxml (`openpyxl.xml.LXML` ist `True`) und baut seinen Parser mit `resolve_entities=False`; lxml lädt externe DTDs von sich aus nicht. `defuse_stdlib()` flickt die stdlib-`ElementTree`, die gar nicht benutzt wird. Der reale Weg war die Dekompressionsbombe — nachgemessen 204 KB → 200 MB — und dagegen hilft die Archivprüfung, nicht ein XML-Parser.
- **Befund 13, magische Bytes.** Nicht nötig: `nosniff` plus eine Liste erlaubter Typen nehmen ihr die Arbeit ab. Wer HTML als `application/pdf` ablegt, bekommt ein PDF, das sich nicht öffnen lässt — ausgeführt wird es nicht. Der Logo-Weg in `settings.py` prüft sie ohnehin schon, samt `nh3`-Reinigung für SVG; den habe ich deshalb unangetastet gelassen.
- **Befund 9, `SameSite=Strict`.** Nicht gesetzt: das Cookie stellt Directus aus, die Einstellung liegt dort. Der Riegel liegt jetzt auf unserer Seite — eine Kopfzeile, die ursprungsübergreifend nicht zu setzen ist.

## Bewusst offene Punkte im neuen Stack

| Punkt | Stand | Warum vorerst so |
|---|---|---|
| `compute` verbindet sich als `postgres` | offen | Der Dienst ist der einzige Schreiber der Ingestionstabellen und umgeht damit RLS — das ist gewollt, der Importpfad ist kein Leser. Eine eigene Rolle mit engeren Rechten scheitert bislang daran, dass ihr Passwort sonst in einer Migration stünde. In der Härtung (Phase 5) mit einem eigenen Secret nachholen. |
| Kein TLS im lokalen Betrieb | offen | Phase 5. Caddy setzt bereits Security-Header und ein Body-Limit. |
| Studio nur über Kong auf 127.0.0.1 | akzeptiert | Kein Host-Port, Zugriff über SSH-Tunnel. |

Geprüft und unauffällig: keine SQL-String-Interpolation (beide `text()`-Blöcke parametrisiert), keine nutzergesteuerten `ORDER BY`, keine `os.system`/`shell=True`/`eval`/`pickle`, Pfad-Traversal in `main.py:130-140` und `signage_player.py:241-247` korrekt geblockt, Secrets Fernet-verschlüsselt und nie geloggt, `pyjwt` mit festem `algorithms=["HS256"]`, Pairing-Codes aus `secrets.choice` (31⁶ Kombinationen) mit atomarem Claim, Postgres und Directus nur auf `127.0.0.1`, kein `dangerouslySetInnerHTML`/`rehype-raw` im Frontend, Sidecar-Token `0600`.
