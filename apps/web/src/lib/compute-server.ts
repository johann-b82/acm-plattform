import "server-only";

/**
 * Aufrufe an `compute` vom **Server** aus — für Dinge, die keine Sitzung haben
 * (die AD-Anmeldung) oder vor dem Cookie laufen.
 *
 * Der Browser spricht `compute` same-origin über Caddy an (`computeFetch`).
 * Der Web-Server erreicht es direkt im Compose-Netz; `COMPUTE_INTERNAL_URL`
 * zeigt darauf (Vorgabe `http://compute:8000`).
 */
const BASIS = process.env.COMPUTE_INTERNAL_URL ?? "http://compute:8000";

export async function computeServerFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASIS}${path}`, { ...init, cache: "no-store" });
}
