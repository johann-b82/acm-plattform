# apps/web — Next.js 15 (ab Phase 2)

Noch kein Code. Beim Start:

- `create-next-app` mit App Router, TypeScript, Tailwind 4; shadcn/ui aus `lumeapps/frontend/src/components/ui` 1:1 übernehmen.
- Auth über `@supabase/ssr` (Cookie-Session), Middleware prüft Claim `apps` je Route-Gruppe: `(public)/embed/*`, `(auth)/login`, `(app)/[module]/*`.
- Launcher und Breadcrumbs aus einer Registry (`apps`-Tabelle), nicht aus JSX.
- Kein Modul-Singleton für Tokens (der alte `apiClient.ts` leakt auf dem Server zwischen Nutzern).
- Client-only-Inseln per `next/dynamic({ ssr: false })`: FAIR (tesseract, pdf-lib, react-pdf), Newsletter-Flipbook, Feedback-Screenshot, Recharts-Wrapper.
- Docs aus Markdown als Server Components mit `generateStaticParams`.
- Übernahmereihenfolge nach `docs/plan.md` § 9, Phase 4.
