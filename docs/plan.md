# ACM-Plattform — Architektur- und Migrationsplan

Stand: 2026-09-09. Basis: sechs Codeanalysen des Altprojekts `lumeapps` (Auth/Directus-Kopplung, Signage, Logging, Security, Frontend, Backend) auf `main @ ffc9ba0`.

## 1. Entscheidungen (bestätigt am 2026-09-09)

| # | Entscheidung | Konsequenz |
|---|---|---|
| A | **Supabase (self-hosted) bleibt die Plattform-Basis.** Payload ist kein Ersatz. | Auth, Postgres, PostgREST, Storage, Realtime kommen aus dem Supabase-Stack. Directus entfällt. |
| B | **Payload nur als Option für Digital Signage.** Wird in einem zeitlich begrenzten Spike geprüft; ohne klaren Vorteil bleibt Signage bei FastAPI + bestehender React-Admin-UI. | Siehe Abschnitt 6.3 mit Bewertungskriterien. |
| C | **Python bleibt als schlanker Compute-Dienst.** | ~130 echte Python-Operationen (pandas-Parser, Dokumente, SNMP, Personio, SMB) bleiben. ~150 CRUD-Routen und ~55 KPI-Berechnungen verlassen Python. |
| D | **AD-Anbindung später.** | Datenmodell wird jetzt so angelegt, dass Gruppen aus dem AD nachrüstbar sind (`groups.source`). Login zunächst Supabase Auth mit E-Mail/Passwort. |
| E | **Signage auf demselben Host, möglichst isoliert.** | Eigenes Compose-Projekt, eigenes Netz, eigene Postgres, eigener Caddy auf eigenem Port, eigene Volumes unter eigenem Wurzelpfad, eigene Ressourcenlimits. |
| F | **Host-Änderungen (journald-Rotation) nur vorbereiten, nicht umsetzen.** | Konfigurationsdateien liegen unter `infra/host/`, werden nicht angewendet. |
| G | **Neues Projekt `acm-plattform`, saubere Codebasis, Historie wird nicht mitgeschleppt.** | Übernahme-/Löschliste in `docs/inventory.md`. |

## 2. Ist-Befund in Zahlen

| Kennzahl | Wert |
|---|---|
| Python (Backend) | 40.670 Zeilen, 34 Router, 67 Services, 20 Parser |
| TypeScript (Frontend) | 58.835 Zeilen, 53 Seiten, 141 Komponenten |
| Datenbank | 83 Tabellen, 105 Alembic-Migrationen |
| API | 335 Operationen, 270 Pfade |
| Tests | 125 Python-Testdateien, 51 Vitest-Dateien, 1 Playwright-Spec |
| Entwicklungstempo | 130 bis 160 Commits pro Monat |
| Compose-Dienste | 10 (davon 4 nur für Directus) |

Was gut ist und erhalten bleibt: Auth-Gates auf Router-Ebene mit CI-Test, getrennte Device-Trust-Domain für Signage, keine SQL-Injection-Oberfläche, keine Shell-Aufrufe mit Nutzereingaben, Fernet-verschlüsselte Secrets, KPI-Aggregation bereits in SQLAlchemy Core, vorhandene Indizes auf Datums- und Filterspalten, `docs/kpi-rechenwege.md` als belastbare KPI-Spezifikation.

## 3. Zielarchitektur

Zwei voneinander unabhängige Stacks auf demselben Host, die sich nur über HTTP kennen.

```
PLATTFORM-STACK (Compose-Projekt "acm")                 SIGNAGE-STACK (Compose-Projekt "signage")
────────────────────────────────────────                ─────────────────────────────────────────
Caddy :443 (TLS, Security-Header, Body-Limit)           Caddy :8443 (eigene Instanz)
  ├─ /            → web (Next.js 16)                      ├─ /player/*         → signage-api (Bundle im Image)
  ├─ /api/*       → compute (FastAPI, schlank)            ├─ /api/signage/*    → signage-api (SSE, Pairing, Assets)
  └─ /supabase/*  → kong (Supabase-Gateway)               └─ /admin/*          → Signage-Admin (React, oder Payload im Spike)
web  ──► supabase-js (PostgREST, Auth, Storage)          signage-api ──► Postgres (signage), eigenes Alembic
compute ──► Postgres (direkt, asyncpg), prüft Supabase-JWT   Medien-Volume /srv/signage/media
Supabase: db, auth, rest, storage, realtime, kong,      Pi-Kiosks: SIGNAGE_API_URL = https://host:8443
          meta, studio, imgproxy, (analytics optional)
Postgres 17: public.* (Alembic), auth.*, storage.*      Embeds der Plattform per absoluter, signierter URL
```

### 3.1 Verantwortlichkeiten

| Bereich | Alt (lumeapps) | Neu (acm-plattform) |
|---|---|---|
| Login, Sessions | Directus HS256-Cookie, Rollen-UUIDs in `.env` | Supabase Auth (GoTrue), Cookie-Sessions via `@supabase/ssr` |
| Rechte | 3 feste Rollen, QS hartkodiert | `apps` / `groups` / `app_grants`, Claim `apps` per Custom Access Token Hook, RLS |
| CRUD | ~150 FastAPI-Routen + 11 Directus-Collections | PostgREST über supabase-js, Next.js Server Actions, RLS |
| KPI-Berechnung | SQLAlchemy Core, je Bucket eine Query | Postgres-Views und -Funktionen, gelesen aus Server Components |
| Parsing, Dokumente, Integrationen | FastAPI | FastAPI `compute`, unverändert, verschlankt |
| Dateien | `directus_files` + Bind-Mount | Supabase Storage (Buckets `hr-dokumente`, `fair`, `maintenance`, `zeugnisse`, `newsletter`) |
| Geplante Jobs | APScheduler im API-Prozess | Aufräum-Jobs `pg_cron`, Sync-Jobs in `compute`, Signage-Jobs in `signage-api` |
| DDL | Alembic für `public.*` | Alembic für `public.*` bleibt alleiniger Eigentümer. Supabase-Schemata (`auth`, `storage`) gehören Supabase. |
| Realtime | Signage-SSE via LISTEN/NOTIFY | Plattform: Supabase Realtime nur wo nötig. Signage: eigenes SSE bleibt. |

### 3.2 Supabase self-hosted konkret

- Grundlage ist das offizielle `supabase/docker`-Verzeichnis (`infra/supabase/fetch-upstream.sh` holt eine gepinnte Version). Keine handgeschriebene Nachbildung.
- Kong wird **nicht** direkt veröffentlicht, sondern über den Plattform-Caddy unter `/supabase/*` gleicher Origin. Kein CORS.
- Studio nur für Admins, über Caddy mit Basic-Auth oder nur auf `127.0.0.1`.
- `service_role`-Key ausschließlich in `compute` und Server-seitigem Next.js-Code. Niemals im Browser-Bundle. CI-Guard.
- Postgres bleibt die eine Datenbank für Plattformdaten. Alembic migriert `public.*`, Supabase-eigene Migrationen laufen in ihren Schemata. `pg_cron` für Retention.
- Analytics/Logflare und Vector aus dem Upstream-Compose **deaktivieren** (Log-Volumen, Plattenlast). Das ist der eine Punkt, an dem Supabase dem Log-Ziel widerspricht.

### 3.3 Rechtemodell

```sql
create table public.apps       (id text primary key, name text not null, path text not null, sort int not null);
create table public.groups     (id uuid primary key default gen_random_uuid(), name text not null unique,
                                source text not null default 'manual' check (source in ('manual','ad')),
                                external_id text unique, synced_at timestamptz);
create table public.user_groups(user_id uuid references auth.users(id) on delete cascade,
                                group_id uuid references public.groups(id) on delete cascade,
                                primary key (user_id, group_id));
create table public.app_grants (group_id uuid references public.groups(id) on delete cascade,
                                app_id text references public.apps(id) on delete cascade,
                                level text not null check (level in ('viewer','editor','admin')),
                                primary key (group_id, app_id));
```

Ein Custom Access Token Hook (Postgres-Funktion, in Supabase Auth registriert) schreibt beim Login den effektiven Claim `apps` (`{"sales":"viewer","atr":"admin"}`) ins JWT. Next.js-Middleware, RLS-Policies (`auth.jwt() -> 'apps'`) und `compute` prüfen denselben Claim. Ein Break-Glass-Admin bleibt lokal. Die AD-Anbindung füllt später nur `groups` (`source = 'ad'`) und `user_groups`, sonst ändert sich nichts.

### 3.4 Was mit Supabase schwerer ist als mit Payload (zur Transparenz)

- Kein Admin-Backend für Fachanwender. Pflege von `app_grants` und Stammdaten braucht eigene Next.js-Seiten. Studio ist ein Entwicklerwerkzeug.
- Kein LDAP in GoTrue. AD später über SAML (AD FS) oder Keycloak davor, oder eigener Token-Austausch.
- Rund ein Dutzend Container statt einem. Ressourcen- und Log-Konfiguration je Container nötig.

Diese Punkte sind bekannt und akzeptiert (Entscheidung A).

## 4. Rechte, Auth, AD

- Phase 2 liefert Supabase Auth mit E-Mail/Passwort, das Rechtemodell aus 3.3 und die Next.js-Shell (Login, Launcher, Middleware).
- Nutzer werden aus `directus_users` migriert (E-Mail, Name). Passwörter sind nicht portierbar; Einladungs-Flow mit Passwort-Reset.
- AD (Entscheidung D, später): Vorgesehen sind drei Wege, bewertet in `docs/adr/0004-ad-anbindung-spaeter.md`. Nichts davon wird jetzt gebaut. Vorbereitung: `groups.source`, `groups.external_id`, Sync-Job-Skelett in `compute` mit `NotImplemented`.

## 5. Sicherheitsbefunde

21 Befunde im Altprojekt, 5 hoch. Vollständige Tabelle in `docs/security-findings.md`. Die hohen:

| Befund | Ort (lumeapps) | Behebung |
|---|---|---|
| Vite-Dev-Server in Produktion, Port 5173 im LAN | `docker-compose.yml:90-105` | Neu: nur gebautes Next.js hinter Caddy. Alt: Prod-Override in Phase 0. |
| API mit `--reload`, als root, Quellcode rw gemountet, Port 8000 im LAN | `docker-compose.yml:57,68-71` | Neu: non-root, kein Mount, keine Host-Ports außer Caddy. Alt: Prod-Override in Phase 0. |
| JWT ohne Issuer, ohne Pflicht-`exp`, ohne Token-Typ | `directus_auth.py:46-66` | Entfällt mit Supabase-JWT (aud/iss/exp verpflichtend). Alt: Hotfix in Phase 0. |
| Öffentliche Personaldaten in HR-Embeds inkl. Geburtsdatum und Foto-Enumeration | `hr_embed.py` | Signierte Embed-Tokens, Geburtsdatum raus, Foto-Proxy cachen. |
| Nur HTTP, keine Security-Header, kein Body-Limit | `caddy/Caddyfile` | Neu: TLS, Header-Block, `request_body max_size` von Anfang an. |

## 6. Signage

### 6.1 Belegte Ausfallursachen bei Deployments

1. Geteilter API-Prozess mit `--reload`: jeder Neustart kappt SSE, LISTEN-Kanal, laufende PPTX-Konvertierungen. Sidecar geht nach 30 s offline.
2. Geteiltes `frontend/dist` mit `emptyOutDir`: Admin-Build leert `dist/player`; startet die API währenddessen, fehlt der Player-Mount dauerhaft.
3. Geteilte Alembic-Kette: eine fehlgeschlagene fremde Migration blockiert den API-Start.
4. Geteilter Caddy: Reload kappt SSE, `depends_on directus` verzögert die Player-URL.

### 6.2 Isolation auf demselben Host (Entscheidung E)

| Maßnahme | Umsetzung |
|---|---|
| Eigenes Compose-Projekt | `signage/docker-compose.yml`, `COMPOSE_PROJECT_NAME=signage`, eigenes Repo `acm-signage` |
| Eigenes Netz | Compose-Default-Netz des Projekts, keine `external`-Netze zur Plattform |
| Eigene Datenbank | `postgres:17-alpine` nur für Signage, 10 Tabellen, eigene Alembic-Kette, NOTIFY-Trigger ziehen mit |
| Eigener Reverse-Proxy | eigene Caddy-Instanz auf `:8443`, SSE-Einstellungen (`flush_interval -1`, 24h Timeouts) bleiben |
| Eigene Volumes | Wurzel `/srv/signage/{postgres,media,caddy}`; nichts unter dem Plattform-Pfad |
| Player-Bundle im Image | Build im `signage-api`-Dockerfile, kein geteiltes Volume, kein Existenz-Check zur Importzeit |
| Ressourcenlimits | `deploy.resources.limits` für CPU/Memory, damit ein Plattform-Lastfall Signage nicht verdrängt (soweit Compose es durchsetzt) |
| Eigene Log-Regel | gleicher `x-logging`-Anker, eigener Guard |
| Einzige Kopplung | Embeds als absolute, signierte URLs auf die Plattform. Admin-Aufrufe prüfen das Plattform-JWT (JWKS von Supabase). Player brauchen die Plattform nie. |

Grenze der Isolation: ein Host, ein Docker-Daemon, eine Platte. Ein voller Datenträger oder ein Daemon-Neustart trifft beide Stacks. Das ist mit Entscheidung E akzeptiert.

### 6.3 Payload als Option für Signage (Entscheidung B)

Zeitlich begrenzter Spike (eine Woche) **nach** Phase 1, nicht davor. Phase 1 macht den reinen Umzug mit der bestehenden Python-API und React-Admin-UI, weil das der kürzeste Weg zu „Deployments treffen keine Screens“ ist.

Bewertungskriterien für den Spike:

| Kriterium | Frage |
|---|---|
| Codeabbau | Ersetzt Payload mehr Code (React-Signage-Admin ~3.000 Zeilen, Directus-Medienpfad, 4 Upload-Helfer), als es neu hinzufügt (Custom Endpoints für Pairing, Device-JWT, SSE, Resolver, PPTX)? |
| Redaktion | Sollen Nicht-Entwickler Medien und Playlists pflegen? Dann zählt das fertige Admin-UI mit Upload, Bildgrößen, Zugriffsregeln. |
| Laufzeit | Zwei Laufzeiten (Node für Payload, Python für soffice/pdftoppm) im isolierten Stack, oder Konvertierung in Node nachbauen? |
| Betrieb | Payload pinnt die Next.js-Version. Ein weiteres Framework im Haus. |

Erwartung nach heutigem Stand: Vorteil nur, wenn Redakteure ohne Entwickler Inhalte pflegen sollen. Ohne diesen Bedarf bringt Payload keinen Codeabbau und bleibt draußen.

## 7. Logging und Festplatte

Ursache des Vorfalls: Caddy-Access-Log für jeden Request plus Vite-Dev-Server, dazu Uvicorn-Access-Log (~13.000 Zeilen pro Pi und Tag). Das Anwendungs-Logging in Python hat keinen Handler und ist unsichtbar.

Bereits umgesetzt im Altprojekt (PR #142): Caddy `level ERROR`, Uvicorn `--no-access-log`, Rotation 3×10 MB für alle Dienste, `sensor_poll_log` 14 Tage, Sweeper loggt nur bei Änderung, Backup-`.tmp`-Fix, Pi-journald-Limits, CI-Guard E.

Für die neue Plattform von Anfang an:
- Jeder Dienst mit `logging`-Anker, Guard im CI.
- Supabase-Upstream: `analytics` (Logflare) und `vector` deaktiviert.
- Python-Logging bekommt einen echten Handler (stdout, WARNING, JSON), damit Fehler sichtbar sind, ohne Rauschen.
- `pg_cron`-Retention statt Scheduler-Jobs.
- Host-journald-Regel vorbereitet in `infra/host/`, **nicht angewendet** (Entscheidung F).

## 8. Backend-Effizienz (Arbeitsliste Phase 4)

- Bucket-Schleifen in 9 History-Endpunkten, bis zu 124 Roundtrips pro Diagramm. Ziel: eine Query mit `GROUP BY date_trunc()` als View.
- pandas blockiert die Event-Loop in 17 Upload-Endpunkten. Ziel: `run_in_threadpool`.
- N+1: `sensors.py:302`, `kompetenzen.py:509`, `schulungen.py:1222`, `atr.py:316`.
- Sales-KPIs (`compute_contacts_weekly`, 185 Zeilen Python-Dicts) sind der größte View-Gewinn.
- Indizes fehlen auf `schulung_*`, `kompetenz_*`, `onboarding_*`, `einarbeitung_*`.

## 9. Phasenplan

Aufwände in Kalenderwochen für eine Person mit KI-Unterstützung bei parallel laufender Feature-Entwicklung. Jede Phase endet produktiv.

| Phase | Inhalt | Dauer | Fertig, wenn |
|---|---|---|---|
| 0 Betrieb absichern (Altprojekt) | Logging (PR #142, offen), CI grün (PR #143, offen), Security-Hochbefunde als Prod-Override, JWT-Hotfix, Sidecar-Cache-Bug | 1 bis 2 W | Platte wächst < 50 MB/Woche, Ports 5173/8000 nicht im LAN, CI grün |
| 1 Signage herauslösen | Repo `acm-signage`, eigener Stack nach 6.2, Datenmigration, Admin-UI auf REST, Embeds signiert, Pis umziehen | 3 bis 4 W | `docker compose restart` der Plattform beeinflusst keinen Screen |
| 1b Signage-Admin-UI | Oberfläche als App-Kachel in der Plattform gegen die REST-API (erledigt 2026-09-09) | 1 W | Medien, Playlists, Zeitpläne, Geräte, Kopplung laufen ohne Directus |
| 1c Payload-Spike | Kriterien aus 6.3 | 1 W | Entscheidung dokumentiert in ADR |
| 2 Supabase + Next.js-Shell | Supabase-Stack, Auth, Rechtemodell, Login, Launcher, Middleware, `compute` prüft Supabase-JWT, Nutzer-Migration | 4 bis 6 W | Nutzer sehen genau ihre App-Kacheln, Directus-Login aus |
| 3 Directus entfernen | Dateien nach Storage (6 UUID-Spalten remappen), 11 Collections nach PostgREST/RLS, 4 Compose-Dienste und 3 CI-Guards weg | 2 bis 3 W | kein `DIRECTUS_*` mehr |
| 4 Module portieren, Backend verschlanken | Reihenfolge: KPI-Views → Settings → Quality/Audit → Produktion/Wartung → HR-Module → Newsletter/Feedback → ATR/FAIR. Je Modul: CRUD nach PostgREST, Berechnung nach SQL, Seite als Client Component, alte Route abschalten | 10 bis 16 W | `compute` unter 150 Routen |
| 5 Härtung | CSRF, Rate-Limits hinter Proxy, Upload-Limits, Content-Disposition, Prod-Images ohne Dev-Deps, Monitoring Plattenfüllstand | 2 W | alle 21 Befunde geschlossen oder dokumentiert akzeptiert — **erreicht 2026-09-10** (PRs #145–#151 im Altprojekt, Stand in `docs/security-findings.md`); offen bleiben TLS und die Zertifikatsrotation, beide auf dem Host |

Reihenfolge: Signage vor Identität (größter Betriebsschmerz, unabhängig von Supabase). Identität vor Directus-Ausbau. Module zuletzt, weil sie einzeln liefern.

## 10. Saubere Codebasis (Entscheidung G)

`acm-plattform` startet ohne Historie. Die Übernahmeliste je Modul und die konkrete Löschliste stehen in `docs/inventory.md`. Grundsätze:

- Kein Directus, kein Paperless/Stirling/OpenProject-Rest, kein `auth_forward`, keine Phase-Grep-Guards, keine `sample_export.csv`.
- Fachlogik wird **übernommen**, nicht neu erfunden: Parser, Dokument-Services, Integrationen, KPI-Rechenwege, Locales, Dashboards.
- Jede übernommene Datei wird beim Umzug auf Directus-Referenzen, tote Settings und Legacy-Tabellen (`sales_records`) geprüft.
- Doku ist Teil der Definition of Done je Modul: `docs/modules/<modul>.md` mit Datenquelle, Rechenweg, Rechten.

## 11. Offene Punkte

- Payload-Spike: erst nach Phase 1, Entscheidung per ADR.
- AD: Zeitpunkt und Weg (AD FS / Keycloak / Token-Austausch) offen, siehe ADR-0004.
- journald auf dem Host: vorbereitet, Freigabe zur Anwendung steht aus.
- Pre-existing CI-Fehler `test_convert_pptx_corrupt_pptx` im Altprojekt (LibreOffice konvertiert das „korrupte“ Fixture erfolgreich): eigene Untersuchung.
