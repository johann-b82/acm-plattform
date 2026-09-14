"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileUp, Loader2 } from "lucide-react";

import { computeJson } from "@/lib/compute";
import { supabaseBrowser } from "@/lib/supabase/client";

import { Badge, Button, Card } from "@/components/ui/primitives";
import { Datentabelle } from "@/components/ui/datentabelle";
import { ladeAlle } from "@/lib/seitenweise";
import { cn } from "@/lib/cn";
import { useSprache, useTexte } from "@/components/sprache/anbieter";
import { useFormate } from "@/lib/kpi/use-formate";
import { ZAHL_TAG } from "@/lib/sprache";

/**
 * Die ERP-Exporte. Jede Art hat ihren eigenen Endpunkt in compute, weil die
 * Dateien unterschiedliche Spalten haben. Der Import ist ein Upsert auf den
 * Geschäftsschlüssel der Datei — bei den Vertriebsdateien die Vorgangsnummer,
 * beim Liefertreue-Export die Position. Dieselbe Datei zweimal hochzuladen
 * ändert nichts.
 */
interface Art {
  /** Zugleich der Schlüssel im Wörterbuch: `arten[kind]` ist der Name,
   *  `arten[kind + "Text"]` die Beschreibung darunter. */
  kind: string;
  datei: string;
  /** Nur nötig, wenn die Datei keine Textdatei ist. */
  endungen?: string;
}

const ARTEN: readonly Art[] = [
  {
    kind: "umsatz",
    datei: "AswKpf_RG.txt",
  },
  {
    kind: "auftraege",
    datei: "AswKpf_AUF.txt",
  },
  {
    kind: "auftragspositionen",
    datei: "AswKpf_AUF.txt (Positionsebene)",
  },
  {
    kind: "lieferscheine",
    datei: "AswKpf_LS.xlsx",
    endungen: ".xlsx,.xls",
  },
  {
    kind: "wareneingaenge",
    datei: "AswKpf_WE.txt",
  },
  {
    kind: "acht_d",
    datei: "8D.txt",
  },
  {
    kind: "lagerbewegungen",
    datei: "AswLagBew.txt",
  },
  {
    kind: "materialpreise",
    datei: "AswKpf_WE.txt",
  },
  {
    kind: "lagerpreise",
    datei: "AswLagBew-Preiskonditionen",
  },
  {
    kind: "pruefungen",
    datei: "AswQs2151.txt",
  },
  {
    kind: "liefertreue",
    datei: "dev_excel_Liefertreue_Einkauf.txt",
  },
  {
    kind: "kontakte",
    datei: "Kontakte.txt",
  },
  {
    kind: "angebote",
    datei: "AswKpf_ANG.txt",
  },
  {
    kind: "interessenten",
    datei: "dev_excel_INT.txt",
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

// Eine feste leere Menge: `?? []` erzeugte bei jedem Rendern eine neue, und die
// Tabelle spränge jedes Mal auf Seite 1.
const KEINE_BATCHES: Batch[] = [];

const STATUS_KLASSE: Record<string, string> = {
  success: "status-ok",
  partial: "status-warn",
  failed: "status-bad",
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
  const worte = useTexte();
  const arten = worte.uploads.arten as Record<string, string>;
  const input = useRef<HTMLInputElement>(null);
  const [ueber, setUeber] = useState(false);

  return (
    <Card className="p-5">
      <h2 className="text-base font-semibold">{arten[art.kind]}</h2>
      <p className="mt-1 text-sm text-[var(--fg-muted)]">{arten[`${art.kind}Text`]}</p>
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
            <span className="text-xs text-[var(--fg-muted)]">{worte.uploads.verarbeitet}</span>
          </>
        ) : (
          <>
            <FileUp className="h-5 w-5 text-[var(--fg-muted)]" aria-hidden />
            <p className="font-mono text-sm">{art.datei}</p>
            <Button onClick={() => input.current?.click()}>{worte.uploads.dateiWaehlen}</Button>
          </>
        )}
      </div>
    </Card>
  );
}

export function UploadsAdmin() {
  const worte = useTexte();
  const fmt = useFormate();
  const arten = worte.uploads.arten as Record<string, string>;
  const statusText: Record<string, string> = {
    success: worte.uploads.vollstaendig,
    partial: worte.uploads.teilweise,
    failed: worte.uploads.fehlgeschlagen,
  };
  const queryClient = useQueryClient();
  const [ergebnis, setErgebnis] = useState<UploadErgebnis | null>(null);
  const [laufend, setLaufend] = useState<string | null>(null);

  // Der Verlauf kommt über PostgREST; die Zeilen-Policy lässt nur Nutzer mit
  // einem Recht auf die App `uploads` lesen. Vollständig, nicht die letzten 20
  // (UPL-02): die Tabelle blättert selbst. `id` als zweiter Schlüssel, damit
  // gleichzeitige Uploads beim seitenweisen Laden nicht die Seite wechseln.
  const verlauf = useQuery({
    queryKey: ["uploads", "batches"],
    queryFn: () =>
      ladeAlle<Batch>(async (von, bis) => {
        const { data, error } = await supabaseBrowser()
          .from("upload_batches")
          .select("id,filename,uploaded_at,kind,row_count,error_count,status")
          .order("uploaded_at", { ascending: false })
          .order("id", { ascending: false })
          .range(von, bis);
        if (error) throw new Error(error.message);
        return data as Batch[];
      }),
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
        toast.error(worte.uploads.keineZeile(res.filename));
      } else if (res.status === "partial") {
        toast.warning(worte.uploads.teilweiseUebernommen(res.filename, res.errors.length));
      } else {
        toast.success(
          worte.uploads.uebernommen(res.filename, res.rows_inserted, res.rows_updated),
        );
      }
    },
    onError: (err: Error) => toast.error(worte.uploads.fehlgeschlagenMeldung(err.message)),
  });

  const zeitFmt = new Intl.DateTimeFormat(ZAHL_TAG[useSprache()], {
    dateStyle: "short",
    timeStyle: "short",
  });

  return (
    <div className="space-y-6">

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
            {worte.uploads.uebersprungen(ergebnis.filename)}
          </h2>
          <p className="mt-1 text-sm text-[var(--fg-muted)]">
            {worte.uploads.uebersprungenHinweis(
              fmt.zahl(ergebnis.rows_total),
              ergebnis.errors.length,
            )}
          </p>
          <div className="mt-3">
            <Datentabelle
              zeilen={ergebnis.errors}
              zeilenSchluessel={(f) => `${f.row}|${f.field}|${f.message}`}
              beschriftung={worte.uploads.uebersprungen(ergebnis.filename)}
              vorsortierung={{ spalte: "zeile", richtung: "auf" }}
              spalten={[
                {
                  schluessel: "zeile",
                  titel: worte.uploads.zeile,
                  typ: "zahl",
                  wert: (f) => f.row,
                  className: "w-20 font-mono",
                },
                {
                  schluessel: "spalte",
                  titel: worte.uploads.spalte,
                  typ: "text",
                  wert: (f) => f.field,
                  className: "w-48 font-mono text-xs",
                },
                { schluessel: "grund", titel: worte.uploads.grund, typ: "text", wert: (f) => f.message },
              ]}
            />
          </div>
        </Card>
      )}

      <div>
        <h2 className="mb-2 text-base font-semibold">{worte.uploads.zuletzt}</h2>
        <Datentabelle
          zeilen={verlauf.data ?? KEINE_BATCHES}
          laedt={verlauf.isLoading}
          leer={worte.uploads.nochNichts}
          zeilenSchluessel={(b) => b.id}
          beschriftung={worte.uploads.zuletzt}
          spalten={[
            {
              schluessel: "datei",
              titel: worte.uploads.datei,
              typ: "text",
              wert: (b) => b.filename,
              className: "font-mono text-xs",
            },
            {
              schluessel: "art",
              titel: worte.uploads.art,
              typ: "text",
              wert: (b) => arten[b.kind] ?? b.kind,
            },
            {
              schluessel: "zeilen",
              titel: worte.uploads.zeilen,
              typ: "zahl",
              wert: (b) => b.row_count,
              zelle: (b) => fmt.zahl(b.row_count),
              ausrichtung: "end",
            },
            {
              schluessel: "uebersprungen",
              titel: worte.uploads.uebersprungenSpalte,
              typ: "zahl",
              wert: (b) => b.error_count,
              zelle: (b) => (b.error_count > 0 ? fmt.zahl(b.error_count) : "—"),
              ausrichtung: "end",
            },
            {
              schluessel: "status",
              titel: worte.uploads.status,
              typ: "text",
              wert: (b) => statusText[b.status] ?? b.status,
              zelle: (b) => (
                <Badge className={STATUS_KLASSE[b.status] ?? "status-none"}>
                  {statusText[b.status] ?? b.status}
                </Badge>
              ),
            },
            {
              schluessel: "zeitpunkt",
              titel: worte.uploads.zeitpunkt,
              typ: "datum",
              wert: (b) => b.uploaded_at,
              zelle: (b) => zeitFmt.format(new Date(b.uploaded_at)),
              suchtext: (b) => zeitFmt.format(new Date(b.uploaded_at)),
              className: "text-[var(--fg-muted)]",
            },
          ]}
        />
      </div>
    </div>
  );
}
