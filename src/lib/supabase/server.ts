import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/**
 * Creates and returns a Supabase client configured with the service role key.
 * This runs strictly on the server and bypasses Row Level Security (RLS).
 * Never import or execute this module in client components.
 */
export function createServerClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    // Provide fallback during build-time page rendering or type-checking
    if (process.env.NODE_ENV === "production" && !process.env.VERCEL) {
      // Allow build step to succeed when env vars are not set during CI/local build
      return createClient<Database>(
        supabaseUrl || "https://placeholder-project.supabase.co",
        serviceRoleKey || "placeholder-service-role-key",
        {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
          },
        }
      );
    }
  }

  return createClient<Database>(
    supabaseUrl || "https://placeholder-project.supabase.co",
    serviceRoleKey || "placeholder-service-role-key",
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );
}

export const getSupabaseServer = createServerClient;
export default createServerClient;
