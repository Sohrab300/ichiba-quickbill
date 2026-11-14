"use server";

// Admin settings: store header, FY label, counter prefixes and print widths
// (REQUIREMENTS.md sections 1, 4, 5). Like every action, each one calls getStaffContext() first.
//
// Issued invoices never change here: invoices snapshot their number, FY, counter code and the
// whole store header when they are created, and are immutable in the database. A new FY or
// prefix only affects invoices issued after the change.

import { z } from "zod";
import { refresh } from "next/cache";
import type { PostgrestError } from "@supabase/supabase-js";
import { AuthError, getStaffContext } from "./auth";
import { createServerClient } from "./supabase/server";
import type { ActionResult } from "./actions";

function fail(error: string, statusCode: number): ActionResult<never> {
  return { success: false, error, statusCode };
}

function fromException(err: unknown, fallback: string): ActionResult<never> {
  if (err instanceof AuthError) return fail(err.message, err.status);
  console.error(fallback, err);
  return fail(fallback, 500);
}

function issues(error: z.ZodError): string {
  return error.issues.map((i) => i.message).join("; ");
}

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} is too long`)
    .transform((v) => (v === "" ? null : v))
    .nullable();

/** "26-27": two consecutive years (1 Apr 2026 – 31 Mar 2027). "99-00" is allowed. */
const fyLabelSchema = z
  .string()
  .trim()
  .regex(/^\d{2}-\d{2}$/, "FY must look like 26-27")
  .refine((v) => (Number(v.slice(0, 2)) + 1) % 100 === Number(v.slice(3)), "FY must be two consecutive years, e.g. 26-27");

const storeSettingsSchema = z.object({
  legalName: z.string().trim().min(1, "Legal name is required").max(200, "Legal name is too long"),
  address: z.string().trim().min(1, "Address is required").max(500, "Address is too long"),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9+\-() ]{0,20}$/, "Phone: digits, spaces, + - ( ) only, up to 20")
    .transform((v) => (v === "" ? null : v))
    .nullable(),
  gstin: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .pipe(z.string().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, "GSTIN is not valid (15 characters, e.g. 06ABLFA8216A1ZT)")),
  stateName: z.string().trim().min(1, "State is required").max(50, "State is too long"),
  fyLabel: fyLabelSchema,
  invoiceFooter: optionalText(500, "Footer"),
  defaultPrintWidthMm: z.union([z.literal(58), z.literal(80)], { error: "Print width must be 58 or 80 mm" }),
});

export type StoreSettingsInput = z.input<typeof storeSettingsSchema>;

/** Updates the single store_settings row. The GST state code is taken from the GSTIN. */
export async function updateStoreSettings(input: StoreSettingsInput): Promise<ActionResult<null>> {
  try {
    await getStaffContext("admin");
    const parsed = storeSettingsSchema.safeParse(input);
    if (!parsed.success) return fail(issues(parsed.error), 400);
    const s = parsed.data;

    const { error, count } = await createServerClient()
      .from("store_settings")
      .update(
        {
          legal_name: s.legalName,
          address: s.address,
          phone: s.phone,
          gstin: s.gstin,
          state_code: s.gstin.slice(0, 2),
          state_name: s.stateName,
          fy_label: s.fyLabel,
          invoice_footer: s.invoiceFooter,
          default_print_width_mm: s.defaultPrintWidthMm,
        },
        { count: "exact" }
      )
      .eq("id", true);
    if (error) {
      console.error("updateStoreSettings failed", error);
      return fail(error.code === "23514" ? "A value was rejected by the database check." : `Could not save: ${error.message}`, error.code === "23514" ? 400 : 500);
    }
    if (count === 0) return fail("Store settings row is missing. Apply the migrations.", 500);

    refresh();
    return { success: true, data: null, statusCode: 200 };
  } catch (err: unknown) {
    return fromException(err, "Could not save the store settings.");
  }
}

const counterSchema = z.object({
  id: z.uuid("Invalid counter"),
  invoicePrefix: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase())
    .pipe(z.string().regex(/^[A-Z0-9]{1,8}$/, "Prefix: 1–8 letters or digits")),
  printWidthMm: z.union([z.literal(58), z.literal(80)], { error: "Print width must be 58 or 80 mm" }),
});

export type CounterSettingsInput = z.input<typeof counterSchema>;

function counterDbError(error: PostgrestError): ActionResult<never> {
  const text = `${error.message} ${error.details ?? ""}`;
  if (error.code === "23505" && text.includes("counters_invoice_prefix_key")) {
    return fail("Another counter already uses this prefix.", 409);
  }
  // counters_prefix_guard (invoice history migration).
  if (error.code === "22023") return fail(error.message, 409);
  if (error.code === "23514") return fail("A value was rejected by the database check.", 400);
  console.error("updateCounter failed", error);
  return fail(`Could not save the counter: ${error.message}`, 500);
}

/**
 * Changes a counter's invoice prefix and receipt width. A prefix that another counter has
 * already issued invoices under is refused (its numbers could collide with existing ones);
 * the database enforces the same rule.
 */
export async function updateCounter(input: CounterSettingsInput): Promise<ActionResult<null>> {
  try {
    await getStaffContext("admin");
    const parsed = counterSchema.safeParse(input);
    if (!parsed.success) return fail(issues(parsed.error), 400);
    const c = parsed.data;
    const supabase = createServerClient();

    const { data: usedElsewhere, error: checkError } = await supabase
      .from("invoices")
      .select("counter_code")
      .neq("counter_id", c.id)
      .like("invoice_no", `${c.invoicePrefix}/%`)
      .limit(1);
    if (checkError) return counterDbError(checkError);
    if (usedElsewhere.length > 0) {
      return fail(
        `Prefix ${c.invoicePrefix} is already on invoices of counter ${usedElsewhere[0].counter_code}. Pick another prefix.`,
        409
      );
    }

    const { error, count } = await supabase
      .from("counters")
      .update({ invoice_prefix: c.invoicePrefix, print_width_mm: c.printWidthMm }, { count: "exact" })
      .eq("id", c.id);
    if (error) return counterDbError(error);
    if (count === 0) return fail("Counter not found.", 404);

    refresh();
    return { success: true, data: null, statusCode: 200 };
  } catch (err: unknown) {
    return fromException(err, "Could not save the counter.");
  }
}
