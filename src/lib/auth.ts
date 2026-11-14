import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createServerClient } from "./supabase/server";
import { createSessionClient } from "./supabase/session";

export type StaffRole = "admin" | "cashier";

export interface Counter {
  id: string;
  code: string;
  invoicePrefix: string;
  kind: "desk" | "mobile";
  printWidthMm: 58 | 80;
}

export interface StaffContext {
  userId: string;
  displayName: string;
  role: StaffRole;
  /** Always set for cashiers. An admin may have no counter (catalog/settings only). */
  counter: Counter | null;
}

/** Thrown when the request has no valid session (401) or the login may not do this (403). */
export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Loads and checks the staff profile + counter for an Auth user id, using the service-role
 * client (staff_profiles and counters have no RLS policies).
 */
export async function loadStaffProfile(userId: string): Promise<StaffContext> {
  const { data: profile, error } = await createServerClient()
    .from("staff_profiles")
    .select("display_name, role, is_active, counters(id, code, invoice_prefix, kind, print_width_mm, is_active)")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Could not load staff profile: ${error.message}`);

  if (!profile) throw new AuthError("This login has no staff profile. Ask an admin to set it up.", 403);
  if (!profile.is_active) throw new AuthError("This login has been disabled. Ask an admin.", 403);
  if (profile.role !== "admin" && profile.role !== "cashier") {
    throw new AuthError("This login has an unknown role. Ask an admin.", 403);
  }

  const c = profile.counters;
  if (!c && profile.role === "cashier") {
    throw new AuthError("This login is not assigned to a counter. Ask an admin.", 403);
  }
  if (c && !c.is_active) throw new AuthError(`Counter ${c.code} is disabled. Ask an admin.`, 403);

  return {
    userId,
    displayName: profile.display_name,
    role: profile.role,
    counter: c
      ? {
          id: c.id,
          code: c.code,
          invoicePrefix: c.invoice_prefix,
          kind: c.kind === "mobile" ? "mobile" : "desk",
          printWidthMm: c.print_width_mm === 58 ? 58 : 80,
        }
      : null,
  };
}

/** One session + profile read per request, shared by the Navbar, the page and its actions. */
const loadStaffContext = cache(async (): Promise<StaffContext> => {
  // Auth is per-request: opt out of prerendering before the JWT check (which reads the clock).
  await connection();
  const auth = await createSessionClient();
  // getClaims() verifies the JWT (and refreshes it if needed); never trust getSession() here.
  const { data, error } = await auth.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || !userId) throw new AuthError("Not signed in. Please sign in again.", 401);
  return loadStaffProfile(userId);
});

/**
 * The signed-in staff member, their role and their counter — derived only from the session
 * cookie and staff_profiles, never from anything the browser sends.
 *
 * Call it first in every Server Action and Route Handler. Throws AuthError 401 (no session)
 * or 403 (no/disabled profile or counter, or `requiredRole` not met).
 */
export async function getStaffContext(requiredRole?: "admin"): Promise<StaffContext> {
  const staff = await loadStaffContext();
  if (requiredRole === "admin" && staff.role !== "admin") {
    throw new AuthError("Only an admin can do this.", 403);
  }
  return staff;
}

/** Like getStaffContext(), but returns the AuthError instead of throwing it. */
export async function tryGetStaffContext(): Promise<
  { staff: StaffContext; authError: null } | { staff: null; authError: AuthError }
> {
  try {
    return { staff: await getStaffContext(), authError: null };
  } catch (err) {
    if (err instanceof AuthError) return { staff: null, authError: err };
    throw err;
  }
}

/** For Server Components: the staff context, or a redirect to /login. */
export async function requireStaffForPage(): Promise<StaffContext> {
  const { staff } = await tryGetStaffContext();
  if (!staff) redirect("/login");
  return staff;
}

/** Only same-origin paths ("/products"), never "//evil.com" or absolute URLs. */
export function safeNextPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/";
  }
  return value;
}
