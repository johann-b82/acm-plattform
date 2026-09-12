"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileUp, Loader2 } from "lucide-react";

import { computeJson } from "@/lib/compute";
import { supabaseBrowser } from "@/lib/supabase/client";

import { Badge, Button, Card, Table, TableWrap, Td, Th } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { useSprache, useTexte } from "@/components/sprache/anbieter";
import { useFormate } from "@/lib/kpi/use-formate";
import { ZAHL_TAG } from "@/lib/sprache";
import { Seitenkopf } from "@/components/seitenkopf";

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
      <Seitenkopf untertitel={worte.uploads.einleitung} />

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
          <TableWrap className="mt-3">
            <Table>
              <thead>
                <tr>
                  <Th className="w-20">{worte.uploads.zeile}</Th>
                  <Th className="w-48">{worte.uploads.spalte}</Th>
                  <Th>{worte.uploads.grund}</Th>
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
        <h2 className="mb-2 text-base font-semibold">{worte.uploads.zuletzt}</h2>
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>{worte.uploads.datei}</Th>
                <Th>{worte.uploads.art}</Th>
                <Th className="text-end">{worte.uploads.zeilen}</Th>
                <Th className="text-end">{worte.uploads.uebersprungenSpalte}</Th>
                <Th>{worte.uploads.status}</Th>
                <Th>{worte.uploads.zeitpunkt}</Th>
              </tr>
            </thead>
            <tbody>
              {(verlauf.data ?? []).map((b) => (
                <tr key={b.id}>
                  <Td className="font-mono text-xs">{b.filename}</Td>
                  <Td>{arten[b.kind] ?? b.kind}</Td>
                  <Td className="text-end font-mono tabular-nums">{fmt.zahl(b.row_count)}</Td>
                  <Td className="text-end font-mono tabular-nums">
                    {b.error_count > 0 ? fmt.zahl(b.error_count) : "—"}
                  </Td>
                  <Td>
                    <Badge className={STATUS_KLASSE[b.status] ?? "status-none"}>
                      {statusText[b.status] ?? b.status}
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
                    {worte.uploads.nochNichts}
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
