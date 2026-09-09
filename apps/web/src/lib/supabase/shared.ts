/**
 * Fester Cookie-Name für die Sitzung.
 *
 * Server und Browser sprechen Supabase über verschiedene Adressen an (intern
 * Kong, im Browser der Plattform-Caddy). Ohne festen Namen leiten beide Seiten
 * unterschiedliche Cookie-Namen aus der URL ab und finden die Sitzung des
 * jeweils anderen nicht.
 */
export const AUTH_COOKIE = "sb-acm-auth-token";
