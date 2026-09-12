"use client";

import { useRef, useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MessageSquareDashed, X } from "lucide-react";

import {
  aufgezogen,
  bereichFuerPfad,
  bewertungApi,
  bewertungKeys,
  type Ampel,
  type Bubble,
  type Punkt,
  type Rechteck,
} from "@/lib/kpi/bewertung";
import { Button, Select, Textarea } from "@/components/ui/primitives";
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
 * Mit dem Knopf „Bubble" (nur wer Maßnahmen schreiben darf) wird die Seite zur
 * Zeichenfläche: ein Rechteck aufziehen, beschreiben, speichern. Rechts steht
 * die Liste der Bubbles dieser Seite, sobald es welche gibt.
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
  const flaeche = useRef<HTMLDivElement>(null);

  const [modus, setModus] = useState(false);
  const [start, setStart] = useState<Punkt | null>(null);
  const [aktuell, setAktuell] = useState<Punkt | null>(null);
  const [offen, setOffen] = useState<Rechteck | null>(null);
  const [gewaehlt, setGewaehlt] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [ampel, setAmpel] = useState<Ampel | "">("");

  const alle = useQuery({ queryKey: bewertungKeys.bubbles(), queryFn: bewertungApi.bubbles });
  const massnahmen = useQuery({
    queryKey: bewertungKeys.massnahmen(),
    queryFn: bewertungApi.massnahmen,
  });
  const bubbles = (alle.data ?? [])
    .filter((b) => b.bereich === bereich && b.pos_x != null)
    .sort((a, b) => a.nummer - b.nummer);

  const nachAenderung = () => qc.invalidateQueries({ queryKey: ["kpi", "bewertung"] });

  const speichern = useMutation({
    mutationFn: () =>
      bewertungApi.bubbleAnlegen({ bereich, text: text.trim(), ampel: ampel || null, rechteck: offen! }),
    onSuccess: () => {
      setOffen(null);
      setText("");
      setAmpel("");
      return nachAenderung();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const gesehen = useMutation({ mutationFn: bewertungApi.bubbleGesehen, onSuccess: nachAenderung });
  const loeschen = useMutation({
    mutationFn: bewertungApi.bubbleLoeschen,
    onSuccess: () => {
      setGewaehlt(null);
      return nachAenderung();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const punkt = (e: MouseEvent): Punkt => {
    const r = flaeche.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    };
  };

  const waehle = (b: Bubble) => {
    const neu = gewaehlt === b.id ? null : b.id;
    setGewaehlt(neu);
    if (neu && !b.gesehen_am && darfSchreiben) gesehen.mutate(b.id);
  };

  const auswahl = bubbles.find((b) => b.id === gewaehlt);
  const rahmen: Rechteck | null =
    (start && aktuell
      ? { x: Math.min(start.x, aktuell.x), y: Math.min(start.y, aktuell.y), w: Math.abs(aktuell.x - start.x), h: Math.abs(aktuell.y - start.y) }
      : null) ??
    offen ??
    (auswahl ? { x: auswahl.pos_x!, y: auswahl.pos_y!, w: auswahl.breite!, h: auswahl.hoehe! } : null);

  const zeigeFeld = modus || bubbles.length > 0 || offen != null;
  const anzahlZu = (id: string) => (massnahmen.data ?? []).filter((m) => m.kommentar_id === id).length;

  return (
    <div className="flex gap-4">
      <div ref={flaeche} className="relative min-w-0 flex-1">
        {children}
        <div
          className="absolute inset-0"
          style={{ pointerEvents: modus ? "auto" : "none", cursor: modus ? "crosshair" : "default" }}
          onMouseDown={(e) => {
            if (!modus || offen) return;
            setStart(punkt(e));
            setAktuell(punkt(e));
          }}
          onMouseMove={(e) => {
            if (modus && start && !offen) setAktuell(punkt(e));
          }}
          onMouseUp={(e) => {
            if (!modus || !start) return;
            const r = aufgezogen(start, punkt(e));
            setStart(null);
            setAktuell(null);
            if (r) setOffen(r);
          }}
        >
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
              className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full shadow ring-2 ring-[var(--bg)]"
              style={{ left: pct(b.pos_x! + b.breite! / 2), top: pct(b.pos_y!), pointerEvents: "auto" }}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => waehle(b)}
            >
              <BubbleMarke nummer={b.nummer} ampel={b.ampel} />
            </button>
          ))}
        </div>
      </div>

      {zeigeFeld && (
        <aside className="w-64 shrink-0 self-start rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
          <p className="mb-2 text-sm font-semibold">
            {t.bubbles} <span className="font-normal text-[var(--fg-muted)]">({bubbles.length})</span>
          </p>

          {offen && (
            <div className="mb-3 space-y-2 rounded-md border border-[var(--border)] bg-[var(--muted)] p-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold">{t.beschreiben}</span>
                <button
                  type="button"
                  aria-label={t.verwerfen}
                  title={t.verwerfen}
                  className="text-[var(--fg-muted)] hover:text-[var(--fg)]"
                  onClick={() => setOffen(null)}
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
              <Textarea
                autoFocus
                rows={3}
                value={text}
                aria-label={t.beschreiben}
                placeholder={t.platzhalter}
                onChange={(e) => setText(e.target.value)}
              />
              <div className="flex items-center gap-2">
                <Select
                  className="h-8 w-auto text-xs"
                  aria-label={t.ampel.keine}
                  value={ampel}
                  onChange={(e) => setAmpel(e.target.value as Ampel | "")}
                >
                  <option value="">{t.ampel.keine}</option>
                  <option value="gruen">{t.ampel.gruen}</option>
                  <option value="gelb">{t.ampel.gelb}</option>
                  <option value="rot">{t.ampel.rot}</option>
                </Select>
                <Button
                  size="sm"
                  className="ms-auto"
                  disabled={!text.trim() || speichern.isPending}
                  onClick={() => speichern.mutate()}
                >
                  {worte.allgemein.speichern}
                </Button>
              </div>
            </div>
          )}

          {bubbles.length === 0 && !offen ? (
            <p className="text-xs text-[var(--fg-muted)]">{modus ? t.panelHinweis : t.bubblesLeer}</p>
          ) : (
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
          )}
        </aside>
      )}

      {darfSchreiben && (
        // Über dem Melde-Knopf, an derselben Kante — wie im Altsystem.
        <Button
          variant={modus ? "default" : "outline"}
          aria-pressed={modus}
          aria-label={t.bubbleModus}
          onClick={() => setModus((v) => !v)}
          className="fixed bottom-16 end-4 z-40 shadow-sm"
        >
          <MessageSquareDashed className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">{modus ? t.bubbleModusAn : t.bubbleModus}</span>
        </Button>
      )}
    </div>
  );
}
