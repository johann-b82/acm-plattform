import { createClient } from "@/lib/supabase/server";
import { hasLevel, type Apps } from "@/lib/auth";

/**
 * Proxy zum Signage-Stack (eigenes Compose-Projekt, eigener Port).
 *
 * Warum ein Proxy und keine direkten Aufrufe aus dem Browser:
 *   - Same-Origin bleibt erhalten, also kein CORS und keine Tokens im Browser,
 *     die auf einen fremden Origin gehen.
 *   - Die Netze der beiden Stacks bleiben getrennt; die Plattform ruft den
 *     Signage-Stack über seinen Host-Port auf (SIGNAGE_API_URL).
 *   - Das Access-Token wird serverseitig angehängt. Die Signage-API prüft es
 *     selbst (apps.signage=admin), hier wird nur vorab abgewiesen.
 *
 * Der Player und die Pis nutzen diesen Weg NICHT — sie sprechen direkt mit dem
 * Signage-Stack. Fällt die Plattform aus, bleiben die Screens unberührt.
 */

const SIGNAGE_API_URL = process.env.SIGNAGE_API_URL ?? "http://localhost:8080";

// Header, die nicht weitergereicht werden dürfen.
const HOP_BY_HOP = new Set([
  "host",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "cookie",
  "authorization",
  "content-length",
]);

async function proxy(request: Request, path: string[]): Promise<Response> {
  const supabase = await createClient();
  const [{ data: claimsData }, { data: sessionData }] = await Promise.all([
    supabase.auth.getClaims(),
    supabase.auth.getSession(),
  ]);
  const claims = claimsData?.claims as Record<string, unknown> | undefined;
  if (!claims) return Response.json({ detail: "not authenticated" }, { status: 401 });

  const apps = (claims.apps && typeof claims.apps === "object" ? claims.apps : {}) as Apps;
  if (!hasLevel(apps, "signage", "admin")) {
    return Response.json({ detail: "signage admin required" }, { status: 403 });
  }
  const token = sessionData.session?.access_token;
  if (!token) return Response.json({ detail: "no access token" }, { status: 401 });

  const target = new URL(`${SIGNAGE_API_URL}/api/signage/${path.join("/")}`);
  target.search = new URL(request.url).search;

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
  });
  headers.set("Authorization", `Bearer ${token}`);

  const hasBody = !["GET", "HEAD"].includes(request.method);
  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body: hasBody ? request.body : undefined,
    // Pflicht, wenn ein Stream als Body geht (Datei-Uploads).
    ...(hasBody ? { duplex: "half" } : {}),
    redirect: "manual",
    cache: "no-store",
  } as RequestInit);

  const outHeaders = new Headers();
  for (const key of ["content-type", "content-disposition", "cache-control", "etag"]) {
    const value = upstream.headers.get(key);
    if (value) outHeaders.set(key, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers: outHeaders });
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(request: Request, ctx: Ctx) {
  return proxy(request, (await ctx.params).path);
}
export async function POST(request: Request, ctx: Ctx) {
  return proxy(request, (await ctx.params).path);
}
export async function PUT(request: Request, ctx: Ctx) {
  return proxy(request, (await ctx.params).path);
}
export async function PATCH(request: Request, ctx: Ctx) {
  return proxy(request, (await ctx.params).path);
}
export async function DELETE(request: Request, ctx: Ctx) {
  return proxy(request, (await ctx.params).path);
}
