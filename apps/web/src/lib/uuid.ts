/**
 * UUID für Speicherpfade — auch ohne secure context.
 *
 * `crypto.randomUUID` gibt es nur über HTTPS oder auf localhost. Über
 * http://<LAN-IP> fehlt die Funktion, `getRandomValues` bleibt aber da;
 * daraus entsteht dieselbe Version-4-UUID von Hand.
 */
export function uuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // Version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variante 10xx
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
