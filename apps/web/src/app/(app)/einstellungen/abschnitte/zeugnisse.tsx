"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { zeugnisApi, zeugnisKeys, type Aussteller } from "@/lib/zeugnisse";
import { supabaseBrowser } from "@/lib/supabase/client";
import { Button, Card, Input, Label, Select } from "@/components/ui/primitives";

/**
 * Das Ausstellerprofil: was auf jedem Zeugnis gleich steht.
 *
 * Zwei Unterschriften stehen darunter, und nur eine davon ist für alle gleich.
 * Die **linke** ist die fachliche — der oder die Vorgesetzte der Person. Die
 * hängt an der Person, nicht am Haus, und compute löst sie beim Erzeugen aus
 * Personios Organisationsstruktur auf. Was hier steht, ist ihr Rückfall: für
 * extern gepflegte Personen, für einen nicht gepflegten Vorgesetzten, für
 * einen Abgleich, der gerade nicht gelaufen ist.
 *
 * Die **rechte** ist die personalseitige und für alle dieselbe. Sie lässt sich
 * an eine Person aus Personio binden; dann kommt der Titel von dort und muss
 * nicht nachgepflegt werden, wenn sich die Position ändert.
 */
export function Zeugnisse() {
  const queryClient = useQueryClient();
  const [entwurf, setEntwurf] = useState<Partial<Aussteller>>({});

  const profil = useQuery({
    queryKey: zeugnisKeys.aussteller(),
    queryFn: zeugnisApi.aussteller,
  });
  const personen = useQuery({
    queryKey: ["zeugnisse", "personio-personen"],
    queryFn: async () => {
      const { data, error } = await supabaseBrowser()
        .from("personio_employees")
        .select("id,first_name,last_name,department")
        .eq("status", "active")
        .order("last_name");
      if (error) throw new Error(error.message);
      return (data ?? []) as { id: number; first_name: string | null; last_name: string | null; department: string | null }[];
    },
  });

  const speichern = useMutation({
    mutationFn: (felder: Partial<Aussteller>) => zeugnisApi.ausstellerAendern(felder),
    onSuccess: () => {
      setEntwurf({});
      queryClient.invalidateQueries({ queryKey: zeugnisKeys.aussteller() });
      toast.success("Gespeichert.");
    },
    onError: (fehler: Error) => toast.error(fehler.message),
  });

  if (profil.error) {
    return (
      <Card className="p-4 text-sm text-[var(--danger)]">
        Ausstellerprofil konnte nicht geladen werden: {(profil.error as Error).message}
      </Card>
    );
  }
  if (!profil.data) return null;

  const offen = Object.keys(entwurf).length > 0;
  function wert(feld: keyof Aussteller): string {
    const v = entwurf[feld] ?? profil.data?.[feld];
    return v === null || v === undefined ? "" : String(v);
  }
  function setze(feld: keyof Aussteller, text: string) {
    setEntwurf((v) => ({ ...v, [feld]: text.trim() === "" ? null : text }));
  }

  return (
    <Card className="space-y-4 p-5">
      <h3 className="font-medium">Ausstellerprofil</h3>
      <p className="max-w-prose text-sm text-[var(--fg-muted)]">
        Steht auf jedem Zeugnis. Die Briefvorlage der ACM wird verwendet, sobald
        „ACM“ im Firmennamen steht.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <Feld id="firma" label="Firma" wert={wert("firma")} setze={(t) => setze("firma", t)} />
        <Feld
          id="standort"
          label="Ort (über dem Datum)"
          wert={wert("standort")}
          setze={(t) => setze("standort", t)}
        />
      </div>

      <div className="space-y-3 rounded-md border border-[var(--border)] p-4">
        <h4 className="text-sm font-medium">Linke Unterschrift — fachlich</h4>
        <p className="max-w-prose text-sm text-[var(--fg-muted)]">
          Normalerweise der oder die Vorgesetzte der Person; die wird beim
          Erzeugen aus Personio aufgelöst. Was hier steht, greift nur, wenn
          Personio nichts hergibt — bei extern gepflegten Personen etwa.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Feld
            id="u1name"
            label="Name (Rückfall)"
            wert={wert("unterzeichner1_name")}
            setze={(t) => setze("unterzeichner1_name", t)}
          />
          <Feld
            id="u1titel"
            label="Titel (Rückfall)"
            wert={wert("unterzeichner1_titel")}
            setze={(t) => setze("unterzeichner1_titel", t)}
          />
        </div>
      </div>

      <div className="space-y-3 rounded-md border border-[var(--border)] p-4">
        <h4 className="text-sm font-medium">Rechte Unterschrift — Personalwesen</h4>
        <p className="max-w-prose text-sm text-[var(--fg-muted)]">
          Für alle Zeugnisse dieselbe. An eine Person aus Personio gebunden,
          kommt der Titel von dort und bleibt richtig, wenn sich die Position
          ändert.
        </p>
        <div className="space-y-1">
          <Label htmlFor="hrperson" className="block">
            Person aus Personio
          </Label>
          <Select
            id="hrperson"
            className="max-w-md"
            value={wert("hr_employee_id")}
            onChange={(e) =>
              setEntwurf((v) => ({
                ...v,
                hr_employee_id: e.target.value === "" ? null : Number(e.target.value),
              }))
            }
          >
            <option value="">— keine, Freitext unten verwenden —</option>
            {(personen.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {[p.first_name, p.last_name].filter(Boolean).join(" ") || `#${p.id}`}
                {p.department ? ` · ${p.department}` : ""}
              </option>
            ))}
          </Select>
          {personen.error && (
            <p className="text-xs text-[var(--warn)]">
              Die Personenliste konnte nicht geladen werden (
              {(personen.error as Error).message}).
            </p>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Feld
            id="u2name"
            label="Name (Rückfall)"
            wert={wert("unterzeichner2_name")}
            setze={(t) => setze("unterzeichner2_name", t)}
          />
          <Feld
            id="u2titel"
            label="Titel (Rückfall)"
            wert={wert("unterzeichner2_titel")}
            setze={(t) => setze("unterzeichner2_titel", t)}
          />
        </div>
      </div>

      {offen && (
        <Button disabled={speichern.isPending} onClick={() => speichern.mutate(entwurf)}>
          {speichern.isPending ? "Speichert …" : "Speichern"}
        </Button>
      )}
    </Card>
  );
}

function Feld({
  id,
  label,
  wert,
  setze,
}: {
  id: string;
  label: string;
  wert: string;
  setze: (text: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={wert} onChange={(e) => setze(e.target.value)} />
    </div>
  );
}
