"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileUp, Loader2 } from "lucide-react";

import { computeJson } from "@/lib/compute";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fmt } from "@/lib/kpi/gemeinsam";
import { Badge, Button, Card, Table, TableWrap, Td, Th } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";

/**
 * Die ERP-Exporte. Jede Art hat ihren eigenen Endpunkt in compute, weil die
 * Dateien unterschiedliche Spalten haben. Der Import ist ein Upsert auf den
 * Geschäftsschlüssel der Datei — bei den Vertriebsdateien die Vorgangsnummer,
 * beim Liefertreue-Export die Position. Dieselbe Datei zweimal hochzuladen
 * ändert nichts.
 */
interface Art {
  kind: string;
  titel: string;
  datei: string;
  beschreibung: string;
  /** Nur nötig, wenn die Datei keine Textdatei ist. */
  endungen?: string;
}

const ARTEN: readonly Art[] = [
  {
    kind: "umsatz",
    titel: "Umsatz (Rechnungen und Gutschriften)",
    datei: "AswKpf_RG.txt",
    beschreibung: "Speist die Kachel Umsatz und den Umsatzverlauf. Gutschriften stehen negativ in der Datei.",
  },
  {
    kind: "auftraege",
    titel: "Auftragseingang",
    datei: "AswKpf_AUF.txt",
    beschreibung: "Speist Ø Auftragswert, Aufträge gesamt und die Auswertung je Erfasser.",
  },
  {
    kind: "auftragspositionen",
    titel: "Auftragspositionen",
    datei: "AswKpf_AUF.txt (Positionsebene)",
    beschreibung:
      "Trägt den Zieltermin je Position. Zusammen mit den Lieferscheinen ergibt sich daraus der Verzug.",
  },
  {
    kind: "lieferscheine",
    titel: "Lieferscheine",
    datei: "AswKpf_LS.xlsx",
    beschreibung: "Trägt das Ist-Lieferdatum. Excel-Datei, eine Zeile je Lieferscheinposition.",
    endungen: ".xlsx,.xls",
  },
  {
    kind: "wareneingaenge",
    titel: "Wareneingänge",
    datei: "AswKpf_WE.txt",
    beschreibung:
      "Bezugsgröße der Fehlerquote auf der Einkaufsseite. Die Warengruppe trennt Material-Lieferanten von Werkbänken.",
  },
  {
    kind: "acht_d",
    titel: "8D-Berichte",
    datei: "8D.txt",
    beschreibung:
      "Audit-Befunde und Reklamationen in einer Datei. Das Level eines Befunds steht im Freitext und wird beim Einlesen abgeleitet.",
  },
  {
    kind: "lagerbewegungen",
    titel: "Lagerbewegungen",
    datei: "AswLagBew.txt",
    beschreibung:
      "Verbrauch je Artikel für die Materialkostenquote. Ersetzt alle Zeilen im Datumsbereich der Datei.",
  },
  {
    kind: "lagerpreise",
    titel: "Artikelpreise Lager",
    datei: "AswLagBew-Preiskonditionen",
    beschreibung:
      "Stammdaten für die Lagerbewertung. Ersetzt die ganze Preisliste, nicht nur die enthaltenen Artikel.",
  },
  {
    kind: "pruefungen",
    titel: "Qualitätsprüfung",
    datei: "AswQs2151.txt",
    beschreibung:
      "Buchungen der Prüfung. Ersetzt alle Zeilen im Datumsbereich der Datei — von Hand abgewählte Buchungen in diesem Bereich zählen danach wieder mit.",
  },
  {
    kind: "liefertreue",
    titel: "Liefertermintreue (Einkauf)",
    datei: "dev_excel_Liefertreue_Einkauf.txt",
    beschreibung:
      "Speist die OTD-Quote im Einkauf. Eine Zeile je Lieferposition; das Ist-Lieferdatum bestimmt den Zeitraum.",
  },
];

interface UploadErgebnis {
  batch_id: number;
  filename: string;
  kind: string;
  rows_total: number;
  rows_inserted: number;
  rows_updated: number;
  status: "success" | "partial" | "failed";
  errors: { row: number; field: string; message: string }[];
}

interface Batch {
  id: number;
  filename: string;
  uploaded_at: string;
  kind: string;
  row_count: number;
  error_count: number;
  status: string;
}

const STATUS_KLASSE: Record<string, string> = {
  success: "status-ok",
  partial: "status-warn",
  failed: "status-bad",
};

const STATUS_TEXT: Record<string, string> = {
  success: "vollständig",
  partial: "teilweise",
  failed: "fehlgeschlagen",
};

function Ablage({
  art,
  onDatei,
  laeuft,
}: {
  art: (typeof ARTEN)[number];
  onDatei: (file: File) => void;
  laeuft: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [ueber, setUeber] = useState(false);

  return (
    <Card className="p-5">
      <h2 className="text-base font-semibold">{art.titel}</h2>
      <p className="mt-1 text-sm text-[var(--fg-muted)]">{art.beschreibung}</p>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setUeber(true);
        }}
        onDragLeave={() => setUeber(false)}
        onDrop={(e) => {
          e.preventDefault();
          setUeber(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onDatei(f);
        }}
        className={cn(
          "mt-4 flex min-h-28 flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-5 text-center transition-colors",
          ueber ? "border-[var(--ring)] bg-[var(--muted)]" : "border-[var(--border)]",
          laeuft && "opacity-60",
        )}
      >
        <input
          ref={input}
          type="file"
          accept={art.endungen ?? ".txt,.csv"}
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onDatei(f);
            e.target.value = "";
          }}
        />
        {laeuft ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin text-[var(--fg-muted)]" />
            <span className="text-xs text-[var(--fg-muted)]">wird verarbeitet …</span>
          </>
        ) : (
          <>
            <FileUp className="h-5 w-5 text-[var(--fg-muted)]" aria-hidden />
            <p className="font-mono text-sm">{art.datei}</p>
            <Button onClick={() => input.current?.click()}>Datei auswählen</Button>
          </>
        )}
      </div>
    </Card>
  );
}

export function UploadsAdmin() {
  const queryClient = useQueryClient();
  const [ergebnis, setErgebnis] = useState<UploadErgebnis | null>(null);
  const [laufend, setLaufend] = useState<string | null>(null);

  // Der Verlauf kommt über PostgREST; die Zeilen-Policy lässt nur Nutzer mit
  // einem Recht auf die App `uploads` lesen.
  const verlauf = useQuery({
    queryKey: ["uploads", "batches"],
    queryFn: async (): Promise<Batch[]> => {
      const { data, error } = await supabaseBrowser()
        .from("upload_batches")
        .select("id,filename,uploaded_at,kind,row_count,error_count,status")
        .order("uploaded_at", { ascending: false })
        .limit(20);
      if (error) throw new Error(error.message);
      return data as Batch[];
    },
  });

  const upload = useMutation({
    mutationFn: async ({ kind, file }: { kind: string; file: File }) => {
      const form = new FormData();
      form.append("file", file);
      return computeJson<UploadErgebnis>(`/api/uploads/${kind}`, { method: "POST", body: form });
    },
    onMutate: ({ kind }) => setLaufend(kind),
    onSettled: () => setLaufend(null),
    onSuccess: (res) => {
      setErgebnis(res);
      queryClient.invalidateQueries({ queryKey: ["uploads", "batches"] });
      queryClient.invalidateQueries({ queryKey: ["kpi"] });
      if (res.status === "failed") {
        toast.error(`„${res.filename}“ enthielt keine gültige Zeile.`);
      } else if (res.status === "partial") {
        toast.warning(`„${res.filename}“ übernommen, ${res.errors.length} Zeile(n) übersprungen.`);
      } else {
        toast.success(
          `„${res.filename}“ übernommen: ${res.rows_inserted} neu, ${res.rows_updated} aktualisiert.`,
        );
      }
    },
    onError: (err: Error) => toast.error(`Upload fehlgeschlagen: ${err.message}`),
  });

  const zeitFmt = new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "short" });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Uploads</h1>
        <p className="mt-1 text-sm text-[var(--fg-muted)]">
          ERP-Exporte einlesen. Dieselbe Datei erneut hochzuladen ist gefahrlos: bestehende
            Zeilen werden aktualisiert, nicht doppelt angelegt.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {ARTEN.map((art) => (
          <Ablage
            key={art.kind}
            art={art}
            laeuft={laufend === art.kind}
            onDatei={(file) => upload.mutate({ kind: art.kind, file })}
          />
        ))}
      </div>

      {ergebnis && ergebnis.errors.length > 0 && (
        <Card className="p-4">
          <h2 className="text-base font-semibold">
            Übersprungene Zeilen aus „{ergebnis.filename}“
          </h2>
          <p className="mt-1 text-sm text-[var(--fg-muted)]">
            {ergebnis.rows_total} Zeile(n) übernommen, {ergebnis.errors.length} übersprungen. Die
            übrigen Zeilen sind gespeichert.
          </p>
          <TableWrap className="mt-3">
            <Table>
              <thead>
                <tr>
                  <Th className="w-20">Zeile</Th>
                  <Th className="w-48">Spalte</Th>
                  <Th>Grund</Th>
                </tr>
              </thead>
              <tbody>
                {ergebnis.errors.slice(0, 50).map((f, i) => (
                  <tr key={i}>
                    <Td className="font-mono tabular-nums">{f.row}</Td>
                    <Td className="font-mono text-xs">{f.field}</Td>
                    <Td>{f.message}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
          {ergebnis.errors.length > 50 && (
            <p className="mt-2 text-xs text-[var(--fg-muted)]">
              Es werden die ersten 50 von {ergebnis.errors.length} gezeigt.
            </p>
          )}
        </Card>
      )}

      <div>
        <h2 className="mb-2 text-base font-semibold">Zuletzt hochgeladen</h2>
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>Datei</Th>
                <Th>Art</Th>
                <Th className="text-right">Zeilen</Th>
                <Th className="text-right">Übersprungen</Th>
                <Th>Status</Th>
                <Th>Zeitpunkt</Th>
              </tr>
            </thead>
            <tbody>
              {(verlauf.data ?? []).map((b) => (
                <tr key={b.id}>
                  <Td className="font-mono text-xs">{b.filename}</Td>
                  <Td>{b.kind}</Td>
                  <Td className="text-right font-mono tabular-nums">{fmt.zahl(b.row_count)}</Td>
                  <Td className="text-right font-mono tabular-nums">
                    {b.error_count > 0 ? fmt.zahl(b.error_count) : "—"}
                  </Td>
                  <Td>
                    <Badge className={STATUS_KLASSE[b.status] ?? "status-none"}>
                      {STATUS_TEXT[b.status] ?? b.status}
                    </Badge>
                  </Td>
                  <Td className="text-[var(--fg-muted)]">
                    {zeitFmt.format(new Date(b.uploaded_at))}
                  </Td>
                </tr>
              ))}
              {verlauf.data?.length === 0 && (
                <tr>
                  <Td colSpan={6} className="text-[var(--fg-muted)]">
                    Noch nichts hochgeladen.
                  </Td>
                </tr>
              )}
            </tbody>
          </Table>
        </TableWrap>
      </div>
    </div>
  );
}
