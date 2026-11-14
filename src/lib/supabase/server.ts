import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

let client: SupabaseClient<Database> | null = null;

/**
 * Server-only Supabase client using the secret (service role) key. Bypasses RLS, so it must
 * never reach the browser.
 *
 * Env vars are read on first use, not at import time, so `next build` works without them. A
 * request that needs the database fails with a clear error instead of silently talking to a
 * placeholder project.
 */
export function createServerClient(): SupabaseClient<Database> {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const missing = [
    !url && "NEXT_PUBLIC_SUPABASE_URL",
    !key && "SUPABASE_SERVICE_ROLE_KEY",
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(
      `Supabase is not configured: missing ${missing.join(" and ")}. ` +
        "Set it in .env.local (local) or in Vercel → Settings → Environment Variables, then restart or redeploy."
    );
  }
  try {
    new URL(url!);
  } catch {
    throw new Error("Supabase is not configured: NEXT_PUBLIC_SUPABASE_URL is not a valid URL.");
  }

  client = createClient<Database>(url!, key!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

export const getSupabaseServer = createServerClient;
export default createServerClient;
