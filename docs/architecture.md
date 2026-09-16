# Zielarchitektur

Kurzfassung. Begründungen in `docs/plan.md`, Entscheidungen in `docs/adr/`.

## Topologie

```
Host (Linux, 192.9.201.9)
│
├── Compose-Projekt "acm"  (/home/acm/acm-plattform)
│   ├── caddy       :443  TLS, Security-Header, Body-Limit, Access-Log nur Fehler
│   │     /           → web
│   │     /api/signage/* → web        (Proxy zum Signage-Stack, hängt das Token an)
│   │     /api/*      → compute        (SSE-frei; keine Langlebigkeit nötig)
│   │     /supabase/* → kong           (Prefix gestrippt)
│   │     /studio     → studio         (nur 127.0.0.1 oder Basic-Auth)
│   ├── web         Next.js 16 App Router, @supabase/ssr, Server Components + Client-Inseln
│   ├── compute     FastAPI, non-root, kein --reload; pandas-Parser, Dokumente, SNMP, Personio, SMB, Graph-Mail
│   ├── db          Postgres 17 (Supabase-Image mit Extensions: pg_cron, pgjwt, pgsodium …)
│   ├── auth        GoTrue (E-Mail/Passwort, Custom Access Token Hook → Claim `apps`)
│   ├── rest        PostgREST (RLS erzwungen)
│   ├── storage     Supabase Storage (lokales Backend unter /srv/acm/storage)
│   ├── realtime    optional, nur wenn ein Modul es braucht
│   ├── kong, meta, imgproxy
│   └── (analytics, vector: deaktiviert)
│
└── Compose-Projekt "signage"  (/home/acm/acm-signage, eigenes Repo acm-signage)
    ├── caddy-signage :8080  eigene Instanz, SSE-Passthrough, vorerst HTTP (TLS offen)
    ├── signage-api   FastAPI --workers 1, Player-Bundle im Image, SSE, Pairing, Device-JWT, PPTX
    ├── signage-db    Postgres 17, 10 Tabellen, eigene Alembic-Kette, NOTIFY-Trigger
    └── (optional nach Spike: payload als Content-Admin)
```

## Invarianten

- **Alembic ist alleiniger DDL-Eigentümer von `public.*`.** Supabase verwaltet nur seine eigenen Schemata (`auth`, `storage`, `realtime`, `supabase_functions`). Nie `create_all()`.
- **RLS auf jeder Tabelle, die PostgREST sieht.** Ohne Policy keine Sichtbarkeit. Der `service_role`-Key erreicht nie den Browser. CI-Guard greppt das Web-Bundle.
- **Rechte kommen aus dem Claim `apps`.** Middleware (Web), RLS (DB) und `compute` (Python) prüfen denselben Claim. Keine zweite Rollen-Quelle.
- **Same-Origin über Caddy.** Kein CORS, keine direkt veröffentlichten Ports außer Caddy.
- **`compute` ist zustandslos und mehrfach startbar.** Kein In-Process-Scheduler mit Fanout, kein SSE. Was Langlebigkeit braucht, lebt im Signage-Stack.
- **Kein Host-Pfad wird von beiden Stacks benutzt.** `/home/acm/acm-plattform` und `/home/acm/acm-signage` sind getrennt (`/srv` gehört auf dem Host root, siehe `docs/cutover.md`).
- **Logging nach `docs/logging.md`.** Anker auf jedem Dienst, keine Access-Logs auf Erfolg.
- **Tests laufen nie gegen eine Datenbank ohne `test` im Namen.**

## Rechteverwaltung

Unter `/einstellungen`, Gruppe „Nutzer und Gruppen“, pflegen Plattform-Admins Gruppen, Mitglieder und App-Rechte (`/platform` leitet dorthin weiter). Die Seite schreibt direkt über PostgREST — es gibt keinen eigenen Verwaltungs-Endpunkt in `compute`. Was erlaubt ist, entscheiden die Policies auf `groups`, `user_groups` und `app_grants`; die Oberfläche blendet nur aus, was die Datenbank ohnehin abweist.

Zwei Besonderheiten:

- `auth.users` gehört Supabase und ist für `authenticated` nicht lesbar. Die Sicht `public.plattform_nutzer` öffnet genau die vier benötigten Spalten und filtert selbst auf `is_platform_admin()`. Sie läuft bewusst ohne `security_invoker`.
- Eine Rechteänderung wirkt erst bei der nächsten Anmeldung der betroffenen Person, weil `custom_access_token_hook` den Claim `apps` beim Ausstellen des Tokens schreibt. Die Oberfläche sagt das an jeder Stelle, an der es zählt.

Eine Person anzulegen geht als einziger Schritt nicht über PostgREST: dafür braucht es die Admin-Schnittstelle von GoTrue und damit den `service_role`-Schlüssel, der den Browser nie erreichen darf. Dafür gibt es genau einen Endpunkt in `compute` (`POST /api/verwaltung/nutzer`), abgesichert mit `platform: admin`. Er erzeugt ein Passwort und gibt es einmalig zurück; einen Einladungsversand gibt es bewusst nicht, weil dafür ein Mailserver konfiguriert sein müsste. Aus demselben Grund liegt das Zurücksetzen eines vergessenen Passworts daneben (`POST /api/verwaltung/nutzer/{id}/passwort`) — ohne Mailserver gibt es keinen Selbstbedienungsweg, und ohne diesen Endpunkt bliebe nur die Kommandozeile auf dem Host. GoTrue beendet beim Setzen eines neuen Passworts alle offenen Sitzungen der Person (nachgemessen an `auth.sessions`) — ein zurückgesetztes Passwort schneidet einen übernommenen Zugang also wirklich ab. Die neue Person hat danach keine Rechte, die kommen über eine Gruppe.

Die Aufbewahrung der Upload-Protokolle (365 Tage) hängt an `pg_cron`, nicht an einem Dienst: `aufraeumen-upload-batches` ruft täglich um 3:30 Uhr `public.aufraeumen_upload_batches()`.

## Datenfluss Beispiel: Sales-Dashboard

1. Server Component liest `kpi_sales_weekly` (View) über supabase-js mit der Nutzer-Session. RLS filtert nach `apps ->> 'sales'`.
2. Client-Inseln (Recharts) hydrieren mit den Daten aus `HydrationBoundary`.
3. Upload: Client sendet Datei an `compute` `/api/upload/auftraege` mit dem Supabase-Access-Token. `compute` prüft JWT (JWKS), parst in `run_in_threadpool`, schreibt per asyncpg in `public.auftraege`, `pg_notify` optional an Realtime.

## Repos

| Repo | Inhalt |
|---|---|
| `acm-plattform` | dieses Repo: `apps/web`, `services/compute`, `infra/`, `docs/` |
| `acm-signage` | Signage-Stack komplett inkl. Pi-Provisioning und Sidecar |
| `lumeapps` | Altprojekt, nur noch Phase-0-Fixes bis zur Ablösung |
