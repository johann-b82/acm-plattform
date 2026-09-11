/**
 * Was Browser und Server über das Logo gleichermaßen wissen müssen.
 *
 * Eigene Datei, weil `lib/logo.ts` den Browser-Client zieht: ein Server-Modul,
 * das von dort nur den Eimernamen bräuchte, schleppte ihn mit.
 */
export const LOGO_EIMER = "plattform";
export const LOGO_TYPEN = ["image/png", "image/jpeg"];
export const LOGO_MAX_BYTES = 5 * 1024 * 1024;
