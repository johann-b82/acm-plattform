import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, supabaseInternalUrl } from "@/lib/supabase/server";

/**
 * Hält die Supabase-Session frisch (Refresh-Token einmal pro Navigation) und
 * leitet ohne Session auf /login. Die eigentliche Autorisierung je App macht
 * die Data-Access-Schicht (lib/auth.ts) in den Seiten — nicht der Proxy.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseInternalUrl(), process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookieOptions: { name: AUTH_COOKIE },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const isLogin = request.nextUrl.pathname.startsWith("/login");

  if (!data?.claims && !isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  if (data?.claims && isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  // Alles außer statischen Assets, den (später) öffentlichen Embed-Routen und
  // den Route Handlern: eine API darf 401 als JSON antworten, nicht auf die
  // Login-Seite umleiten — ein fetch könnte damit nichts anfangen.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/|embed/).*)"],
};
