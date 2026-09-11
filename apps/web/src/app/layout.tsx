import type { Metadata } from "next";
import "./globals.css";
import { VORSCHALTSKRIPT } from "@/lib/erscheinungsbild";

export const metadata: Metadata = {
  title: "ACM-Plattform",
  description: "KPI-Dashboards und interne Anwendungen",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" suppressHydrationWarning>
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
