"use client";

import Link from "next/link";
import { Upload } from "lucide-react";

import { useTexte } from "@/components/sprache/anbieter";

/**
 * Der direkte Weg von einer Kennzahlenseite zu den Uploads (NAV-04).
 *
 * Sichtbar nur, wenn der Server `uploads: admin` im Token gesehen hat —
 * dieselbe Regel, die `/uploads` und jede Upload-Route in `compute` prüfen
 * (NAV-05). Ein Verweis ohne Recht führte nur auf die Absage.
 */
export function UploadVerweis() {
  const t = useTexte();
  return (
    <Link
      href="/uploads"
      className={
        "inline-flex h-9 items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 text-sm " +
        "hover:bg-[var(--muted)] focus-visible:outline-2 focus-visible:outline-[var(--ring)]"
      }
    >
      <Upload className="h-4 w-4 text-[var(--fg-muted)]" aria-hidden />
      {t.pfad.seiten["/uploads"]}
    </Link>
  );
}
