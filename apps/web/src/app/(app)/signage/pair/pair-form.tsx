"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { signageApi, signageKeys } from "@/lib/signage/api";
import { Button, Card, Input, Label } from "@/components/ui/primitives";
import { TagPicker } from "@/components/signage/tag-picker";

const CODE_PATTERN = /^[A-Z0-9]{3}-[A-Z0-9]{3}$/;

/**
 * Kopplung: der Bildschirm zeigt einen sechsstelligen Code, der hier
 * eingegeben wird. Das Eingabefeld formatiert automatisch auf XXX-XXX.
 */
export function PairForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [codeError, setCodeError] = useState<string | null>(null);

  const claimMutation = useMutation({
    mutationFn: async () => {
      const tagIds = await signageApi.resolveTagIds(tags);
      return signageApi.claimPairingCode({
        code,
        device_name: name.trim(),
        tag_ids: tagIds.length > 0 ? tagIds : null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: signageKeys.devices() });
      queryClient.invalidateQueries({ queryKey: signageKeys.tags() });
      toast.success(`„${name.trim()}“ ist gekoppelt.`);
      router.push("/signage/devices");
    },
    onError: (err: Error) => {
      // Die API fasst ungültig, abgelaufen und bereits vergeben zu einem 404 zusammen.
      if (/not found|invalid|expired|claimed/i.test(err.message)) {
        setCodeError("Code unbekannt, abgelaufen oder schon vergeben. Am Bildschirm neu anzeigen lassen.");
        return;
      }
      toast.error(`Kopplung fehlgeschlagen: ${err.message}`);
    },
  });

  const codeValid = CODE_PATTERN.test(code);

  return (
    <Card className="mx-auto max-w-xl p-6">
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          setCodeError(null);
          if (!codeValid) {
            setCodeError("Format XXX-XXX erwartet.");
            return;
          }
          claimMutation.mutate();
        }}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="pair-code">Kopplungscode</Label>
          <Input
            id="pair-code"
            value={code}
            autoFocus
            autoComplete="off"
            maxLength={7}
            placeholder="ABC-123"
            onChange={(e) => {
              const cleaned = e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 6);
              setCode(cleaned.length > 3 ? `${cleaned.slice(0, 3)}-${cleaned.slice(3)}` : cleaned);
              setCodeError(null);
            }}
            className="h-14 text-center font-mono text-3xl tracking-widest"
            aria-describedby={codeError ? "pair-code-error" : undefined}
          />
          {codeError && (
            <p id="pair-code-error" role="alert" className="text-sm text-[var(--danger)]">
              {codeError}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="pair-name">Gerätename</Label>
          <Input
            id="pair-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Empfang links"
            maxLength={128}
            required
            autoComplete="off"
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label>Tags</Label>
          <TagPicker value={tags} onChange={setTags} />
          <p className="text-xs text-[var(--fg-muted)]">
            Über die Tags bekommt das Gerät seine Playlist. Ohne Tag bleibt der Bildschirm leer.
          </p>
        </div>

        <div className="flex justify-between">
          <Button
            variant="ghost"
            onClick={() => router.push("/signage/devices")}
            disabled={claimMutation.isPending}
          >
            Abbrechen
          </Button>
          <Button type="submit" disabled={claimMutation.isPending || !name.trim()}>
            Koppeln
          </Button>
        </div>
      </form>
    </Card>
  );
}
