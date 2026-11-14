import { Suspense } from "react";
import PageLoading from "@/components/PageLoading";
import { SettingsForms, type CounterSettings, type StoreSettings } from "@/components/settings/SettingsForms";
import { requireStaffForPage } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";

export default function SettingsPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Settings />
    </Suspense>
  );
}

async function load(): Promise<{ store: StoreSettings; counters: CounterSettings[] }> {
  const supabase = createServerClient();
  const [store, counters] = await Promise.all([
    supabase
      .from("store_settings")
      .select("legal_name, address, phone, gstin, state_code, state_name, fy_label, invoice_footer, default_print_width_mm")
      .eq("id", true)
      .maybeSingle(),
    supabase.from("counters").select("id, code, kind, invoice_prefix, print_width_mm, is_active").order("code"),
  ]);
  if (store.error) throw new Error(`Could not load store settings: ${store.error.message}`);
  if (!store.data) throw new Error("Store settings row is missing. Apply the migrations.");
  if (counters.error) throw new Error(`Could not load counters: ${counters.error.message}`);

  const s = store.data;
  return {
    store: {
      legalName: s.legal_name,
      address: s.address,
      phone: s.phone ?? "",
      gstin: s.gstin,
      stateCode: s.state_code,
      stateName: s.state_name,
      fyLabel: s.fy_label,
      invoiceFooter: s.invoice_footer ?? "",
      defaultPrintWidthMm: s.default_print_width_mm === 58 ? 58 : 80,
    },
    counters: counters.data.map((c) => ({
      id: c.id,
      code: c.code,
      kind: c.kind === "mobile" ? "mobile" : "desk",
      invoicePrefix: c.invoice_prefix,
      printWidthMm: c.print_width_mm === 58 ? 58 : 80,
      isActive: c.is_active,
    })),
  };
}

async function Settings() {
  const staff = await requireStaffForPage();

  let data = null;
  let error: string | null = null;
  if (staff.role === "admin") {
    try {
      data = await load();
    } catch (err: unknown) {
      console.error("Settings page failed", err);
      error = err instanceof Error ? err.message : "Could not load settings.";
    }
  }

  const content =
    staff.role !== "admin" ? (
      <p className="rounded-xl border border-zinc-200 bg-white p-6 text-center font-medium dark:border-zinc-800 dark:bg-zinc-900">
        Only an admin can change settings.
      </p>
    ) : data ? (
      <SettingsForms store={data.store} counters={data.counters} />
    ) : (
      <p role="alert" className="rounded-xl border-2 border-red-300 bg-red-50 p-4 font-medium text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
        {error ?? "Could not load settings."}
      </p>
    );

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6 sm:px-6">
      <h1 className="text-2xl font-extrabold tracking-tight">Settings</h1>
      {content}
    </div>
  );
}
