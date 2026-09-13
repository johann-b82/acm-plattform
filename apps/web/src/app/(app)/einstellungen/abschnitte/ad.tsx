"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { adApi, adKeys, type AdKonfig } from "@/lib/ad-einstellungen";
import { Button, Card, Input, Label, Switch } from "@/components/ui/primitives";
import { Hinweis } from "@/components/ui/hinweis";

type Felder = Omit<AdKonfig, "dienst_passwort_gesetzt" | "schluessel_bereit">;

/**
 * Anbindung an ein lokales AD über LDAPS (ADR-0004). `compute` prüft das
 * AD-Passwort beim Login per Bind und spiegelt die AD-Gruppen in „Nutzer und
 * Gruppen"; App-Rechte vergibt weiter ein Admin je Gruppe.
 *
 * Das Dienstkonto-Passwort geht wie jede andere Zugangsdatum über `compute`
 * verschlüsselt in die Datenbank und nie wieder heraus — angezeigt wird nur,
 * ob eines hinterlegt ist.
 */
export function ActiveDirectory() {
  const queryClient = useQueryClient();
  // Änderungen liegen als Overlay über den geladenen Werten — kein Effekt, der
  // Query-Daten in lokalen Zustand kopiert.
  const [aenderung, setAenderung] = useState<Partial<Felder>>({});
  const [passwort, setPasswort] = useState("");

  const stand = useQuery({ queryKey: adKeys.konfig(), queryFn: adApi.lesen });
  const geladen = stand.data;

  const wert = <K extends keyof Felder>(k: K, vorgabe: Felder[K]): Felder[K] =>
    (aenderung[k] ?? (geladen ? (geladen[k] as Felder[K]) : undefined) ?? vorgabe) as Felder[K];
  const setzen = <K extends keyof Felder>(k: K, v: Felder[K]) => setAenderung((a) => ({ ...a, [k]: v }));

  const speichern = useMutation({
    mutationFn: () =>
      adApi.speichern({
        aktiv: wert("aktiv", false),
        host: wert("host", ""),
        port: wert("port", 636),
        upn_suffix: wert("upn_suffix", ""),
        basis_dn: wert("basis_dn", ""),
        dienst_konto_dn: wert("dienst_konto_dn", ""),
        gruppen_basis_dn: wert("gruppen_basis_dn", ""),
        tls_pruefen: wert("tls_pruefen", true),
      }),
    onSuccess: () => {
      setAenderung({});
      toast.success("Gespeichert.");
      queryClient.invalidateQueries({ queryKey: adKeys.konfig() });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const passwortSetzen = useMutation({
    mutationFn: () => adApi.passwortSetzen(passwort.trim()),
    onSuccess: () => {
      setPasswort("");
      toast.success("Dienstkonto-Passwort hinterlegt.");
      queryClient.invalidateQueries({ queryKey: adKeys.konfig() });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Switch checked={wert("aktiv", false)} onCheckedChange={(an) => setzen("aktiv", an)} label="AD-Anmeldung aktiv" />
          AD-Anmeldung aktiv
        </div>
        {geladen && !geladen.schluessel_bereit && (
          <Hinweis text="Ohne GEHEIM_SCHLUESSEL in der Umgebung von compute lässt sich das Dienstkonto-Passwort nicht verschlüsseln." />
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Feld label="Host (Domain-Controller)" wert={wert("host", "") ?? ""} setzen={(v) => setzen("host", v)} platzhalter="dc01.firma.local" />
        <Feld label="Port" wert={String(wert("port", 636))} setzen={(v) => setzen("port", Number(v) || 636)} typ="number" />
        <Feld label="Basis-DN" wert={wert("basis_dn", "") ?? ""} setzen={(v) => setzen("basis_dn", v)} platzhalter="DC=firma,DC=local" />
        <Feld label="UPN-Suffix (ohne Dienstkonto)" wert={wert("upn_suffix", "") ?? ""} setzen={(v) => setzen("upn_suffix", v)} platzhalter="firma.local" />
        <Feld label="Dienstkonto-DN (optional)" wert={wert("dienst_konto_dn", "") ?? ""} setzen={(v) => setzen("dienst_konto_dn", v)} platzhalter="CN=svc-acm,OU=Dienste,DC=firma,DC=local" />
        <Feld label="Gruppen-Basis-DN (optional)" wert={wert("gruppen_basis_dn", "") ?? ""} setzen={(v) => setzen("gruppen_basis_dn", v)} platzhalter="OU=Gruppen,DC=firma,DC=local" />
      </div>

      <div className="flex items-center gap-2 text-sm">
        <Switch checked={wert("tls_pruefen", true)} onCheckedChange={(an) => setzen("tls_pruefen", an)} label="Zertifikat prüfen" />
        Zertifikat des Domain-Controllers prüfen (empfohlen)
      </div>

      <div>
        <Button onClick={() => speichern.mutate()} disabled={speichern.isPending}>
          {speichern.isPending ? "Speichern …" : "Speichern"}
        </Button>
      </div>

      <div className="border-t border-[var(--border)] pt-4">
        <Label>Dienstkonto-Passwort</Label>
        <p className="mt-1 text-sm text-[var(--fg-muted)]">
          {geladen?.dienst_passwort_gesetzt ? "Hinterlegt. Leer lassen behält es." : "Noch keins hinterlegt."}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Input
            type="password"
            value={passwort}
            autoComplete="off"
            placeholder="••••••••"
            onChange={(e) => setPasswort(e.target.value)}
            className="max-w-xs"
          />
          <Button variant="outline" disabled={!passwort.trim() || passwortSetzen.isPending} onClick={() => passwortSetzen.mutate()}>
            {passwortSetzen.isPending ? "…" : "Hinterlegen"}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function Feld({
  label,
  wert,
  setzen,
  platzhalter,
  typ = "text",
}: {
  label: string;
  wert: string;
  setzen: (v: string) => void;
  platzhalter?: string;
  typ?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <Input type={typ} value={wert} placeholder={platzhalter} onChange={(e) => setzen(e.target.value)} />
    </label>
  );
}
