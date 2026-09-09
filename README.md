# ACM-Plattform

Interne Plattform für KPI-Dashboards (Vertrieb, HR, Qualität, Finanzen, Einkauf, Produktion), ERP-Datei-Uploads, HR-Prozesse (Schulungen, Onboarding, Kompetenzen, Einarbeitung, Zeugnisse), Wartung, Audits, ATR, FAIR und Newsletter. Nachfolger von `lumeapps`, aufgebaut auf Next.js, Supabase (self-hosted) und einem schlanken Python-Compute-Dienst.

Stand: **Grundgerüst, Rechteverwaltung und erstes Fachmodul laufen.** Supabase-Stack (gepinnt), Rechtemodell mit Token-Hook und RLS, pflegbare Gruppen und App-Rechte unter `/platform`, Next.js-Shell mit Login und Launcher, Compute-Dienst mit JWT-Prüfung, Vertriebs-Uploads und -Dashboard, Signage-Verwaltung als App-Kachel. Details in `docs/status.md`, Setup in `docs/setup.md`, Plan in `docs/plan.md`.

## Struktur

```
docs/           Stand, Plan, Architektur, ADRs, Inventur, Security, Logging
apps/web/       Next.js 16 (ab Phase 2)
services/compute/  FastAPI Compute-Dienst (ab Phase 2, Fachlogik aus lumeapps)
infra/supabase/ gepinnter Supabase-Upstream + Overrides (ab Phase 2)
infra/host/     Host-Vorlagen (journald, daemon.json) — nicht angewendet
```

Signage lebt im eigenen Repo `acm-signage` (ADR-0002).

## Einstieg

1. `docs/plan.md` lesen, Abschnitt 1 (Entscheidungen) und 9 (Phasen).
2. `docs/inventory.md` sagt, was aus `lumeapps` übernommen, umgebaut oder gelöscht wird.
3. `CLAUDE.md` enthält die Invarianten für Arbeit in diesem Repo.

## Was hier bewusst fehlt

Kein Directus, kein `auth_forward`, keine Tool-App-Reste, keine Phase-Grep-Guards, keine 14-MB-Testdatei, kein Changelog aus dem Altprojekt. Historie bleibt in `lumeapps` lesbar.
