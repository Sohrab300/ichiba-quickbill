"use server";

// Sign-in / sign-out are the only Server Actions that do not call getStaffContext() first:
// sign-in creates the session, and sign-out only clears this browser's own cookies.

import { redirect } from "next/navigation";
import { z } from "zod";
import { AuthError, loadStaffProfile, safeNextPath } from "./auth";
import { createSessionClient } from "./supabase/session";

export interface SignInState {
  error?: string;
  email?: string;
}

const signInSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1).max(256),
});

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "");
  const parsed = signInSchema.safeParse({ email, password: formData.get("password") });
  if (!parsed.success) return { error: "Enter a valid email and password.", email };

  const supabase = await createSessionClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error || !data.user) {
    if (error?.code === "invalid_credentials") return { error: "Wrong email or password.", email };
    console.error("Sign-in failed", error);
    return { error: error?.message ?? "Sign-in failed. Please try again.", email };
  }

  // A valid Auth user is not enough: it needs an active staff profile (and counter).
  try {
    await loadStaffProfile(data.user.id);
  } catch (err) {
    await supabase.auth.signOut({ scope: "local" });
    if (err instanceof AuthError) return { error: err.message, email };
    console.error("Staff profile check failed", err);
    return { error: "Could not check this login's staff profile. Please try again.", email };
  }

  redirect(safeNextPath(formData.get("next")));
}

export async function signOut(): Promise<void> {
  const supabase = await createSessionClient();
  // "local": only this device. Mobile cashiers may share a login across several phones.
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}
