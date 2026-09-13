"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";

import { emailApi, emailKeys, type EmailModus, type EmailStand } from "@/lib/email";
import { Button, Card, Input, Label } from "@/components/ui/primitives";
import { useTexte } from "@/components/sprache/anbieter";

/**
 * E-Mail-Versand über Microsoft 365 / Graph (SET-16).
 *
 * Zwei Wege: App-Berechtigung (Tenant, Client-ID, geschütztes Secret,
 * Absender) oder eigener Account (delegiert, Geräte-Code-Anmeldung). Geheimnis
 * und Token gehen verschlüsselt nach `compute` und kommen nie zurück. Versendet
 * wird nur die ausdrückliche Testmail — nicht beim Öffnen oder Speichern.
 */
export function Email() {
  const worte = useTexte().einstellungenText.email;
  const queryClient = useQueryClient();
  const stand = useQuery({ queryKey: emailKeys.stand(), queryFn: emailApi.stand });

  return (
    <Card className="space-y-5 p-5">
      <div>
        <h3 className="font-medium">{worte.titel}</h3>
        <p className="mt-1 max-w-prose text-sm text-[var(--fg-muted)]">{worte.einleitung}</p>
        {stand.data && !stand.data.schluessel_bereit && (
          <p className="mt-2 text-sm text-[var(--warn)]">{worte.ohneSchluessel}</p>
        )}
      </div>
      {stand.data && <Formular stand={stand.data} onGespeichert={() => queryClient.invalidateQueries({ queryKey: emailKeys.stand() })} />}
    </Card>
  );
}

function Formular({ stand, onGespeichert }: { stand: EmailStand; onGespeichert: () => void }) {
  const worte = useTexte().einstellungenText.email;
  const [aktiv, setAktiv] = useState(stand.aktiv);
  const [modus, setModus] = useState<EmailModus>(stand.modus);
  const [tenant, setTenant] = useState(stand.tenant_id ?? "");
  const [clientId, setClientId] = useState(stand.client_id ?? "");
  const [secret, setSecret] = useState("");
  const [absender, setAbsender] = useState(stand.absender ?? "");
  const [absenderName, setAbsenderName] = useState(stand.absender_name ?? "");
  const [testAn, setTestAn] = useState("");

  const speichern = useMutation({
    mutationFn: () =>
      emailApi.speichern({
        aktiv,
        modus,
        tenant_id: tenant,
        client_id: clientId,
        client_secret: secret,
        absender,
        absender_name: absenderName,
      }),
    onSuccess: () => {
      toast.success(worte.gespeichert);
      setSecret("");
      onGespeichert();
    },
    onError: (err: Error) => toast.error(worte.speichernFehler(err.message)),
  });

  const testen = useMutation({
    mutationFn: () => emailApi.testen(testAn.trim()),
    onSuccess: (v) => (v.ok ? toast.success(worte.testOk) : toast.error(v.fehler ?? worte.testFehler)),
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="space-y-5">
      <div>
        <span className="text-sm font-medium">{worte.modus}</span>
        <div className="mt-1 flex flex-wrap gap-4">
          {(["app", "delegiert"] as const).map((m) => (
            <label key={m} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="email-modus"
                checked={modus === m}
                onChange={() => setModus(m)}
                className="accent-[var(--ring)]"
              />
              {m === "app" ? worte.modusApp : worte.modusDelegiert}
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-[var(--fg-muted)]">
          {modus === "app" ? worte.modusAppHinweis : worte.modusDelegiertHinweis}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Feld id="email-tenant" label={worte.tenantId} value={tenant} onChange={setTenant} />
        <Feld id="email-client" label={worte.clientId} value={clientId} onChange={setClientId} />
        {modus === "app" && (
          <>
            <div className="flex flex-col gap-1">
              <Label htmlFor="email-secret">{worte.clientSecret}</Label>
              <Input
                id="email-secret"
                type="password"
                autoComplete="new-password"
                value={secret}
                placeholder={stand.secret_gesetzt ? worte.secretGesetzt : ""}
                onChange={(e) => setSecret(e.target.value)}
              />
            </div>
            <Feld id="email-absender" label={worte.absender} value={absender} onChange={setAbsender} type="email" />
            <Feld id="email-absender-name" label={worte.absenderName} value={absenderName} onChange={setAbsenderName} />
          </>
        )}
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={aktiv} onChange={(e) => setAktiv(e.target.checked)} className="accent-[var(--ring)]" />
        {worte.aktivieren}
      </label>

      <div>
        <Button disabled={speichern.isPending} onClick={() => speichern.mutate()}>
          {speichern.isPending ? worte.speichert : worte.speichern}
        </Button>
      </div>

      {modus === "delegiert" && <Delegiert stand={stand} onGespeichert={onGespeichert} />}

      <div className="border-t border-[var(--border)] pt-4">
        <h4 className="text-sm font-medium">{worte.testTitel}</h4>
        <p className="mt-1 max-w-prose text-sm text-[var(--fg-muted)]">{worte.testHinweis}</p>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="email-test">{worte.testEmpfaenger}</Label>
            <Input
              id="email-test"
              type="email"
              value={testAn}
              placeholder="name@firma.de"
              onChange={(e) => setTestAn(e.target.value)}
              className="w-64"
            />
          </div>
          <Button
            variant="outline"
            disabled={!testAn.trim() || testen.isPending}
            onClick={() => testen.mutate()}
          >
            <Send className="me-1.5 h-4 w-4" aria-hidden />
            {testen.isPending ? worte.testLaeuft : worte.testSenden}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Delegiert({ stand, onGespeichert }: { stand: EmailStand; onGespeichert: () => void }) {
  const worte = useTexte().einstellungenText.email;
  const [code, setCode] = useState<{ device_code: string; user_code: string; verification_uri: string; interval: number } | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const start = useMutation({
    mutationFn: emailApi.delegiertStart,
    onSuccess: (c) => {
      setCode(c);
      setLaeuft(true);
      abfragen(c.device_code, c.interval);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const trennen = useMutation({
    mutationFn: emailApi.delegiertTrennen,
    onSuccess: () => {
      toast.success(worte.getrennt);
      onGespeichert();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function abfragen(deviceCode: string, intervall: number) {
    timer.current = setTimeout(async () => {
      try {
        const r = await emailApi.delegiertAbfragen(deviceCode);
        if (r.status === "pending") {
          abfragen(deviceCode, intervall);
          return;
        }
        setLaeuft(false);
        setCode(null);
        if (r.status === "complete") {
          toast.success(worte.verbundenMit(r.konto ?? ""));
          onGespeichert();
        } else {
          toast.error(r.fehler ?? worte.testFehler);
        }
      } catch (err) {
        setLaeuft(false);
        setCode(null);
        toast.error(err instanceof Error ? err.message : String(err));
      }
    }, Math.max(1, intervall) * 1000);
  }

  return (
    <div className="rounded-md border border-[var(--border)] p-4">
      <h4 className="text-sm font-medium">{worte.delegiertTitel}</h4>
      {stand.delegiert_verbunden ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm">{worte.verbundenMit(stand.delegiert_konto ?? "")}</span>
          <Button variant="outline" size="sm" disabled={trennen.isPending} onClick={() => trennen.mutate()}>
            {worte.trennen}
          </Button>
        </div>
      ) : laeuft && code ? (
        <div className="mt-2 space-y-2 text-sm">
          <p>{worte.delegiertAnleitung}</p>
          <p>
            <a href={code.verification_uri} target="_blank" rel="noreferrer" className="text-[var(--ring)] underline">
              {code.verification_uri}
            </a>
          </p>
          <p className="font-mono text-lg font-semibold tracking-widest">{code.user_code}</p>
          <p className="flex items-center gap-1.5 text-[var(--fg-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {worte.delegiertWartet}
          </p>
        </div>
      ) : (
        <Button variant="outline" size="sm" className="mt-2" disabled={start.isPending} onClick={() => start.mutate()}>
          {worte.delegiertAnmelden}
        </Button>
      )}
    </div>
  );
}

function Feld({
  id,
  label,
  value,
  onChange,
  type = "text",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (wert: string) => void;
  type?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
