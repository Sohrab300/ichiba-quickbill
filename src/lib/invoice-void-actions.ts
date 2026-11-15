"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { AuthError, getStaffContext } from "./auth";
import { createServerClient } from "./supabase/server";
import type { ActionResult } from "./actions";

const schema = z.object({ invoiceId: z.uuid(), reason: z.string().trim().min(1, "Enter a reason.").max(500) });

export async function voidInvoice(input: { invoiceId: string; reason: string }): Promise<ActionResult> {
  try {
    const staff = await getStaffContext("admin");
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues.map((i) => i.message).join("; "), statusCode: 400 };
    const { error } = await createServerClient().rpc("void_invoice", {
      p_invoice_id: parsed.data.invoiceId,
      p_admin_user_id: staff.userId,
      p_reason: parsed.data.reason,
    });
    if (error) {
      console.error("void_invoice failed", error);
      return { success: false, error: error.code === "PGRST202" ? "Apply the invoice voids database migration first." : "Could not void the invoice. Check its status and try again.", statusCode: 500 };
    }
    revalidatePath("/invoices");
    revalidatePath(`/invoices/${parsed.data.invoiceId}`);
    return { success: true };
  } catch (err) {
    if (err instanceof AuthError) return { success: false, error: err.message, statusCode: err.status };
    console.error("voidInvoice failed", err);
    return { success: false, error: "Could not void the invoice. Check its status and try again.", statusCode: 500 };
  }
}
