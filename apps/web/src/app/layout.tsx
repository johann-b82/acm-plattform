import type { Metadata } from "next";
import "./globals.css";
import { VORSCHALTSKRIPT } from "@/lib/erscheinungsbild";
import { SCHREIBRICHTUNG, SPRACHE_TAG } from "@/lib/sprache";
import { sprache } from "@/lib/sprache-server";

export const metadata: Metadata = {
  title: "ACM-Plattform",
  description: "KPI-Dashboards und interne Anwendungen",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Das `lang`-Attribut ist keine Zierde: Screenreader wählen danach ihre
  // Aussprache, und der Browser seine Silbentrennung. `dir` entscheidet, auf
  // welcher Seite eine Zeile anfängt — ohne das steht Arabisch zwar richtig
  // geschrieben, aber am falschen Rand.
  const gewaehlt = await sprache();
  return (
    <html
      lang={SPRACHE_TAG[gewaehlt]}
      dir={SCHREIBRICHTUNG[gewaehlt]}
      suppressHydrationWarning
    >
      <head>
        {/* Läuft vor dem ersten Bild. Ohne das blitzt bei dunkler Wahl kurz
            die helle Seite auf — React kommt erst nach dem ersten Malen zum
            Zug. `suppressHydrationWarning` am <html>, weil dieses Skript das
            Element noch vor der Übernahme verändert. */}
        <script dangerouslySetInnerHTML={{ __html: VORSCHALTSKRIPT }} />
      </head>
      <body className="min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
