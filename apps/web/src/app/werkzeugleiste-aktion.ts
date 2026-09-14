"use server";

import { cookies } from "next/headers";

import { COOKIE_MAXALTER } from "@/lib/sprache";
import { WERKZEUGLEISTE_COOKIE } from "@/lib/navigation";

/**
 * Merkt, ob die rechte Leiste mit Filtern und Aktionen eingeklappt ist — im
 * Cookie, aus demselben Grund wie bei der Seitenleiste: das Layout zeichnet sie
 * gleich richtig, statt sie nach dem Laden umzuklappen.
 */
export async function setzeWerkzeugleiste(eingeklappt: boolean): Promise<void> {
  (await cookies()).set(WERKZEUGLEISTE_COOKIE, eingeklappt ? "eingeklappt" : "offen", {
    maxAge: COOKIE_MAXALTER,
    sameSite: "lax",
    path: "/",
  });
}
