"use client";

import { useActionState, useState } from "react";
import { signIn, signInAd, type LoginState } from "./actions";
import type { Texte } from "@/texte";

const FELD = "h-9 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3";

export function LoginForm({ texte, adAktiv = false }: { texte: Texte["anmeldung"]; adAktiv?: boolean }) {
  // Ist AD eingerichtet, ist es der Standardweg; der Break-Glass-Admin kann
  // über den Link auf die lokale Anmeldung wechseln.
  const [ad, setAd] = useState(adAktiv);

  return (
    <div className="mt-6">
      {ad ? <AdForm texte={texte} /> : <LokalForm texte={texte} />}
      {adAktiv && (
        <button
          type="button"
          onClick={() => setAd((v) => !v)}
          className="mt-4 text-sm text-[var(--fg-muted)] underline underline-offset-4"
        >
          {ad ? texte.lokalWechseln : texte.adWechseln}
        </button>
      )}
    </div>
  );
}

function LokalForm({ texte }: { texte: Texte["anmeldung"] }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        <span>{texte.email}</span>
        <input name="email" type="email" autoComplete="username" required className={FELD} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span>{texte.passwort}</span>
        <input name="password" type="password" autoComplete="current-password" required className={FELD} />
      </label>
      <Fehler state={state} />
      <Knopf pending={pending} texte={texte} />
    </form>
  );
}

function AdForm({ texte }: { texte: Texte["anmeldung"] }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(signInAd, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        <span>{texte.benutzer}</span>
        <input name="benutzer" type="text" autoComplete="username" required autoFocus className={FELD} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span>{texte.passwort}</span>
        <input name="password" type="password" autoComplete="current-password" required className={FELD} />
      </label>
      <Fehler state={state} />
      <Knopf pending={pending} texte={texte} />
    </form>
  );
}

function Fehler({ state }: { state: LoginState }) {
  if (!state.error) return null;
  return (
    <p role="alert" className="text-sm text-[var(--danger)]">
      {state.error}
    </p>
  );
}

function Knopf({ pending, texte }: { pending: boolean; texte: Texte["anmeldung"] }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-9 rounded-md bg-[var(--fg)] px-3 text-sm font-medium text-[var(--bg)] disabled:opacity-60"
    >
      {pending ? texte.laeuft : texte.knopf}
    </button>
  );
}
