"use client";

import { useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Info } from "lucide-react";

import { Dialog } from "@/components/ui/dialog";
import { erklaerungText, type Erklaerung } from "@/lib/erklaerung";

/** So klein, dass die Zeile neben dem Kacheltitel nicht höher wird. */
const KNOPF =
  "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded " +
  "text-[var(--fg-muted)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--fg)] " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]";

/**
 * Das kleine „i“ an einer Kachel: wie kommt diese Zahl zustande?
 *
 * Zeigt den Abschnitt aus der Hilfe, der zu dieser Kachel gehört — nicht eine
 * zweite, kürzere Fassung davon. Wer mehr will, geht von hier auf die ganze
 * Seite.
 */
export function ErklaerungKnopf({
  titel,
  erklaerung,
}: {
  titel: string;
  erklaerung: Erklaerung;
}) {
  const [offen, setOffen] = useState(false);
  const text = erklaerungText(erklaerung);
  // Kein Knopf ohne Text: ein leeres Fenster ist schlimmer als kein Knopf.
  if (!text) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOffen(true)}
        aria-label={`Wie wird „${titel}“ gerechnet?`}
        title="Rechenweg"
        className={KNOPF}
      >
        <Info className="h-3.5 w-3.5" aria-hidden />
      </button>
      <Dialog
        open={offen}
        onOpenChange={setOffen}
        title={titel}
        description="So wird gerechnet"
        className="max-w-2xl"
        footer={
          <Link
            href={`/hilfe/${erklaerung.seite}`}
            className="text-sm underline-offset-4 hover:underline"
          >
            Ganze Hilfeseite
          </Link>
        }
      >
        <div className="prose-hilfe max-h-[60vh] overflow-y-auto text-sm">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
        </div>
      </Dialog>
    </>
  );
}
