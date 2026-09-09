# Zielarchitektur

Kurzfassung. Begründungen in `docs/plan.md`, Entscheidungen in `docs/adr/`.

## Topologie

```
Host (Linux, 192.9.201.9)
│
├── Compose-Projekt "acm"  (/srv/acm)
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
└── Compose-Projekt "signage"  (/srv/signage, eigenes Repo acm-signage)
    ├── caddy-signage :8443  eigene Instanz, SSE-Passthrough
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
- **Kein Host-Pfad wird von beiden Stacks benutzt.** `/srv/acm` und `/srv/signage` sind getrennt.
- **Logging nach `docs/logging.md`.** Anker auf jedem Dienst, keine Access-Logs auf Erfolg.
- **Tests laufen nie gegen eine Datenbank ohne `test` im Namen.**

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
