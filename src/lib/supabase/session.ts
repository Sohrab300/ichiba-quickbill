import "server-only";
import { cookies } from "next/headers";
import { createServerClient as createSsrClient } from "@supabase/ssr";

/** URL + publishable key for the cookie-based Auth client. Throws a clear error if unset. */
export function getAuthEnv(): { url: string; publishableKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  const missing = [
    !url && "NEXT_PUBLIC_SUPABASE_URL",
    !publishableKey && "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(
      `Supabase Auth is not configured: missing ${missing.join(" and ")}. ` +
        "Set it in .env.local (local) or in Vercel → Settings → Environment Variables, then restart or redeploy."
    );
  }
  return { url: url!, publishableKey: publishableKey! };
}

/**
 * Cookie-based Supabase client (publishable key) for **auth only**: reading the signed-in user,
 * signing in and signing out. Never use it for table access — tables have RLS with no policies,
 * and all data goes through the service-role client in ./server.ts.
 *
 * Create one per request (it carries that request's cookies).
 */
export async function createSessionClient() {
  const { url, publishableKey } = getAuthEnv();
  const cookieStore = await cookies();

  return createSsrClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only. Safe to ignore:
          // proxy.ts refreshes the session and writes the cookies on every request.
        }
      },
    },
  });
}
