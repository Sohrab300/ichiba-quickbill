import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/** Paths reachable without a session. */
const PUBLIC_PATHS = ["/login"];

/**
 * Refreshes the Supabase Auth session cookies on every request and sends signed-out users to
 * /login. This is only an optimistic gate: every Server Action and Route Handler still calls
 * getStaffContext() itself (see src/lib/auth.ts).
 */
export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !publishableKey) {
    // Fail closed rather than serving the app without auth.
    return new NextResponse(
      "Supabase Auth is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
      { status: 500 }
    );
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        // Make the refreshed tokens visible to this request's Server Components / Actions…
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        // …and send them back to the browser, uncacheable.
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });

  // Must run before anything else: verifies the JWT and refreshes an expired session.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  const { pathname, search } = request.nextUrl;
  if (signedIn || PUBLIC_PATHS.includes(pathname)) return response;

  if (pathname.startsWith("/api/")) {
    return withCookies(
      NextResponse.json({ success: false, error: "Not signed in", statusCode: 401 }, { status: 401 }),
      response
    );
  }

  // Server Action calls are POSTs to the page URL. A redirect would break the action's response
  // parsing, so let it through: the action's own getStaffContext() check returns a 401 result.
  if (request.method !== "GET" && request.method !== "HEAD") return response;

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  if (pathname !== "/") loginUrl.searchParams.set("next", pathname + search);
  return withCookies(NextResponse.redirect(loginUrl), response);
}

/** Carries cookies set during the refresh (e.g. a cleared, invalid session) onto another response. */
function withCookies(target: NextResponse, source: NextResponse): NextResponse {
  for (const cookie of source.cookies.getAll()) target.cookies.set(cookie);
  const cacheControl = source.headers.get("cache-control");
  if (cacheControl) target.headers.set("cache-control", cacheControl);
  return target;
}

export const config = {
  matcher: [
    // Everything except Next.js internals and static files.
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|webmanifest)$).*)",
  ],
};
