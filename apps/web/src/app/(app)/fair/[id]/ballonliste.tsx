"use client";

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  ClipboardCopy,
  Download,
  FileDown,
  GripVertical,
  Loader2,
  RefreshCw,
} from "lucide-react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { fairApi, fairKeys, type Ballon } from "@/lib/fair";
import { alsCsv, alsTsv } from "@/lib/fair/geometrie";
import { ocrEntscheidung } from "@/lib/fair/ocr";
import { mitNeuenNummern, verschobeneReihenfolge } from "@/lib/fair/reihenfolge";
import { Button, Card } from "@/components/ui/primitives";
import { Datentabelle, type Tabellenspalte } from "@/components/ui/datentabelle";
import { Dialog } from "@/components/ui/dialog";
import { ConfirmDeleteButton } from "@/components/ui/confirm-button";
import { useTexte } from "@/components/sprache/anbieter";

/** Darf gerade verschoben werden? Hängt an Suche und Sortierung der Tabelle. */
const Verschiebbar = createContext(false);
/** Der Ziehgriff sitzt in einer Zelle, der Zieh-Zustand gehört der Zeile. */
const Griff = createContext<Pick<ReturnType<typeof useSortable>, "attributes" | "listeners"> | null>(null);

/**
 * Die Prüfliste: Nummer, Seite, gemessener Wert.
 *
 * Die Nummer lässt sich nicht tippen — sie gehört der Datenbank. Verschieben
 * ändert die Reihenfolge, und die Datenbank schreibt die Nummern in einem Zug
 * um; ein Löschen schließt die Lücke von selbst. Der Ballon behält dabei Feld,
 * Blase und Wert, er bekommt nur eine andere Nummer — auf der Zeichnung, in
 * CSV und PDF gleichermaßen.
 *
 * Die Tabelle sortiert und sucht wie jede andere (TAB-02/03). Verschieben per
 * Griff oder Pfeil geht aber nur, solange sie die Nummernfolge zeigt: ohne
 * Suche und unsortiert oder nach Nr aufsteigend. Nach Wert sortiert hieße
 * „nach oben“ etwas anderes als die Nummer davor, und die manuelle Reihenfolge
 * würde unsichtbar verändert.
 */
export function Ballonliste({
  zeichnungId,
  ballons,
  gewaehlt,
  darfSchreiben,
  mehrereSeiten,
  pdfLaeuft,
  onWaehlen,
  onOcr,
  onPdf,
}: {
  zeichnungId: string;
  ballons: Ballon[];
  gewaehlt: string | null;
  darfSchreiben: boolean;
  mehrereSeiten: boolean;
  pdfLaeuft: boolean;
  onWaehlen: (b: Ballon) => void;
  /** Liest das Feld des Ballons neu; wirft, wenn OCR nicht möglich ist. */
  onOcr: (b: Ballon) => Promise<string>;
  onPdf: () => void;
}) {
  const worte = useTexte();
  const queryClient = useQueryClient();
  const [ocrLaeuft, setOcrLaeuft] = useState<string | null>(null);
  const [rueckfrage, setRueckfrage] = useState<{ ballon: Ballon; neu: string } | null>(null);
  const neuLaden = () =>
    queryClient.invalidateQueries({ queryKey: fairKeys.ballons(zeichnungId) });

  const aendern = useMutation({
    mutationFn: ({ id, wert }: { id: string; wert: string }) =>
      fairApi.ballonAendern(id, { wert }),
    onSuccess: neuLaden,
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  const loeschen = useMutation({
    mutationFn: (id: string) => fairApi.ballonLoeschen(id),
    onSuccess: neuLaden,
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  const umsortieren = useMutation({
    mutationFn: (ids: string[]) => fairApi.reihenfolge(zeichnungId, ids),
    // Sofort anzeigen, was die Datenbank gleich vergibt — sonst springt die
    // gezogene Zeile bis zur Antwort an ihren alten Platz zurück.
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: fairKeys.ballons(zeichnungId) });
      queryClient.setQueryData<Ballon[]>(fairKeys.ballons(zeichnungId), (alt) =>
        alt ? mitNeuenNummern(alt, ids) : alt,
      );
    },
    onSettled: neuLaden,
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  const sensoren = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const nachNummer = [...ballons].sort((a, b) => a.nummer - b.nummer);

  /** Tauscht mit dem Nachbarn und schickt die ganze Folge — die Funktion in
   *  der Datenbank verlangt sie vollständig, damit keine halbe Reihenfolge
   *  entstehen kann. */
  const verschieben = (b: Ballon, richtung: -1 | 1) => {
    const ids = nachNummer.map((x) => x.id);
    const index = ids.indexOf(b.id);
    const ziel = index + richtung;
    if (index < 0 || ziel < 0 || ziel >= ids.length) return;
    [ids[index], ids[ziel]] = [ids[ziel], ids[index]];
    umsortieren.mutate(ids);
  };

  const beiZiehenEnde = ({ active, over }: DragEndEvent) => {
    if (!over) return;
    const ids = verschobeneReihenfolge(ballons, String(active.id), String(over.id));
    if (ids) umsortieren.mutate(ids);
  };

  const ocrStarten = async (b: Ballon) => {
    setOcrLaeuft(b.id);
    try {
      const neu = await onOcr(b);
      switch (ocrEntscheidung(b.wert, neu)) {
        case "leer":
          toast(worte.fair.ocrLeer);
          break;
        case "gleich":
          toast(worte.fair.ocrGleich);
          break;
        case "speichern":
          aendern.mutate({ id: b.id, wert: neu });
          break;
        case "rueckfrage":
          setRueckfrage({ ballon: b, neu });
          break;
      }
    } catch (fehler) {
      toast.error(worte.fair.ocrFehler(fehler instanceof Error ? fehler.message : String(fehler)));
    } finally {
      setOcrLaeuft(null);
    }
  };

  const inZwischenablage = async () => {
    try {
      await navigator.clipboard.writeText(alsTsv(ballons));
      toast.success("Prüfliste kopiert — in Excel einfügbar.");
    } catch {
      toast.error("Die Zwischenablage ließ sich nicht beschreiben.");
    }
  };

  const alsDatei = () => {
    // Mit BOM, sonst zeigt deutsches Excel Umlaute falsch an.
    const blob = new Blob(["﻿" + alsCsv(ballons)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "pruefliste.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const spalten: Tabellenspalte<Ballon>[] = [];
  if (darfSchreiben) {
    spalten.push({
      schluessel: "griff",
      titel: "",
      typ: "text",
      wert: () => null,
      sortierbar: false,
      suchtext: false,
      className: "w-8 pe-0",
      zelle: (b) => <Ziehgriff nummer={b.nummer} />,
    });
  }
  spalten.push({ schluessel: "nummer", titel: worte.fair.nr, typ: "zahl", wert: (b) => b.nummer, className: "w-14" });
  if (mehrereSeiten) {
    spalten.push({ schluessel: "seite", titel: worte.fair.seite, typ: "zahl", wert: (b) => b.seite, className: "w-16" });
  }
  spalten.push({
    schluessel: "wert",
    titel: worte.fair.wert,
    typ: "text",
    wert: (b) => b.wert,
    zelle: (b) => (
      <WertFeld
        ballon={b}
        darfSchreiben={darfSchreiben}
        onSpeichern={(wert) => aendern.mutate({ id: b.id, wert })}
      />
    ),
  });
  if (darfSchreiben) {
    spalten.push({
      schluessel: "aktion",
      titel: "",
      typ: "text",
      wert: () => null,
      sortierbar: false,
      suchtext: false,
      ausrichtung: "end",
      zelle: (b) => (
        <Aktionen
          ballon={b}
          letzte={b.nummer === ballons.length}
          ocrLaeuft={ocrLaeuft}
          onOcr={() => void ocrStarten(b)}
          onVerschieben={(richtung) => verschieben(b, richtung)}
          onLoeschen={() => loeschen.mutateAsync(b.id).then(() => undefined)}
        />
      ),
    });
  }

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="font-medium">{worte.fair.pruefliste}</h2>
        <span className="text-sm text-[var(--fg-muted)]">
          {ballons.length === 1 ? worte.fair.einMass : worte.fair.masse(ballons.length)}
        </span>
        <div className="ms-auto flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={inZwischenablage}
            disabled={ballons.length === 0}
          >
            <ClipboardCopy className="me-1.5 h-3.5 w-3.5" aria-hidden />
            {worte.fair.kopieren}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={alsDatei}
            disabled={ballons.length === 0}
          >
            <Download className="me-1.5 h-3.5 w-3.5" aria-hidden />
            {worte.fair.csv}
          </Button>
          <Button variant="outline" size="sm" onClick={onPdf} disabled={pdfLaeuft} title={worte.fair.pdfExport}>
            {pdfLaeuft ? (
              <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <FileDown className="me-1.5 h-3.5 w-3.5" aria-hidden />
            )}
            {pdfLaeuft ? worte.fair.pdfWirdErstellt : worte.fair.pdf}
          </Button>
        </div>
      </div>

      <Datentabelle
        zeilen={ballons}
        spalten={spalten}
        zeilenSchluessel={(b) => b.id}
        beschriftung={worte.fair.pruefliste}
        leer={worte.fair.keinMass}
        zeile={(b, zellen) => (
          <Zeile ballon={b} aktiv={gewaehlt === b.id} onWaehlen={onWaehlen}>
            {zellen}
          </Zeile>
        )}
        huelle={(tabelle, { sichtbar, sortierung, suchtext }) => {
          const verschiebbar =
            darfSchreiben &&
            !suchtext &&
            (!sortierung || (sortierung.spalte === "nummer" && sortierung.richtung === "auf"));
          return (
            <Verschiebbar.Provider value={verschiebbar}>
              {darfSchreiben && !verschiebbar && (
                <p className="text-xs text-[var(--fg-muted)]">{worte.fair.nurNummernfolge}</p>
              )}
              <DndContext sensors={sensoren} collisionDetection={closestCenter} onDragEnd={beiZiehenEnde}>
                <SortableContext items={sichtbar.map((b) => b.id)} strategy={verticalListSortingStrategy}>
                  {tabelle}
                </SortableContext>
              </DndContext>
            </Verschiebbar.Provider>
          );
        }}
      />

      <Dialog
        open={rueckfrage !== null}
        onOpenChange={(offen) => !offen && setRueckfrage(null)}
        title={worte.fair.ocrErsetzenTitel}
        description={
          rueckfrage
            ? worte.fair.ocrErsetzen(rueckfrage.ballon.nummer, rueckfrage.ballon.wert, rueckfrage.neu)
            : undefined
        }
        footer={
          <>
            <Button variant="outline" onClick={() => setRueckfrage(null)}>
              {worte.allgemein.abbrechen}
            </Button>
            <Button
              onClick={() => {
                if (rueckfrage) aendern.mutate({ id: rueckfrage.ballon.id, wert: rueckfrage.neu });
                setRueckfrage(null);
              }}
            >
              {worte.fair.ersetzen}
            </Button>
          </>
        }
      />
    </Card>
  );
}

/** Textklasse eines Wertfelds — wie die `Input`-Primitive, aber als
 *  mehrzeiliges, mitwachsendes Feld (doppelte Breite). */
const WERT_FELD =
  "block w-full min-w-48 resize-none rounded-md border border-[var(--border)] " +
  "bg-[var(--surface)] px-3 py-1.5 text-sm placeholder:text-[var(--fg-muted)] " +
  "focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-[var(--ring)] " +
  "disabled:opacity-50";

/**
 * Das Wertfeld einer Zeile: doppelt so breit wie zuvor und mehrzeilig — bei
 * langem Text (etwa „SIEHE BLATT 01 SEE SH“) wächst es in der Höhe mit, statt
 * abzuschneiden. Speichert beim Verlassen; nach einer OCR-Übernahme (neuer
 * `wert`) setzt der Schlüssel das Feld zurück.
 */
function WertFeld({
  ballon,
  darfSchreiben,
  onSpeichern,
}: {
  ballon: Ballon;
  darfSchreiben: boolean;
  onSpeichern: (wert: string) => void;
}) {
  const worte = useTexte();
  const ref = useRef<HTMLTextAreaElement>(null);
  const anpassen = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);
  // Beim Anzeigen (und nach einer Wertänderung) die Höhe an den Inhalt legen.
  useLayoutEffect(anpassen, [anpassen, ballon.wert]);
  return (
    <textarea
      ref={ref}
      key={`${ballon.id}:${ballon.wert}`}
      defaultValue={ballon.wert}
      aria-label={worte.fair.wertZu(ballon.nummer)}
      placeholder={worte.fair.wertBeispiel}
      disabled={!darfSchreiben}
      rows={1}
      className={WERT_FELD}
      onInput={anpassen}
      onBlur={(e) => {
        if (e.target.value !== ballon.wert) onSpeichern(e.target.value);
      }}
    />
  );
}

function Zeile({
  ballon,
  aktiv,
  onWaehlen,
  children,
}: {
  ballon: Ballon;
  aktiv: boolean;
  onWaehlen: (b: Ballon) => void;
  children: ReactNode;
}) {
  const verschiebbar = useContext(Verschiebbar);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: ballon.id, disabled: !verschiebbar });
  return (
    <Griff.Provider value={{ attributes, listeners }}>
      <tr
        ref={setNodeRef}
        onClick={() => onWaehlen(ballon)}
        className={aktiv ? "bg-[var(--muted)]" : undefined}
        style={{
          transform: CSS.Translate.toString(transform),
          transition,
          opacity: isDragging ? 0.6 : undefined,
          position: isDragging ? "relative" : undefined,
          zIndex: isDragging ? 1 : undefined,
        }}
      >
        {children}
      </tr>
    </Griff.Provider>
  );
}

function Ziehgriff({ nummer }: { nummer: number }) {
  const worte = useTexte();
  const verschiebbar = useContext(Verschiebbar);
  const griff = useContext(Griff);
  if (!griff) return null;
  return (
    <button
      type="button"
      {...griff.attributes}
      {...griff.listeners}
      disabled={!verschiebbar}
      aria-label={worte.fair.ziehen(nummer)}
      title={verschiebbar ? worte.fair.ziehen(nummer) : worte.fair.nurNummernfolge}
      onClick={(e) => e.stopPropagation()}
      className="inline-flex h-8 w-6 cursor-grab touch-none items-center justify-center rounded text-[var(--fg-muted)] hover:text-[var(--fg)] focus-visible:outline-2 focus-visible:outline-[var(--ring)] active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-30"
    >
      <GripVertical className="h-4 w-4" aria-hidden />
    </button>
  );
}

function Aktionen({
  ballon,
  letzte,
  ocrLaeuft,
  onOcr,
  onVerschieben,
  onLoeschen,
}: {
  ballon: Ballon;
  letzte: boolean;
  ocrLaeuft: string | null;
  onOcr: () => void;
  onVerschieben: (richtung: -1 | 1) => void;
  onLoeschen: () => Promise<void>;
}) {
  const worte = useTexte();
  const verschiebbar = useContext(Verschiebbar);
  return (
    <div className="flex justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
      <Button
        variant="ghost"
        size="icon"
        aria-label={worte.fair.ocrNeu}
        title={worte.fair.ocrNeu}
        // Ein Arbeiter liest nacheinander; zwei Zeilen zugleich brächten nichts.
        disabled={ocrLaeuft !== null}
        onClick={onOcr}
      >
        {ocrLaeuft === ballon.id ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <RefreshCw className="h-4 w-4" aria-hidden />
        )}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={worte.fair.nachOben(ballon.nummer)}
        title={worte.fair.nachOben(ballon.nummer)}
        disabled={!verschiebbar || ballon.nummer === 1}
        onClick={() => onVerschieben(-1)}
      >
        <ArrowUp className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={worte.fair.nachUnten(ballon.nummer)}
        title={worte.fair.nachUnten(ballon.nummer)}
        disabled={!verschiebbar || letzte}
        onClick={() => onVerschieben(1)}
      >
        <ArrowDown className="h-4 w-4" />
      </Button>
      <ConfirmDeleteButton itemLabel={worte.fair.nummer(ballon.nummer)} onConfirm={onLoeschen} />
    </div>
  );
}
