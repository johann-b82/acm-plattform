import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ACM-Plattform",
  description: "KPI-Dashboards und interne Anwendungen",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body className="min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
