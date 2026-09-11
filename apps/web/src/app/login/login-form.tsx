"use client";

import { useActionState } from "react";
import { signIn, type LoginState } from "./actions";
import type { Texte } from "@/texte";

export function LoginForm({ texte }: { texte: Texte["anmeldung"] }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, {});
  return (
    <form action={action} className="mt-6 flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        <span>{texte.email}</span>
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          className="h-9 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span>{texte.passwort}</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="h-9 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3"
        />
      </label>
      {state.error && (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="h-9 rounded-md bg-[var(--fg)] px-3 text-sm font-medium text-[var(--bg)] disabled:opacity-60"
      >
        {pending ? texte.laeuft : texte.knopf}
      </button>
    </form>
  );
}
