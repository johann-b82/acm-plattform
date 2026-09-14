"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  bereichFuerPfad,
  bewertungApi,
  bewertungKeys,
  type Ampel,
  type Bubble,
  type Rechteck,
} from "@/lib/kpi/bewertung";
import { ConfirmDeleteButton } from "@/components/ui/confirm-button";
import { useTexte } from "@/components/sprache/anbieter";
import { cn } from "@/lib/cn";

export const AMPEL_FARBE: Record<Ampel, string> = {
  rot: "var(--danger)",
  gelb: "#eab308",
  gruen: "#22c55e",
};

/** Der nummerierte Kreis — auf der Seite, im Seitenfeld und in der Übersicht. */
export function BubbleMarke({
  nummer,
  ampel,
  className,
}: {
  nummer: number;
  ampel: Ampel | null;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
        ampel ? "text-white" : "bg-[var(--fg)] text-[var(--bg)]",
        className,
      )}
      style={ampel ? { background: AMPEL_FARBE[ampel] } : undefined}
    >
      {nummer}
    </span>
  );
}

const pct = (v: number) => `${v * 100}%`;

/**
 * Bubbles auf einer Dashboard-Seite, wie `KpiBubbleOverlay` im Altsystem.
 *
 * Im Altsystem legt jede Dashboard-Seite ihren ganzen Inhalt in das Overlay;
 * die Bubble hängt damit an der Seite, nicht an einem einzelnen Diagramm, und
 * ihre Position ist ein Anteil der Seite. Hier liegt die Ebene im Layout der
 * Kennzahlen-Seiten und findet den Bereich über die Adresse — die Seiten
 * selbst wissen davon nichts.
 *
 * Die Ebene zeigt die vorhandenen Bubbles der Seite und rechts ihre Liste.
 * Neue Bubbles werden hier nicht mehr gesetzt: den Knopf dafür gibt es auf
 * Nutzerwunsch nicht mehr.
 */
export function BubbleEbene({
  darfLesen,
  darfSchreiben,
  children,
}: {
  darfLesen: boolean;
  darfSchreiben: boolean;
  children: ReactNode;
}) {
  const bereich = bereichFuerPfad(usePathname() ?? "");
  if (!darfLesen || !bereich) return <>{children}</>;
  return (
    <Ebene bereich={bereich} darfSchreiben={darfSchreiben}>
      {children}
    </Ebene>
  );
}

function Ebene({
  bereich,
  darfSchreiben,
  children,
}: {
  bereich: string;
  darfSchreiben: boolean;
  children: ReactNode;
}) {
  const worte = useTexte();
  const t = worte.bewertung;
  const qc = useQueryClient();

  const [gewaehlt, setGewaehlt] = useState<string | null>(null);

  const alle = useQuery({ queryKey: bewertungKeys.bubbles(), queryFn: bewertungApi.bubbles });
  const massnahmen = useQuery({
    queryKey: bewertungKeys.massnahmen(),
    queryFn: bewertungApi.massnahmen,
  });
  const bubbles = (alle.data ?? [])
    .filter((b) => b.bereich === bereich && b.pos_x != null)
    .sort((a, b) => a.nummer - b.nummer);

  const nachAenderung = () => qc.invalidateQueries({ queryKey: ["kpi", "bewertung"] });

  const gesehen = useMutation({ mutationFn: bewertungApi.bubbleGesehen, onSuccess: nachAenderung });
  const loeschen = useMutation({
    mutationFn: bewertungApi.bubbleLoeschen,
    onSuccess: () => {
      setGewaehlt(null);
      return nachAenderung();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const waehle = (b: Bubble) => {
    const neu = gewaehlt === b.id ? null : b.id;
    setGewaehlt(neu);
    if (neu && !b.gesehen_am && darfSchreiben) gesehen.mutate(b.id);
  };

  const auswahl = bubbles.find((b) => b.id === gewaehlt);
  const rahmen: Rechteck | null = auswahl
    ? { x: auswahl.pos_x!, y: auswahl.pos_y!, w: auswahl.breite!, h: auswahl.hoehe! }
    : null;

  const anzahlZu = (id: string) => (massnahmen.data ?? []).filter((m) => m.kommentar_id === id).length;

  return (
    <div className="flex gap-4">
      <div className="relative min-w-0 flex-1">
        {children}
        <div className="pointer-events-none absolute inset-0">
          {rahmen && (
            <div
              className="absolute rounded-sm border-2 border-dashed border-[var(--fg)]/70 bg-[var(--fg)]/5"
              style={{ left: pct(rahmen.x), top: pct(rahmen.y), width: pct(rahmen.w), height: pct(rahmen.h) }}
            />
          )}
          {bubbles.map((b) => (
            <button
              key={b.id}
              type="button"
              title={b.text}
              aria-label={`${t.bubble(b.nummer)}: ${b.text}`}
              className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 rounded-full shadow ring-2 ring-[var(--bg)]"
              style={{ left: pct(b.pos_x! + b.breite! / 2), top: pct(b.pos_y!) }}
              onClick={() => waehle(b)}
            >
              <BubbleMarke nummer={b.nummer} ampel={b.ampel} />
            </button>
          ))}
        </div>
      </div>

      {bubbles.length > 0 && (
        <aside className="w-64 shrink-0 self-start rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
          <p className="mb-2 text-sm font-semibold">
            {t.bubbles} <span className="font-normal text-[var(--fg-muted)]">({bubbles.length})</span>
          </p>
          <ul className="space-y-1.5">
            {bubbles.map((b) => (
              <li
                key={b.id}
                className={cn(
                  "rounded-md border p-2 text-xs",
                  gewaehlt === b.id ? "border-[var(--fg)] bg-[var(--muted)]" : "border-[var(--border)]",
                )}
              >
                <button type="button" onClick={() => waehle(b)} className="w-full text-start">
                  <span className="flex items-center gap-1.5">
                    <BubbleMarke nummer={b.nummer} ampel={b.ampel} className="h-4 w-4 text-[10px]" />
                    <span className="text-[var(--fg-muted)]">{b.verfasser_email ?? ""}</span>
                  </span>
                  <span className="mt-1 block whitespace-pre-wrap">{b.text}</span>
                </button>
                {gewaehlt === b.id && (
                  <div className="mt-2 space-y-1.5 border-t border-[var(--border)] pt-2">
                    <p className="text-[11px] text-[var(--fg-muted)]">{t.anzahlMassnahmen(anzahlZu(b.id))}</p>
                    {darfSchreiben && (
                      <div className="flex items-center justify-between gap-2">
                        <Link href="/kpi/bewertung" className="text-[11px] underline underline-offset-4">
                          {t.verwalten}
                        </Link>
                        <ConfirmDeleteButton
                          itemLabel={t.bubble(b.nummer)}
                          onConfirm={() => loeschen.mutateAsync(b.id)}
                        />
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </aside>
      )}
    </div>
  );
}
