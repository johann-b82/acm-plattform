"use server";

import { cookies } from "next/headers";

import { COOKIE_MAXALTER } from "@/lib/sprache";
import { SEITENLEISTE_COOKIE } from "@/lib/navigation";

/**
 * Merkt, ob die Seitenleiste eingeklappt ist. Im Cookie statt im
 * `localStorage`: das Layout liest ihn auf dem Server und zeichnet die Leiste
 * gleich richtig — sonst spränge sie nach dem Laden auf oder zu.
 */
export async function setzeSeitenleiste(eingeklappt: boolean): Promise<void> {
  (await cookies()).set(SEITENLEISTE_COOKIE, eingeklappt ? "eingeklappt" : "offen", {
    maxAge: COOKIE_MAXALTER,
    sameSite: "lax",
    path: "/",
  });
}
