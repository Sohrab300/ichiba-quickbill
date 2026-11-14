/**
 * Creates a Supabase Auth login (email + password, pre-confirmed) and its staff_profiles row
 * (REQUIREMENTS.md section 4).
 *
 *   npm run staff:create -- --email cl1@ichiba.local --password '...' --name "Counter 1" --role cashier --counter CL1
 *   npm run staff:create -- --email admin@ichiba.local --password '...' --name "Store Admin" --role admin
 *
 * Options:
 *   --email <email>       Login email (does not need to be a real mailbox; no email is sent).
 *   --password <pw>       At least 8 characters.
 *   --name <name>         Shown in the top bar and on invoices as the cashier.
 *   --role <role>         "cashier" or "admin".
 *   --counter <code>      CL1, CL2, CL3 or MOB. Required for cashiers, optional for admins.
 *
 * If the profile cannot be created, the new Auth user is deleted again, so a failed run can
 * simply be repeated. An email that already exists is rejected (nothing is changed).
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (read from .env.local / .env),
 * and the counters/staff_profiles migration applied (npx supabase db push).
 */
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/database.types";

function fail(message: string): never {
  console.error(`\nError: ${message}`);
  process.exit(1);
}

function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    if (existsSync(file)) loadEnvFile(file); // does not override variables already set
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const missing = [!url && "NEXT_PUBLIC_SUPABASE_URL", !key && "SUPABASE_SERVICE_ROLE_KEY"].filter(Boolean);
  if (missing.length) fail(`Missing ${missing.join(" and ")} (set them in .env.local).`);
  return { url: url!, key: key! };
}

async function main() {
  const { values } = parseArgs({
    options: {
      email: { type: "string" },
      password: { type: "string" },
      name: { type: "string" },
      role: { type: "string" },
      counter: { type: "string" },
    },
    strict: true,
  });

  const email = values.email?.trim().toLowerCase() ?? "";
  const password = values.password ?? "";
  const displayName = values.name?.trim() ?? "";
  const role = values.role?.trim().toLowerCase() ?? "";
  const counterCode = values.counter?.trim().toUpperCase() || null;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("--email must be an email address, e.g. cl1@ichiba.local.");
  if (password.length < 8) fail("--password must be at least 8 characters.");
  if (displayName.length < 1 || displayName.length > 80) fail("--name is required (1-80 characters).");
  if (role !== "cashier" && role !== "admin") fail('--role must be "cashier" or "admin".');
  if (role === "cashier" && !counterCode) fail("--counter is required for cashiers (CL1, CL2, CL3 or MOB).");

  const { url, key } = loadEnv();
  const supabase = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Resolve the counter first so a typo does not leave an orphan Auth user behind.
  let counterId: string | null = null;
  if (counterCode) {
    const { data: counter, error } = await supabase
      .from("counters")
      .select("id, code, is_active")
      .eq("code", counterCode)
      .maybeSingle();
    if (error) fail(`Could not read counters: ${error.message}. Has the migration been applied (npx supabase db push)?`);
    if (!counter) fail(`Counter ${counterCode} does not exist. Expected one of CL1, CL2, CL3, MOB.`);
    if (!counter.is_active) fail(`Counter ${counterCode} is disabled.`);
    counterId = counter.id;
  }

  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // no confirmation email; these are internal store logins
    user_metadata: { display_name: displayName },
  });
  if (createError || !created.user) {
    if (createError?.code === "email_exists") fail(`A login for ${email} already exists. Nothing was changed.`);
    fail(`Could not create the login: ${createError?.message ?? "unknown error"}`);
  }
  const userId = created.user.id;

  const { error: profileError } = await supabase.from("staff_profiles").insert({
    user_id: userId,
    display_name: displayName,
    role,
    counter_id: counterId,
  });
  if (profileError) {
    const { error: cleanupError } = await supabase.auth.admin.deleteUser(userId);
    fail(
      `Could not create the staff profile: ${profileError.message}. ` +
        (cleanupError
          ? `Also failed to remove the new login (${cleanupError.message}); delete ${email} in Supabase → Authentication.`
          : "The new login was removed again; fix the problem and re-run.")
    );
  }

  console.log(`Created ${role} ${email} (${displayName})${counterCode ? ` on counter ${counterCode}` : ""}.`);
}

main().catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)));
